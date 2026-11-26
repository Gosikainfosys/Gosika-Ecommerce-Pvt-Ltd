<?php

namespace App\Modules\Wallet\Application\Services;

use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Order\Application\Services\OrderReturnWindow;
use App\Modules\Order\Infrastructure\Models\VendorOrder;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Platform\Infrastructure\Models\Setting;
use App\Modules\Shared\Domain\Enums\CommissionStatus;
use App\Modules\Shared\Domain\Enums\DeliveryStatus;
use App\Modules\Shared\Domain\Enums\OrderPaymentStatus;
use App\Modules\Shared\Domain\Enums\OrderStatus;
use App\Modules\Shared\Domain\Enums\PayoutStatus;
use App\Modules\Shared\Domain\Enums\RefundStatus;
use App\Modules\Shared\Domain\Enums\SettlementStatus;
use App\Modules\Shared\Domain\Enums\WalletTransactionType;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Infrastructure\Services\ReferenceNumber;
use App\Modules\Vendor\Infrastructure\Models\BankAccount;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use App\Modules\Wallet\Infrastructure\Models\Commission;
use App\Modules\Wallet\Infrastructure\Models\PayoutRecord;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use App\Modules\Wallet\Infrastructure\Models\Settlement;
use App\Modules\Wallet\Infrastructure\Models\VendorWallet;
use App\Modules\Wallet\Infrastructure\Models\WalletTransaction;
use App\Modules\Marketing\Application\Services\NotificationDispatcher;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

class WalletService
{
    public function __construct(
        protected NotificationDispatcher $dispatcher,
    ) {
    }

    public function walletForVendor(Vendor $vendor): VendorWallet
    {
        return $this->ensureWallet($vendor);
    }

    public function ensureWallet(Vendor $vendor): VendorWallet
    {
        $wallet = VendorWallet::query()->firstOrNew(['vendor_id' => $vendor->id]);

        if (! $wallet->exists) {
            $wallet->balance = 0;
            $wallet->available_balance = 0;
            $wallet->pending_balance = 0;
            $wallet->currency = 'NPR';
            $wallet->version = 1;
            $wallet->save();
        }

        return $wallet;
    }

    public function recordCommission(VendorOrder $vendorOrder, ?int $actorUserId = null): Commission
    {
        $commission = Commission::query()->firstOrNew(['vendor_order_id' => $vendorOrder->id]);

        if (! $commission->exists) {
            $commission->order_id = $vendorOrder->order_id;
            $commission->vendor_id = $vendorOrder->vendor_id;
            $commission->rate = $vendorOrder->commission_rate;
            $commission->basis_amount = $vendorOrder->grand_total;
            $commission->amount = $vendorOrder->commission_amount;
            $commission->status = CommissionStatus::CALCULATED;
            $commission->calculated_at = now();
            $commission->created_by = $actorUserId;
            $commission->save();
        }

        return $commission;
    }

    public function creditEarnings(VendorOrder $vendorOrder, ?Vendor $vendor = null): Commission
    {
        if (! $this->isEligibleForEarnings($vendorOrder, $vendor)) {
            throw new DomainException('Order has not met the payment, delivery, and settlement holding requirements.', 422);
        }

        return DB::transaction(function () use ($vendorOrder) {
            $commission = $this->recordCommission($vendorOrder);
            $wallet = $this->lockWallet($vendorOrder->vendor_id);
            $earningsAlreadyCredited = WalletTransaction::query()
                ->where('wallet_id', $wallet->id)
                ->where('transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
                ->where('reference_type', 'vendor_order')
                ->where('reference_id', $vendorOrder->id)
                ->exists();

            if (! $earningsAlreadyCredited) {
                $amount = (float) $vendorOrder->vendor_payable;

                $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                    $wallet->balance = round((float) $wallet->balance + $amount, 2);
                    $wallet->pending_balance = round((float) $wallet->pending_balance + $amount, 2);
                });

                $this->ledger($wallet, WalletTransactionType::CREDIT_EARNINGS, $amount, [
                    'reference_type' => 'vendor_order',
                    'reference_id' => $vendorOrder->id,
                    'description' => 'Earnings from order '.$vendorOrder->order?->order_number,
                ]);
            }

            if ($commission->status->value !== CommissionStatus::EARNED->value) {
                $commission->status = CommissionStatus::EARNED;
                $commission->save();
            }

            return $commission->fresh();
        });
    }

    public function settleVendor(Vendor $vendor, Carbon $periodStart, Carbon $periodEnd): Settlement
    {
        return DB::transaction(function () use ($vendor, $periodStart, $periodEnd) {
            $vendor = Vendor::query()->whereKey($vendor->id)->lockForUpdate()->firstOrFail();
            $eligible = $this->eligibleVendorOrders($vendor, $periodStart, $periodEnd);

            if ($eligible->isEmpty()) {
                throw new DomainException('No eligible vendor orders found for the given period.', 422);
            }

            foreach ($eligible as $vendorOrder) {
                $this->creditEarnings($vendorOrder, $vendor);
            }

            $grossSales = round($eligible->sum('grand_total'), 2);
            $commissionTotal = round($eligible->sum('commission_amount'), 2);
            $vendorOrderIds = $eligible->pluck('id');
            $completedRefunds = Refund::query()
                ->whereIn('vendor_order_id', $vendorOrderIds)
                ->where('status', 'refunded')
                ->get();
            $refundsTotal = round((float) $completedRefunds->sum('amount'), 2);
            $wallet = $this->lockWallet($vendor->id);

            foreach ($completedRefunds as $refund) {
                $alreadyDebited = WalletTransaction::query()
                    ->where('wallet_id', $wallet->id)
                    ->where('transaction_type', WalletTransactionType::DEBIT_REFUND->value)
                    ->where('reference_type', 'refund')
                    ->where('reference_id', $refund->id)
                    ->exists();

                if ($alreadyDebited) {
                    continue;
                }

                $amount = (float) $refund->amount;
                $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                    $this->deductRefundBalances($wallet, $amount);
                });
                $this->ledger($wallet, WalletTransactionType::DEBIT_REFUND, $amount, [
                    'reference_type' => 'refund',
                    'reference_id' => $refund->id,
                    'description' => 'Customer refund '.$refund->refund_number,
                ]);
            }
            $adjustmentsTotal = 0.0;
            $netPayable = max(0, round(
                (float) $eligible->sum(fn (VendorOrder $vendorOrder) => (float) $vendorOrder->vendor_payable)
                - $refundsTotal
                + $adjustmentsTotal,
                2
            ));

            $settlement = new Settlement();
            $settlement->settlement_number = ReferenceNumber::unique('SET');
            $settlement->vendor_id = $vendor->id;
            $settlement->period_start = $periodStart->toDateString();
            $settlement->period_end = $periodEnd->toDateString();
            $settlement->gross_sales = $grossSales;
            $settlement->commission_total = $commissionTotal;
            $settlement->refunds_total = $refundsTotal;
            $settlement->adjustments_total = $adjustmentsTotal;
            $settlement->net_payable = $netPayable;
            $settlement->status = SettlementStatus::ELIGIBLE;
            $settlement->hold_reason = null;
            $settlement->generated_at = now();
            $settlement->meta = [
                'vendor_order_ids' => $eligible->pluck('id')->map(fn ($id) => (string) $id)->all(),
            ];
            $settlement->save();

            $this->dispatcher->settlementNotice($settlement, 'eligible');

            return $settlement->fresh();
        });
    }

    public function releaseMaturedVendorEarnings(?Vendor $vendorFilter = null): int
    {
        $this->reconcileRefundEarnings($vendorFilter);

        $vendorIds = $vendorFilter
            ? collect([$vendorFilter->id])
            : WalletTransaction::query()
                ->join('vendor_wallets', 'vendor_wallets.id', '=', 'wallet_transactions.wallet_id')
                ->where('wallet_transactions.transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
                ->where('wallet_transactions.reference_type', 'vendor_order')
                ->distinct()
                ->pluck('vendor_wallets.vendor_id')
                ->merge(VendorOrder::query()
                    ->whereIn('status', [OrderStatus::DELIVERED, OrderStatus::COMPLETED])
                    ->where('delivery_status', DeliveryStatus::DELIVERED)
                    ->whereHas('order', fn ($query) => $query->whereIn('payment_status', [
                        OrderPaymentStatus::PAID,
                        OrderPaymentStatus::PARTIALLY_REFUNDED,
                    ]))
                    ->distinct()
                    ->pluck('vendor_id'))
                ->unique()
                ->values();

        $releasedOrderCount = 0;

        foreach ($vendorIds as $vendorId) {
            $releasedOrderCount += DB::transaction(function () use ($vendorId): int {
                $vendor = Vendor::query()->whereKey($vendorId)->lockForUpdate()->firstOrFail();
                $releasedCount = $this->distributeMaturedEligibleSettlements($vendor);
                $maturedOrders = $this->eligibleVendorOrders(
                    $vendor,
                    Carbon::create(1900, 1, 1),
                    now()->endOfDay()
                );

                if ($maturedOrders->isEmpty()) {
                    $this->reconcileHoldingPeriodBalance($vendor);

                    return $releasedCount;
                }

                $deliveredAt = $maturedOrders
                    ->map(fn (VendorOrder $vendorOrder) => OrderReturnWindow::deliveredAt($vendorOrder->order))
                    ->filter();

                if ($deliveredAt->isEmpty()) {
                    return $releasedCount;
                }

                $settlement = $this->settleVendor(
                    $vendor,
                    $deliveredAt->min()->copy()->startOfDay(),
                    $deliveredAt->max()->copy()->endOfDay()
                );
                $this->distributeSettlement($settlement);
                $this->reconcileHoldingPeriodBalance($vendor);

                return $releasedCount + $maturedOrders->count();
            });
        }

        return $releasedOrderCount;
    }

    protected function reconcileHoldingPeriodBalance(Vendor $vendor): void
    {
        $wallet = $this->lockWallet($vendor->id);
        $earningTransactions = WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
            ->where('reference_type', 'vendor_order')
            ->get(['reference_id', 'amount'])
            ->groupBy('reference_id')
            ->map(fn (Collection $transactions) => (float) $transactions->sum('amount'));

        if ($earningTransactions->isEmpty()) {
            return;
        }

        $releasedOrderIds = Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->where('status', SettlementStatus::PAID->value)
            ->with('payoutRequests')
            ->get()
            ->filter(fn (Settlement $settlement) => ! $settlement->payoutRequests
                ->contains(fn (PayoutRequest $payout) => $payout->status->value === PayoutStatus::PAID->value))
            ->flatMap(fn (Settlement $settlement) => $settlement->meta['vendor_order_ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->unique()
            ->values();

        $orders = VendorOrder::query()
            ->where('vendor_id', $vendor->id)
            ->whereIn('id', $earningTransactions->keys()->map(fn ($id) => (int) $id))
            ->with(['order.vendorOrders.assignments', 'vendor'])
            ->withSum(['refunds as refunded_total' => fn ($query) => $query
                ->where('status', RefundStatus::REFUNDED->value)], 'amount')
            ->get();

        $totalEarnedNet = 0.0;
        $maturedReleasedNet = 0.0;
        foreach ($orders as $order) {
            $netAmount = max(
                0,
                round((float) $earningTransactions->get($order->id, 0) - (float) ($order->refunded_total ?? 0), 2)
            );
            $totalEarnedNet += $netAmount;

            if ($releasedOrderIds->contains($order->id) && $this->isEligibleForEarnings($order, $vendor)) {
                $maturedReleasedNet += $netAmount;
            }
        }

        $activePayoutStatuses = [
            PayoutStatus::PENDING->value,
            PayoutStatus::APPROVED->value,
            PayoutStatus::PROCESSING->value,
            PayoutStatus::PAID->value,
        ];
        $payouts = PayoutRequest::query()
            ->where('vendor_id', $vendor->id)
            ->whereIn('status', $activePayoutStatuses)
            ->get(['amount', 'funding_source']);
        $committedPayouts = (float) $payouts->sum('amount');
        $availableBalancePayouts = (float) $payouts
            ->where('funding_source', PayoutRequest::FUNDING_SOURCE_AVAILABLE_BALANCE)
            ->sum('amount');
        $nonEarningsBalance = (float) $wallet->balance - ($totalEarnedNet - $committedPayouts);
        $targetAvailable = round($maturedReleasedNet - $availableBalancePayouts + $nonEarningsBalance, 2);
        $targetAvailable = min(max(0, $targetAvailable), max(0, (float) $wallet->balance));
        $targetPending = round((float) $wallet->balance - $targetAvailable, 2);

        if (abs((float) $wallet->available_balance - $targetAvailable) < 0.01
            && abs((float) $wallet->pending_balance - $targetPending) < 0.01) {
            return;
        }

        $this->mutate($wallet, function (VendorWallet $wallet) use ($targetAvailable, $targetPending) {
            $wallet->available_balance = $targetAvailable;
            $wallet->pending_balance = $targetPending;
        });
    }

    public function unsettledEarningsByVendor(?Vendor $vendorFilter = null): Collection
    {
        return VendorOrder::query()
            ->whereIn('status', [
                OrderStatus::DELIVERED->value,
                OrderStatus::COMPLETED->value,
                OrderStatus::RETURNED->value,
            ])
            ->where('delivery_status', DeliveryStatus::DELIVERED->value)
            ->when($vendorFilter, fn ($query) => $query->where('vendor_id', $vendorFilter->id))
            ->whereHas('order', fn ($query) => $query->whereIn('payment_status', [
                OrderPaymentStatus::PAID->value,
                OrderPaymentStatus::PARTIALLY_REFUNDED->value,
                OrderPaymentStatus::REFUNDED->value,
            ]))
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')
                    ->from('wallet_transactions as earnings_transactions')
                    ->where('earnings_transactions.transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
                    ->where('earnings_transactions.reference_type', 'vendor_order')
                    ->whereColumn('earnings_transactions.reference_id', 'vendor_orders.id');
            })
            ->withSum(['refunds as refunded_total' => fn ($query) => $query->where('status', RefundStatus::REFUNDED->value)], 'amount')
            ->get(['id', 'vendor_id', 'vendor_payable'])
            ->groupBy('vendor_id')
            ->map(fn (Collection $orders) => round($orders->sum(fn (VendorOrder $order) => max(
                0,
                round((float) $order->vendor_payable - (float) ($order->refunded_total ?? 0), 2)
            )), 2));
    }

    public function reconcileRefundEarningsForVendor(Vendor $vendor): void
    {
        $this->reconcileRefundEarnings($vendor);
    }

    protected function distributeMaturedEligibleSettlements(Vendor $vendor): int
    {
        $releasedOrderCount = 0;
        $settlements = Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->where('status', SettlementStatus::ELIGIBLE->value)
            ->lockForUpdate()
            ->get();

        foreach ($settlements as $settlement) {
            $orderIds = collect($settlement->meta['vendor_order_ids'] ?? [])
                ->map(fn ($id) => (int) $id)
                ->filter()
                ->unique()
                ->values();

            if ($orderIds->isEmpty()) {
                continue;
            }

            $orders = VendorOrder::query()
                ->where('vendor_id', $vendor->id)
                ->whereIn('id', $orderIds)
                ->with(['order.vendorOrders.assignments', 'vendor'])
                ->get();

            if ($orders->count() !== $orderIds->count()
                || $orders->contains(fn (VendorOrder $order) => ! $this->isEligibleForEarnings($order, $vendor))) {
                continue;
            }

            $hasOpenPayout = $settlement->payoutRequests()
                ->whereIn('status', [
                    PayoutStatus::PENDING->value,
                    PayoutStatus::APPROVED->value,
                    PayoutStatus::PROCESSING->value,
                ])
                ->exists();

            if ($hasOpenPayout) {
                continue;
            }

            $this->distributeSettlement($settlement);
            $releasedOrderCount += $orders->count();
        }

        return $releasedOrderCount;
    }

    public function holdSettlement(Settlement $settlement, User $user, string $reason): Settlement
    {
        if (! in_array($settlement->status->value, [SettlementStatus::ELIGIBLE->value, SettlementStatus::PROCESSING->value], true)) {
            throw new DomainException('Only eligible or processing settlements can be placed on hold.', 422);
        }

        return DB::transaction(function () use ($settlement, $user, $reason) {
            $settlement->status = SettlementStatus::HOLD;
            $settlement->hold_reason = $reason;
            $settlement->updated_by = $user->id;
            $settlement->save();

            $this->dispatcher->settlementNotice($settlement, 'held');

            return $settlement->fresh(['vendor']);
        });
    }

    public function releaseSettlement(Settlement $settlement, User $user): Settlement
    {
        if ($settlement->status->value !== SettlementStatus::HOLD->value) {
            throw new DomainException('Only held settlements can be released.', 422);
        }

        return DB::transaction(function () use ($settlement, $user) {
            $hasOpenPayout = $settlement->payoutRequests()
                ->whereIn('status', [
                    PayoutStatus::PENDING->value,
                    PayoutStatus::APPROVED->value,
                    PayoutStatus::PROCESSING->value,
                ])
                ->exists();

            $settlement->status = $hasOpenPayout ? SettlementStatus::PROCESSING : SettlementStatus::ELIGIBLE;
            $settlement->hold_reason = null;
            $settlement->updated_by = $user->id;
            $settlement->save();

            $this->dispatcher->settlementNotice($settlement, 'released');

            return $settlement->fresh(['vendor']);
        });
    }

    public function distributeSettlement(Settlement $settlement, ?User $user = null): Settlement
    {
        return DB::transaction(function () use ($settlement, $user) {
            $settlement = Settlement::query()
                ->whereKey($settlement->getKey())
                ->lockForUpdate()
                ->firstOrFail();
            $status = $settlement->status->value;
            $noticeEvent = 'distributed';

            if (! in_array($status, [SettlementStatus::ELIGIBLE->value, SettlementStatus::PROCESSING->value], true)) {
                throw new DomainException('Only eligible or processing settlements can be distributed.', 422);
            }

            if ($status === SettlementStatus::ELIGIBLE->value) {
                $hasOpenPayout = $settlement->payoutRequests()
                    ->whereIn('status', [
                        PayoutStatus::PENDING->value,
                        PayoutStatus::APPROVED->value,
                        PayoutStatus::PROCESSING->value,
                    ])
                    ->exists();

                if ($hasOpenPayout) {
                    throw new DomainException('Settlement has an active payout request. Approve and distribute it via the payout, or reject the payout first.', 422);
                }

                $wallet = $this->lockWallet($settlement->vendor_id);
                $amount = round((float) $settlement->net_payable, 2);

                $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                    $wallet->pending_balance = round((float) $wallet->pending_balance - $amount, 2);
                    $wallet->available_balance = round((float) $wallet->available_balance + $amount, 2);
                });

                $this->ledger($wallet, WalletTransactionType::CREDIT_SETTLEMENT, $amount, [
                    'reference_type' => 'settlement',
                    'reference_id' => $settlement->id,
                    'description' => 'Distributed settlement '.$settlement->settlement_number.' to available balance',
                ]);
                $noticeEvent = 'released_to_wallet';
            } else {
                $payout = $settlement->payoutRequests()
                    ->whereIn('status', [
                        PayoutStatus::PENDING->value,
                        PayoutStatus::APPROVED->value,
                        PayoutStatus::PROCESSING->value,
                    ])
                    ->orderBy('id')
                    ->first();

                if ($payout) {
                    if (! $user) {
                        throw new DomainException('A user is required to distribute a settlement with an active payout.', 422);
                    }

                    $record = new PayoutRecord();
                    $record->payout_request_id = $payout->id;
                    $record->provider_reference = null;
                    $record->amount = (float) $payout->amount;
                    $record->fee = 0.00;
                    $record->net_amount = (float) $payout->amount;
                    $record->status = 'paid';
                    $record->paid_at = now();
                    $record->created_by = $user->id;
                    $record->save();

                    $payout->status = PayoutStatus::PAID;
                    $payout->paid_at = now();
                    $payout->updated_by = $user->id;
                    $payout->save();
                }
            }

            $settlement->status = SettlementStatus::PAID;
            $settlement->paid_at = now();
            $settlement->updated_by = $user?->id;
            $settlement->save();

            $this->dispatcher->settlementNotice($settlement, $noticeEvent);

            return $settlement->fresh(['vendor']);
        });
    }

    public function eligibleSettlementsFor(Vendor $vendor): Collection
    {
        return Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->where('status', SettlementStatus::ELIGIBLE->value)
            ->with(['payoutRequests'])
            ->orderByDesc('id')
            ->get()
            ->filter(fn (Settlement $settlement) => $this->isRequestable($settlement));
    }

    public function requestPayout(Settlement $settlement, ?int $bankAccountId, User $user): PayoutRequest
    {
        $this->assertPayoutsEnabled();
        $this->assertPayoutScheduleOpen();

        if (! $this->isRequestable($settlement)) {
            throw new DomainException('Only eligible settlements with a completed cycle can be requested for payout.', 422);
        }

        $amount = round((float) $settlement->net_payable, 2);
        $minimumAmount = (float) Setting::get('settlement.min_payout_amount', 1000);

        if ($amount <= 0) {
            throw new DomainException('Settlement net payable must be greater than zero.', 422);
        }
        if ($amount < $minimumAmount) {
            throw new DomainException('Payout amount is below the minimum allowed amount.', 422);
        }

        if ($bankAccountId) {
            $exists = BankAccount::query()->where('vendor_id', $settlement->vendor_id)->where('id', $bankAccountId)->exists();

            if (! $exists) {
                throw new DomainException('Selected bank account does not belong to this vendor.', 422);
            }
        }

        return DB::transaction(function () use ($settlement, $bankAccountId, $user, $amount) {
            // Lock the settlement row for update first. Every payout creation flows
            // through this method, so concurrent requests for the same settlement
            // serialize here and the re-check below sees the already-committed payout.
            $settlement = Settlement::query()->whereKey($settlement->getKey())->lockForUpdate()->firstOrFail();

            if (! $this->isRequestable($settlement)) {
                throw new DomainException('Only eligible settlements with a completed cycle can be requested for payout.', 422);
            }

            $wallet = $this->lockWallet($settlement->vendor_id);

            $payout = new PayoutRequest();
            $payout->payout_number = ReferenceNumber::unique('PO');
            $payout->vendor_id = $settlement->vendor_id;
            $payout->settlement_id = $settlement->id;
            $payout->funding_source = PayoutRequest::FUNDING_SOURCE_SETTLEMENT;
            $payout->wallet_id = $wallet->id;
            $payout->bank_account_id = $bankAccountId;
            $payout->amount = $amount;
            $payout->status = PayoutStatus::PENDING;
            $payout->requested_at = now();
            $payout->created_by = $user->id;
            $payout->save();

            $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                $wallet->pending_balance = round((float) $wallet->pending_balance - $amount, 2);
                $wallet->balance = round((float) $wallet->balance - $amount, 2);
            });

            $this->ledger($wallet, WalletTransactionType::DEBIT_WITHDRAWAL, $amount, [
                'reference_type' => 'payout_request',
                'reference_id' => $payout->id,
                'description' => 'Payout requested '.$payout->payout_number.' (reserved from settlement '.$settlement->settlement_number.')',
                'status' => 'held',
            ]);

            $this->dispatcher->payoutRequested($payout);
            $automaticallyApproved = $this->autoApprovePayoutIfConfigured($payout);
            if ($automaticallyApproved) {
                $this->dispatcher->payoutUpdated($payout, 'approved');
            }

            return $payout->fresh(['bankAccount', 'settlement']);
        });
    }

    public function requestAvailableBalancePayout(
        Vendor $vendor,
        float $requestedAmount,
        ?int $bankAccountId,
        User $user
    ): PayoutRequest {
        $this->assertPayoutsEnabled();
        $this->assertPayoutScheduleOpen();
        $this->releaseMaturedVendorEarnings($vendor);

        $amount = round($requestedAmount, 2);
        $minimumAmount = (float) Setting::get('settlement.min_payout_amount', 1000);

        if ($amount < $minimumAmount) {
            throw new DomainException('Payout amount is below the minimum allowed amount.', 422);
        }

        return DB::transaction(function () use ($vendor, $amount, $bankAccountId, $user) {
            $wallet = $this->lockWallet($vendor->id);

            if ($amount > (float) $wallet->available_balance) {
                throw new DomainException('Payout amount exceeds the available wallet balance.', 422);
            }

            if ($bankAccountId && ! BankAccount::query()
                ->where('vendor_id', $vendor->id)
                ->whereKey($bankAccountId)
                ->lockForUpdate()
                ->exists()) {
                throw new DomainException('Selected bank account does not belong to this vendor.', 422);
            }

            $payout = new PayoutRequest();
            $payout->payout_number = ReferenceNumber::unique('PO');
            $payout->vendor_id = $vendor->id;
            $payout->settlement_id = null;
            $payout->funding_source = PayoutRequest::FUNDING_SOURCE_AVAILABLE_BALANCE;
            $payout->wallet_id = $wallet->id;
            $payout->bank_account_id = $bankAccountId;
            $payout->amount = $amount;
            $payout->status = PayoutStatus::PENDING;
            $payout->requested_at = now();
            $payout->created_by = $user->id;
            $payout->save();

            $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                $wallet->available_balance = round((float) $wallet->available_balance - $amount, 2);
                $wallet->balance = round((float) $wallet->balance - $amount, 2);
            });

            $this->ledger($wallet, WalletTransactionType::DEBIT_WITHDRAWAL, $amount, [
                'reference_type' => 'payout_request',
                'reference_id' => $payout->id,
                'description' => 'Payout requested '.$payout->payout_number.' (reserved from available balance)',
                'status' => 'held',
            ]);

            $this->dispatcher->payoutRequested($payout);
            $automaticallyApproved = $this->autoApprovePayoutIfConfigured($payout);
            if ($automaticallyApproved) {
                $this->dispatcher->payoutUpdated($payout, 'approved');
            }

            return $payout->fresh(['bankAccount', 'settlement']);
        });
    }

    protected function assertPayoutsEnabled(): void
    {
        $enabled = Setting::get('commission.vendor_payouts_enabled', true);
        if (! in_array($enabled, [true, 1, '1', 'true'], true)) {
            throw new DomainException('Vendor payouts are currently disabled.', 422);
        }
    }

    protected function assertPayoutScheduleOpen(): void
    {
        $frequency = (string) Setting::get('settlement.payout_frequency', 'weekly');
        if (! PayoutSchedule::allowsRequest($frequency)) {
            throw new DomainException(PayoutSchedule::closedMessage($frequency), 422);
        }
    }

    protected function autoApprovePayoutIfConfigured(PayoutRequest $payout): bool
    {
        $requiresManualApproval = Setting::get('settlement.require_manual_payout_approval', true);
        if (in_array($requiresManualApproval, [true, 1, '1', 'true'], true)) {
            return false;
        }

        $payout->status = PayoutStatus::APPROVED;
        $payout->approved_at = now();
        $payout->save();

        if ($payout->settlement && $payout->settlement->status->value === SettlementStatus::ELIGIBLE->value) {
            $payout->settlement->status = SettlementStatus::PROCESSING;
            $payout->settlement->hold_reason = null;
            $payout->settlement->save();
        }

        return true;
    }

    public function approvePayout(PayoutRequest $payout, User $user): PayoutRequest
    {
        $this->assertStatus($payout, PayoutStatus::PENDING, 'Only pending payouts can be approved.');

        return DB::transaction(function () use ($payout, $user) {
            $payout->status = PayoutStatus::APPROVED;
            $payout->approved_by = $user->id;
            $payout->approved_at = now();
            $payout->updated_by = $user->id;
            $payout->save();

            if ($payout->settlement && $payout->settlement->status->value === SettlementStatus::ELIGIBLE->value) {
                $payout->settlement->status = SettlementStatus::PROCESSING;
                $payout->settlement->hold_reason = null;
                $payout->settlement->save();
            }

            $this->dispatcher->payoutUpdated($payout, 'approved');

            return $payout->fresh(['bankAccount', 'settlement']);
        });
    }

    public function rejectPayout(PayoutRequest $payout, User $user, string $reason): PayoutRequest
    {
        $this->assertStatus($payout, PayoutStatus::PENDING, 'Only pending payouts can be rejected.');

        return DB::transaction(function () use ($payout, $user, $reason) {
            $wallet = $this->lockWallet($payout->vendor_id);

            $payout->status = PayoutStatus::REJECTED;
            $payout->rejection_reason = $reason;
            $payout->updated_by = $user->id;
            $payout->save();

            $this->mutate($wallet, function (VendorWallet $wallet) use ($payout) {
                $this->restorePayoutFunds($wallet, $payout);
            });

            $this->ledger($wallet, WalletTransactionType::CREDIT_ADJUSTMENT, (float) $payout->amount, [
                'reference_type' => 'payout_request',
                'reference_id' => $payout->id,
                'description' => 'Rejected payout returned to pending '.$payout->payout_number,
            ]);

            $this->dispatcher->payoutUpdated($payout, 'rejected');

            return $payout->fresh(['bankAccount', 'settlement']);
        });
    }

    public function markPayoutPaid(PayoutRequest $payout, User $user, ?string $providerReference = null, float $fee = 0.0): PayoutRequest
    {
        $this->assertStatus($payout, PayoutStatus::APPROVED, 'Only approved payouts can be marked paid.');

        return DB::transaction(function () use ($payout, $user, $providerReference, $fee) {
            $record = new PayoutRecord();
            $record->payout_request_id = $payout->id;
            $record->provider_reference = $providerReference;
            $record->amount = $payout->amount;
            $record->fee = round($fee, 2);
            $record->net_amount = round((float) $payout->amount - (float) $fee, 2);
            $record->status = 'paid';
            $record->paid_at = now();
            $record->created_by = $user->id;
            $record->save();

            $payout->status = PayoutStatus::PAID;
            $payout->paid_at = now();
            $payout->updated_by = $user->id;
            $payout->save();

            if ($payout->settlement && $payout->settlement->status->value === SettlementStatus::PROCESSING->value) {
                $payout->settlement->status = SettlementStatus::PAID;
                $payout->settlement->paid_at = now();
                $payout->settlement->save();
            }

            $this->dispatcher->payoutUpdated($payout, 'paid');

            return $payout->fresh(['bankAccount', 'settlement', 'records']);
        });
    }

    public function cancelPayout(PayoutRequest $payout, User $user, ?string $reason = null): PayoutRequest
    {
        $this->assertStatus($payout, PayoutStatus::APPROVED, 'Only approved payouts can be cancelled.');

        return DB::transaction(function () use ($payout, $user, $reason) {
            $wallet = $this->lockWallet($payout->vendor_id);

            $payout->status = PayoutStatus::CANCELLED;
            $payout->rejection_reason = $reason;
            $payout->updated_by = $user->id;
            $payout->save();

            $this->mutate($wallet, function (VendorWallet $wallet) use ($payout) {
                $this->restorePayoutFunds($wallet, $payout);
            });

            $this->ledger($wallet, WalletTransactionType::CREDIT_ADJUSTMENT, (float) $payout->amount, [
                'reference_type' => 'payout_request',
                'reference_id' => $payout->id,
                'description' => 'Cancelled payout returned to pending '.$payout->payout_number,
            ]);

            if ($payout->settlement && $payout->settlement->status->value === SettlementStatus::PROCESSING->value) {
                $payout->settlement->status = SettlementStatus::ELIGIBLE;
                $payout->settlement->save();
            }

            return $payout->fresh(['bankAccount', 'settlement']);
        });
    }

    public function adjustBalance(Vendor $vendor, float $amount, string $reason, User $user): VendorWallet
    {
        return DB::transaction(function () use ($vendor, $amount, $reason, $user) {
            $wallet = $this->lockWallet($vendor->id);

            $type = $amount >= 0 ? WalletTransactionType::CREDIT_ADJUSTMENT : WalletTransactionType::DEBIT_ADJUSTMENT;
            $absolute = abs($amount);

            $this->mutate($wallet, function (VendorWallet $wallet) use ($absolute, $amount) {
                $wallet->balance = round((float) $wallet->balance + $amount, 2);
                $wallet->available_balance = round((float) $wallet->available_balance + $amount, 2);
            });

            $this->ledger($wallet, $type, $absolute, [
                'reference_type' => 'manual_adjustment',
                'description' => $reason,
                'actor_user_id' => $user->id,
            ]);

            return $wallet->fresh();
        });
    }

    public function transactionsFor(Vendor $vendor): Collection
    {
        $wallet = $this->ensureWallet($vendor);

        return WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->orderByDesc('id')
            ->get();
    }

    public function settlementsFor(Vendor $vendor): Collection
    {
        return Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->with(['payoutRequests'])
            ->orderByDesc('id')
            ->get();
    }

    public function payoutsFor(Vendor $vendor): Collection
    {
        return PayoutRequest::query()
            ->where('vendor_id', $vendor->id)
            ->with(['bankAccount', 'records', 'settlement'])
            ->orderByDesc('id')
            ->get();
    }

    public function commissionsFor(Vendor $vendor): Collection
    {
        return Commission::query()
            ->where('vendor_id', $vendor->id)
            ->with(['order'])
            ->orderByDesc('id')
            ->get();
    }

    protected function isEligibleForEarnings(VendorOrder $vendorOrder, ?Vendor $vendor = null): bool
    {
        $order = $vendorOrder->order;

        if (! $order) {
            return false;
        }

        if (! in_array($order->payment_status, [
            OrderPaymentStatus::PAID,
            OrderPaymentStatus::PARTIALLY_REFUNDED,
        ], true)) {
            return false;
        }

        if (! in_array($vendorOrder->status->value, [OrderStatus::DELIVERED->value, OrderStatus::COMPLETED->value], true)) {
            return false;
        }

        if ($vendorOrder->delivery_status !== DeliveryStatus::DELIVERED) {
            return false;
        }

        $vendor ??= $vendorOrder->relationLoaded('vendor')
            ? $vendorOrder->vendor
            : $vendorOrder->vendor()->first();
        if (! $vendor) {
            return false;
        }

        $deliveredAt = OrderReturnWindow::deliveredAt($order);
        if (! $deliveredAt) {
            return false;
        }

        $holdingDays = max(0, (int) Setting::get('settlement.waiting_days', 7));
        $maturityAt = $deliveredAt->copy()->addDays($holdingDays);

        return $maturityAt->lte(now());
    }

    protected function eligibleVendorOrders(Vendor $vendor, Carbon $periodStart, Carbon $periodEnd): Collection
    {
        $settledOrderIds = Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->get()
            ->flatMap(fn (Settlement $settlement) => $settlement->meta['vendor_order_ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->all();

        return VendorOrder::query()
            ->where('vendor_id', $vendor->id)
            ->whereIn('status', [OrderStatus::DELIVERED, OrderStatus::COMPLETED])
            ->where('delivery_status', DeliveryStatus::DELIVERED)
            ->whereHas('order', fn ($query) => $query->whereIn('payment_status', [
                OrderPaymentStatus::PAID,
                OrderPaymentStatus::PARTIALLY_REFUNDED,
            ]))
            ->whereNotIn('id', $settledOrderIds)
            ->with(['order.vendorOrders.assignments', 'vendor'])
            ->get()
            ->filter(function (VendorOrder $vendorOrder) use ($periodStart, $periodEnd, $vendor) {
                $order = $vendorOrder->order;

                if (! $this->isEligibleForEarnings($vendorOrder, $vendor)) {
                    return false;
                }

                $deliveredAt = $order ? OrderReturnWindow::deliveredAt($order) : null;

                return $deliveredAt && $deliveredAt->between($periodStart, $periodEnd);
            });
    }

    /**
     * Immediately debit a completed refund from the vendor's wallet.
     * Uses an idempotency check (reference_type + reference_id) so it is
     * safe to call multiple times and will not double-debit.
     * Also called by settleVendor() with the same guard.
     */
    public function debitRefund(Refund $refund): void
    {
        // Resolve vendor via the vendor_order relationship
        $vendorOrder = $refund->vendorOrder ?? \App\Modules\Order\Infrastructure\Models\VendorOrder::find($refund->vendor_order_id);

        if (! $vendorOrder || ! $vendorOrder->vendor_id) {
            return; // No vendor to debit — skip silently
        }

        DB::transaction(function () use ($refund, $vendorOrder) {
            $vendorOrder = VendorOrder::query()
                ->whereKey($vendorOrder->getKey())
                ->lockForUpdate()
                ->first();

            if (! $vendorOrder || ! $vendorOrder->vendor_id) {
                return;
            }

            $wallet = $this->lockWallet($vendorOrder->vendor_id);
            if (! $this->creditRefundOrderEarnings($wallet, $vendorOrder)) {
                return;
            }

            $alreadyDebited = WalletTransaction::query()
                ->where('wallet_id', $wallet->id)
                ->where('transaction_type', WalletTransactionType::DEBIT_REFUND->value)
                ->where('reference_type', 'refund')
                ->where('reference_id', $refund->id)
                ->exists();

            if ($alreadyDebited) {
                return; // Idempotent — already applied
            }

            $amount = (float) $refund->amount;

            if ($amount <= 0) {
                return;
            }

            $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
                $this->deductRefundBalances($wallet, $amount);
            });

            $this->ledger($wallet, WalletTransactionType::DEBIT_REFUND, $amount, [
                'reference_type' => 'refund',
                'reference_id'   => $refund->id,
                'description'    => 'Customer return refund '.$refund->refund_number,
            ]);
        });
    }

    protected function creditRefundOrderEarnings(VendorWallet $wallet, VendorOrder $vendorOrder): bool
    {
        $order = $vendorOrder->order;
        if (! $order
            || $vendorOrder->delivery_status !== DeliveryStatus::DELIVERED
            || ! in_array($vendorOrder->status, [
                OrderStatus::DELIVERED,
                OrderStatus::COMPLETED,
                OrderStatus::RETURNED,
            ], true)
            || ! in_array($order->payment_status, [
                OrderPaymentStatus::PAID,
                OrderPaymentStatus::PARTIALLY_REFUNDED,
                OrderPaymentStatus::REFUNDED,
            ], true)) {
            return false;
        }

        $commission = $this->recordCommission($vendorOrder);

        $earningsAlreadyCredited = WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
            ->where('reference_type', 'vendor_order')
            ->where('reference_id', $vendorOrder->id)
            ->exists();

        if ($earningsAlreadyCredited) {
            $commission->status = CommissionStatus::EARNED;
            $commission->save();

            return true;
        }

        $amount = max(0, (float) $vendorOrder->vendor_payable);
        if ($amount <= 0) {
            return false;
        }

        $this->mutate($wallet, function (VendorWallet $wallet) use ($amount) {
            $wallet->balance = round((float) $wallet->balance + $amount, 2);
            $wallet->pending_balance = round((float) $wallet->pending_balance + $amount, 2);
        });

        $this->ledger($wallet, WalletTransactionType::CREDIT_EARNINGS, $amount, [
            'reference_type' => 'vendor_order',
            'reference_id' => $vendorOrder->id,
            'description' => 'Earnings credited before refund for order '.$order->order_number,
        ]);

        $commission->status = CommissionStatus::EARNED;
        $commission->save();

        return true;
    }

    protected function reconcileRefundEarnings(?Vendor $vendorFilter = null): void
    {
        $refunds = Refund::query()
            ->select('refunds.*')
            ->join('wallet_transactions as refund_transactions', function ($join) {
                $join->on('refund_transactions.reference_id', '=', 'refunds.id')
                    ->where('refund_transactions.reference_type', '=', 'refund')
                    ->where('refund_transactions.transaction_type', '=', WalletTransactionType::DEBIT_REFUND->value);
            })
            ->join('vendor_orders', 'vendor_orders.id', '=', 'refunds.vendor_order_id')
            ->where('refunds.status', RefundStatus::REFUNDED->value)
            ->when($vendorFilter, fn ($query) => $query->where('vendor_orders.vendor_id', $vendorFilter->id))
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')
                    ->from('wallet_transactions as earnings_transactions')
                    ->whereColumn('earnings_transactions.wallet_id', 'refund_transactions.wallet_id')
                    ->where('earnings_transactions.transaction_type', WalletTransactionType::CREDIT_EARNINGS->value)
                    ->where('earnings_transactions.reference_type', 'vendor_order')
                    ->whereColumn('earnings_transactions.reference_id', 'vendor_orders.id');
            })
            ->with('vendorOrder.order')
            ->distinct()
            ->get();

        foreach ($refunds as $refund) {
            $this->debitRefund($refund);
        }
    }

    protected function deductRefundBalances(VendorWallet $wallet, float $amount): void
    {
        $pending = (float) $wallet->pending_balance;
        $available = (float) $wallet->available_balance;
        $pendingDeduction = min(max(0, $pending), $amount);
        $remaining = $amount - $pendingDeduction;
        $availableDeduction = min(max(0, $available), $remaining);
        $unfundedDeduction = $remaining - $availableDeduction;

        $wallet->balance = round((float) $wallet->balance - $amount, 2);
        $wallet->pending_balance = round($pending - $pendingDeduction - $unfundedDeduction, 2);
        $wallet->available_balance = round($available - $availableDeduction, 2);
    }

    protected function restorePayoutFunds(VendorWallet $wallet, PayoutRequest $payout): void
    {
        $amount = (float) $payout->amount;

        if ($payout->funding_source === PayoutRequest::FUNDING_SOURCE_AVAILABLE_BALANCE) {
            $wallet->available_balance = round((float) $wallet->available_balance + $amount, 2);
        } else {
            $wallet->pending_balance = round((float) $wallet->pending_balance + $amount, 2);
        }

        $wallet->balance = round((float) $wallet->balance + $amount, 2);
    }

    protected function lockWallet(int $vendorId): VendorWallet
    {
        $wallet = VendorWallet::query()
            ->where('vendor_id', $vendorId)
            ->lockForUpdate()
            ->first();

        if (! $wallet) {
            $vendor = Vendor::query()->findOrFail($vendorId);

            return $this->ensureWallet($vendor);
        }

        return $wallet;
    }

    protected function mutate(VendorWallet $wallet, callable $callback): void
    {
        $callback($wallet);
        $wallet->version = ((int) $wallet->version) + 1;
        $wallet->save();
    }

    protected function ledger(VendorWallet $wallet, WalletTransactionType $type, float $amount, array $extra = []): WalletTransaction
    {
        $balanceAfter = (float) $wallet->balance;
        $balanceBefore = str_starts_with($type->value, 'debit_')
            ? $balanceAfter + $amount
            : $balanceAfter - $amount;

        return WalletTransaction::query()->create(array_merge([
            'wallet_id' => $wallet->id,
            'transaction_type' => $type->value,
            'amount' => $amount,
            'balance_before' => round($balanceBefore, 2),
            'balance_after' => $balanceAfter,
            'status' => 'completed',
            'description' => $extra['description'] ?? $type->value,
            'meta' => $extra['meta'] ?? [],
            'created_by' => $extra['actor_user_id'] ?? null,
        ], [
            'reference_type' => $extra['reference_type'] ?? null,
            'reference_id' => $extra['reference_id'] ?? null,
            'status' => $extra['status'] ?? 'completed',
        ]));
    }

    protected function isRequestable(Settlement $settlement): bool
    {
        if ($settlement->status->value !== SettlementStatus::ELIGIBLE->value) {
            return false;
        }

        if (! $this->isCycleComplete($settlement)) {
            return false;
        }

        $orderIds = collect($settlement->meta['vendor_order_ids'] ?? [])
            ->map(fn ($id) => (int) $id)
            ->filter()
            ->unique()
            ->values();

        if ($orderIds->isEmpty()) {
            return false;
        }

        $orders = VendorOrder::query()
            ->where('vendor_id', $settlement->vendor_id)
            ->whereIn('id', $orderIds)
            ->with(['order.vendorOrders.assignments', 'vendor'])
            ->get();

        if ($orders->count() !== $orderIds->count()
            || $orders->contains(fn (VendorOrder $order) => ! $this->isEligibleForEarnings($order, $order->vendor))) {
            return false;
        }

        $hasOpenPayout = PayoutRequest::query()
            ->where('settlement_id', $settlement->id)
            ->whereIn('status', [
                PayoutStatus::PENDING->value,
                PayoutStatus::APPROVED->value,
                PayoutStatus::PROCESSING->value,
            ])
            ->exists();

        return ! $hasOpenPayout;
    }

    protected function isCycleComplete(Settlement $settlement): bool
    {
        $periodEnd = $settlement->period_end instanceof Carbon
            ? $settlement->period_end
            : Carbon::parse($settlement->period_end);

        return $periodEnd->copy()->endOfDay()->lte(now());
    }

    protected function assertStatus(PayoutRequest $payout, PayoutStatus $expected, string $message): void
    {
        if ($payout->status->value !== $expected->value) {
            throw new DomainException($message, 422);
        }
    }
}
