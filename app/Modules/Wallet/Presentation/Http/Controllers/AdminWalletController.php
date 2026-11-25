<?php

namespace App\Modules\Wallet\Presentation\Http\Controllers;

use App\Modules\Administration\Application\Services\AuditLogService;
use App\Modules\Identity\Domain\Permissions;
use App\Modules\Order\Infrastructure\Models\VendorOrder;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Platform\Infrastructure\Models\Setting;
use App\Modules\Shared\Domain\Enums\DeliveryStatus;
use App\Modules\Shared\Domain\Enums\OrderPaymentStatus;
use App\Modules\Shared\Domain\Enums\OrderStatus;
use App\Modules\Shared\Domain\Enums\PayoutStatus;
use App\Modules\Shared\Domain\Enums\SettlementStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Presentation\Http\Filters\ListingDateRange;
use App\Modules\Shared\Presentation\Http\Response;
use App\Modules\Vendor\Infrastructure\Models\BankAccount;
use App\Modules\Vendor\Infrastructure\Models\Store;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use App\Modules\Vendor\Presentation\Resources\BankAccountResource;
use App\Modules\Wallet\Application\Services\WalletService;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use App\Modules\Wallet\Infrastructure\Models\Settlement;
use App\Modules\Wallet\Infrastructure\Models\VendorWallet;
use App\Modules\Wallet\Infrastructure\Models\WalletTransaction;
use App\Modules\Wallet\Presentation\Http\Requests\AdjustBalanceRequest;
use App\Modules\Wallet\Presentation\Http\Requests\GenerateSettlementRequest;
use App\Modules\Wallet\Presentation\Http\Requests\MarkPayoutPaidRequest;
use App\Modules\Wallet\Presentation\Http\Requests\RejectPayoutRequest;
use App\Modules\Wallet\Presentation\Resources\CommissionResource;
use App\Modules\Wallet\Presentation\Resources\PayoutRequestResource;
use App\Modules\Wallet\Presentation\Resources\SettlementResource;
use App\Modules\Wallet\Presentation\Resources\WalletResource;
use App\Modules\Wallet\Presentation\Resources\WalletTransactionResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Carbon;

class AdminWalletController extends Controller
{
    public function __construct(protected WalletService $service)
    {
        $this->middleware('auth:sanctum');
        $this->middleware('admin');
        $this->middleware('permission:'.Permissions::WALLETS_VIEW);
        $this->middleware('permission:'.Permissions::PAYOUTS_APPROVE)->only([
            'approvePayout',
            'rejectPayout',
            'markPayoutPaid',
            'cancelPayout',
        ]);
        $this->middleware('permission:'.Permissions::SETTLEMENTS_MANAGE)->only([
            'generateSettlement',
            'updateSettlementCycle',
            'holdSettlement',
            'releaseSettlement',
            'distributeSettlement',
        ]);
        $this->middleware('permission:'.Permissions::WALLETS_ADJUST)->only(['adjustBalance']);
    }

    public function wallet(string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        return Response::success(new WalletResource($this->service->walletForVendor($vendor)), 'Wallet retrieved.');
    }

    public function transactions(string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        return Response::success(
            WalletTransactionResource::collection($this->service->transactionsFor($vendor)),
            'Wallet transactions retrieved.'
        );
    }

    public function commissions(string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        return Response::success(
            CommissionResource::collection($this->service->commissionsFor($vendor)),
            'Commissions retrieved.'
        );
    }

    public function settlements(string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        return Response::success(
            SettlementResource::collection($this->service->settlementsFor($vendor)),
            'Settlements retrieved.'
        );
    }

    public function wallets(Request $request): JsonResponse
    {
        $wallets = VendorWallet::query()
            ->with('vendor')
            ->when($request->input('search'), function ($q, $s) {
                $q->whereHas('vendor', fn ($v) => $v->where('company_name', 'like', "%{$s}%"));
            })
            ->latest()
            ->paginate($request->integer('per_page', 15));

        return Response::success(
            WalletResource::collection($wallets),
            'Wallets retrieved.',
            ['pagination' => [
                'total' => $wallets->total(),
                'per_page' => $wallets->perPage(),
                'current_page' => $wallets->currentPage(),
                'last_page' => $wallets->lastPage(),
            ]]
        );
    }

    public function allPayouts(Request $request): JsonResponse
    {
        $query = PayoutRequest::query()
            ->with(['vendor', 'bankAccount', 'settlement'])
            ->when($request->input('status'), fn ($q, $s) => $q->where('status', $s))
            ->when($request->input('search'), function ($q, $s) {
                $q->where(function ($inner) use ($s) {
                    $inner->where('payout_number', 'like', "%{$s}%")
                        ->orWhereHas('vendor', fn ($v) => $v->where('company_name', 'like', "%{$s}%"));
                });
            })
            ->orderByDesc('created_at');

        ListingDateRange::apply($query, $request, 'created_at');

        $payouts = $query->paginate(min(max($request->integer('per_page', 15), 1), 100))->withQueryString();

        return Response::success(
            PayoutRequestResource::collection($payouts),
            'Payout requests retrieved.',
            ['pagination' => [
                'total' => $payouts->total(),
                'per_page' => $payouts->perPage(),
                'current_page' => $payouts->currentPage(),
                'last_page' => $payouts->lastPage(),
            ]]
        );
    }

    public function payoutProfiles(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'search' => ['nullable', 'string', 'max:120'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $this->service->releaseMaturedVendorEarnings();
        $search = trim((string) ($filters['search'] ?? ''));

        $vendors = Vendor::query()
            ->with([
                'wallet',
                'stores' => fn ($query) => $query->orderBy('name'),
                'bankAccounts' => fn ($query) => $query
                    ->orderByDesc('is_default')
                    ->orderByDesc('is_verified')
                    ->orderByDesc('id'),
            ])
            ->addSelect([
                'settlements_count' => Settlement::query()
                    ->selectRaw('COUNT(*)')
                    ->whereColumn('settlements.vendor_id', 'vendors.id'),
                'open_settlement_total' => Settlement::query()
                    ->selectRaw('COALESCE(SUM(net_payable), 0)')
                    ->whereColumn('settlements.vendor_id', 'vendors.id')
                    ->whereIn('status', [
                        SettlementStatus::ELIGIBLE->value,
                        SettlementStatus::PROCESSING->value,
                    ]),
                'held_settlement_total' => Settlement::query()
                    ->selectRaw('COALESCE(SUM(net_payable), 0)')
                    ->whereColumn('settlements.vendor_id', 'vendors.id')
                    ->where('status', SettlementStatus::HOLD->value),
                'paid_settlement_total' => Settlement::query()
                    ->selectRaw('COALESCE(SUM(net_payable), 0)')
                    ->whereColumn('settlements.vendor_id', 'vendors.id')
                    ->where('status', SettlementStatus::PAID->value),
                'payout_requests_count' => PayoutRequest::query()
                    ->selectRaw('COUNT(*)')
                    ->whereColumn('payout_requests.vendor_id', 'vendors.id'),
                'open_payout_total' => PayoutRequest::query()
                    ->selectRaw('COALESCE(SUM(amount), 0)')
                    ->whereColumn('payout_requests.vendor_id', 'vendors.id')
                    ->whereIn('status', [
                        PayoutStatus::PENDING->value,
                        PayoutStatus::APPROVED->value,
                        PayoutStatus::PROCESSING->value,
                    ]),
                'paid_payout_total' => PayoutRequest::query()
                    ->selectRaw('COALESCE(SUM(amount), 0)')
                    ->whereColumn('payout_requests.vendor_id', 'vendors.id')
                    ->where('status', PayoutStatus::PAID->value),
            ])
            ->when($search !== '', function ($query) use ($search) {
                $query->where(function ($inner) use ($search) {
                    $inner->where('company_name', 'like', "%{$search}%")
                        ->orWhere('pan_vat', 'like', "%{$search}%")
                        ->orWhereHas('stores', fn ($stores) => $stores->where('name', 'like', "%{$search}%"));
                });
            })
            ->orderBy('company_name')
            ->paginate(min(max((int) ($filters['per_page'] ?? 50), 1), 100))
            ->withQueryString();

        $holdingDays = max(0, (int) Setting::get('settlement.waiting_days', 7));
        $profiles = $vendors->getCollection()->map(function (Vendor $vendor) use ($holdingDays) {
            $settlementCycleDays = max(1, (int) ($vendor->meta['settlement_cycle_days'] ?? 14));
            $wallet = $vendor->wallet;

            return [
                'vendor_id' => $vendor->uuid,
                'vendor_name' => $vendor->company_name,
                'vendor_status' => $vendor->status?->value,
                'pan_vat' => $vendor->pan_vat,
                'stores' => $vendor->stores->map(fn ($store) => [
                    'id' => $store->uuid,
                    'name' => $store->name,
                    'status' => $store->status?->value,
                ])->values(),
                'wallet' => [
                    'balance' => number_format((float) ($wallet?->balance ?? 0), 2, '.', ''),
                    'available_balance' => number_format((float) ($wallet?->available_balance ?? 0), 2, '.', ''),
                    'pending_balance' => number_format((float) ($wallet?->pending_balance ?? 0), 2, '.', ''),
                    'currency' => $wallet?->currency ?? 'NPR',
                ],
                'bank_accounts' => $vendor->bankAccounts->map(fn ($account) => [
                    'id' => $account->uuid,
                    'bank_name' => $account->bank_name,
                    'branch_name' => $account->branch_name,
                    'account_name' => $account->account_name,
                    'account_number' => $account->account_number,
                    'account_type' => $account->account_type,
                    'is_default' => (bool) $account->is_default,
                    'is_verified' => (bool) $account->is_verified,
                ])->values(),
                'settlement_cycle_days' => $settlementCycleDays,
                'earnings_maturity_days' => $holdingDays,
                'settlements_count' => (int) $vendor->settlements_count,
                'open_settlement_total' => number_format((float) $vendor->open_settlement_total, 2, '.', ''),
                'held_settlement_total' => number_format((float) $vendor->held_settlement_total, 2, '.', ''),
                'paid_settlement_total' => number_format((float) $vendor->paid_settlement_total, 2, '.', ''),
                'payout_requests_count' => (int) $vendor->payout_requests_count,
                'open_payout_total' => number_format((float) $vendor->open_payout_total, 2, '.', ''),
                'paid_payout_total' => number_format((float) $vendor->paid_payout_total, 2, '.', ''),
            ];
        })->values();

        return Response::success($profiles, 'Vendor payout financial profiles retrieved.', [
            'pagination' => [
                'total' => $vendors->total(),
                'per_page' => $vendors->perPage(),
                'current_page' => $vendors->currentPage(),
                'last_page' => $vendors->lastPage(),
            ],
        ]);
    }

    public function allSettlements(Request $request): JsonResponse
    {
        $search = trim((string) $request->input('search', ''));
        $query = Settlement::query()
            ->with('vendor')
            ->when($search !== '', function ($q) use ($search) {
                $q->where(function ($inner) use ($search) {
                    $inner->where('settlement_number', 'like', "%{$search}%")
                        ->orWhereHas('vendor', function ($vendor) use ($search) {
                            $vendor->where('company_name', 'like', "%{$search}%")
                                ->orWhereHas('stores', fn ($stores) => $stores->where('name', 'like', "%{$search}%"));
                        });
                });
            });

        if ($request->boolean('group_by_vendor')) {
            $this->service->releaseMaturedVendorEarnings();

            $vendors = Vendor::query()
                ->with([
                    'wallet',
                    'stores' => fn ($stores) => $stores->orderBy('name'),
                ])
                ->when($search !== '', function ($vendors) use ($search) {
                    $vendors->where(function ($inner) use ($search) {
                        $inner->where('company_name', 'like', "%{$search}%")
                            ->orWhereHas('stores', fn ($stores) => $stores->where('name', 'like', "%{$search}%"))
                            ->orWhereIn('id', Settlement::query()
                                ->select('vendor_id')
                                ->where('settlement_number', 'like', "%{$search}%"));
                    });
                })
                ->orderBy('company_name')
                ->get();

            $settlementsByVendor = Settlement::query()
                ->whereIn('vendor_id', $vendors->modelKeys())
                ->latest()
                ->get()
                ->groupBy('vendor_id');

            $earningOrderStatuses = [
                OrderStatus::DELIVERED->value,
                OrderStatus::COMPLETED->value,
                OrderStatus::RETURNED->value,
            ];
            $earningPaymentStatuses = [
                OrderPaymentStatus::PAID->value,
                OrderPaymentStatus::PARTIALLY_REFUNDED->value,
                OrderPaymentStatus::REFUNDED->value,
            ];
            $earningsByVendor = VendorOrder::query()
                ->selectRaw('vendor_id, COUNT(*) as earning_orders_count, COALESCE(SUM(grand_total), 0) as gross_sales, COALESCE(SUM(commission_amount), 0) as commission_total, COALESCE(SUM(vendor_payable), 0) as payable_total')
                ->whereIn('status', $earningOrderStatuses)
                ->where('delivery_status', DeliveryStatus::DELIVERED->value)
                ->whereHas('order', fn ($orders) => $orders->whereIn('payment_status', $earningPaymentStatuses))
                ->groupBy('vendor_id')
                ->get()
                ->keyBy('vendor_id');
            $refundsByVendor = Refund::query()
                ->join('vendor_orders', 'vendor_orders.id', '=', 'refunds.vendor_order_id')
                ->join('orders', 'orders.id', '=', 'vendor_orders.order_id')
                ->where('refunds.status', 'refunded')
                ->whereIn('vendor_orders.status', $earningOrderStatuses)
                ->where('vendor_orders.delivery_status', DeliveryStatus::DELIVERED->value)
                ->whereIn('orders.payment_status', $earningPaymentStatuses)
                ->selectRaw('vendor_orders.vendor_id, COALESCE(SUM(refunds.amount), 0) as refunded_total')
                ->groupBy('vendor_orders.vendor_id')
                ->get()
                ->mapWithKeys(fn ($row) => [(int) $row->vendor_id => (float) $row->refunded_total]);

            $statusPriority = [
                SettlementStatus::PROCESSING->value => 0,
                SettlementStatus::HOLD->value => 1,
                SettlementStatus::ELIGIBLE->value => 2,
                SettlementStatus::PAID->value => 3,
                'not_generated' => 4,
            ];

            $grouped = $vendors->map(function (Vendor $vendor) use ($statusPriority, $settlementsByVendor, $earningsByVendor, $refundsByVendor) {
                $rows = $settlementsByVendor->get($vendor->id, collect());
                $earnings = $earningsByVendor->get($vendor->id);
                $statuses = $rows->pluck('status')->map->value;
                $bestStatus = $statuses->sortBy(fn ($status) => $statusPriority[$status] ?? 99)->first();
                $open = $rows->reject(fn ($row) => $row->status->value === SettlementStatus::PAID->value);
                $wallet = $vendor->wallet;
                $earnedTotal = max(
                    0,
                    round((float) ($earnings?->payable_total ?? 0) - (float) $refundsByVendor->get($vendor->id, 0), 2)
                );

                return [
                    'vendor_id' => $vendor->uuid,
                    'vendor_name' => $vendor->company_name,
                    'stores' => $vendor->stores->map(fn (Store $store) => [
                        'id' => $store->uuid,
                        'name' => $store->name,
                        'status' => $store->status?->value,
                    ])->values(),
                    'settlement_cycle_days' => $this->settlementCycleDays($vendor),
                    'period_start' => $rows->min('period_start')?->toDateString(),
                    'period_end' => $rows->max('period_end')?->toDateString(),
                    'gross_sales' => number_format((float) ($earnings?->gross_sales ?? 0), 2, '.', ''),
                    'commission_total' => number_format((float) ($earnings?->commission_total ?? 0), 2, '.', ''),
                    'earned_total' => number_format((float) $earnedTotal, 2, '.', ''),
                    'net_payable' => number_format((float) ($wallet?->balance ?? 0), 2, '.', ''),
                    'available_balance' => number_format((float) ($wallet?->available_balance ?? 0), 2, '.', ''),
                    'pending_balance' => number_format((float) ($wallet?->pending_balance ?? 0), 2, '.', ''),
                    'status' => $bestStatus ?? 'not_generated',
                    'earning_orders_count' => (int) ($earnings?->earning_orders_count ?? 0),
                    'settlements_count' => $rows->count(),
                    'open_count' => $open->count(),
                ];
            })
                ->sortBy(fn ($vendor) => $statusPriority[$vendor['status']] ?? 99)
                ->values();

            return Response::success($grouped, 'Vendor settlement and earnings summaries retrieved.');
        }

        $settlements = $query
            ->when($request->input('status'), fn ($q, $s) => $q->where('status', $s))
            ->latest()
            ->paginate($request->integer('per_page', 15));

        return Response::success(
            SettlementResource::collection($settlements),
            'Settlements retrieved.',
            ['pagination' => [
                'total' => $settlements->total(),
                'per_page' => $settlements->perPage(),
                'current_page' => $settlements->currentPage(),
                'last_page' => $settlements->lastPage(),
            ]]
        );
    }

    public function ledger(Request $request, string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        $this->service->reconcileRefundEarningsForVendor($vendor);
        $wallet = $this->service->walletForVendor($vendor);

        $settlementModels = $this->service->settlementsFor($vendor);

        $settlementOrderMap = collect();
        foreach ($settlementModels as $settlement) {
            foreach ($settlement->meta['vendor_order_ids'] ?? [] as $orderId) {
                $settlementOrderMap->put((int) $orderId, [
                    'number' => $settlement->settlement_number,
                    'status' => $settlement->status->value,
                    'period_start' => $settlement->period_start?->toDateString(),
                    'period_end' => $settlement->period_end?->toDateString(),
                    'hold_reason' => $settlement->hold_reason,
                    'paid' => $settlement->status->value === SettlementStatus::PAID->value,
                ]);
            }
        }

        $validOrdersQuery = VendorOrder::query()
            ->where('vendor_id', $vendor->id)
            ->whereNotIn('status', ['cancelled', 'returned']);

        $totalVendorPayable = (float) (clone $validOrdersQuery)->sum('vendor_payable');
        $totalRefunded = (float) Refund::query()
            ->whereHas('vendorOrder', fn ($query) => $query->where('vendor_id', $vendor->id))
            ->where('status', 'refunded')
            ->sum('amount');
        $stats = [
            'orders_count' => (clone $validOrdersQuery)->count(),
            'total_gross' => number_format((float) (clone $validOrdersQuery)->sum('grand_total'), 2, '.', ''),
            'total_commission' => number_format((float) (clone $validOrdersQuery)->sum('commission_amount'), 2, '.', ''),
            'total_vendor_payable' => number_format((float) (clone $validOrdersQuery)->sum('vendor_payable'), 2, '.', ''),
            'total_refunded' => number_format($totalRefunded, 2, '.', ''),
            'total_net_payable' => number_format(max(0, $totalVendorPayable - $totalRefunded), 2, '.', ''),
            'total_settled' => number_format($settlementModels->where('status', SettlementStatus::PAID)->sum(fn ($s) => (float) $s->net_payable), 2, '.', ''),
            'total_withdrawn' => number_format(PayoutRequest::query()->where('vendor_id', $vendor->id)->where('status', PayoutStatus::PAID->value)->sum('amount'), 2, '.', ''),
        ];

        $orderSearch = trim((string) $request->input('order_search', ''));
        $ordersPaginator = VendorOrder::query()
            ->where('vendor_id', $vendor->id)
            ->whereNotIn('status', ['returned'])
            ->withSum(['refunds as refunded_amount' => fn ($query) => $query->where('status', 'refunded')], 'amount')
            ->withCount(['returnRequests as has_return' => fn ($q) => $q->whereNotIn('status', ['cancelled', 'rejected'])])
            ->with(['order', 'items', 'store'])
            ->when($orderSearch !== '', function ($q, $s) {
                $q->where(function ($q2) use ($s) {
                    $q2->where('vendor_order_number', 'like', "%{$s}%")
                        ->orWhereHas('order', fn ($o) => $o->where('order_number', 'like', "%{$s}%"))
                        ->orWhereHas('items', fn ($i) => $i->where('product_name', 'like', "%{$s}%"));
                });
            })
            ->latest('id')
            ->paginate($request->integer('orders_per_page', 15), ['*'], 'orders_page');

        $orders = $ordersPaginator->getCollection()->map(function (VendorOrder $vo) use ($settlementOrderMap) {
            $itemsSubtotal = (float) $vo->items_subtotal;
            $commissionAmount = (float) $vo->commission_amount;
            $commissionRate = (float) $vo->commission_rate;
            $refundedAmount = (float) ($vo->refunded_amount ?? 0);
            $isCancelled = in_array($vo->status?->value ?? (string) $vo->status, ['cancelled', 'returned'], true);
            $vendorPayable = $isCancelled ? 0.0 : (float) $vo->vendor_payable;
            $netPayable = $isCancelled ? 0.0 : max(0, round($vendorPayable - $refundedAmount, 2));

            return [
                'id' => $vo->uuid,
                'vendor_order_number' => $vo->vendor_order_number,
                'order_number' => $vo->order?->order_number,
                'placed_at' => $vo->order?->placed_at?->toISOString(),
                'status' => $vo->status->value,
                'payment_status' => $vo->order?->payment_status?->value ?? null,
                'delivery_status' => $vo->delivery_status?->value,
                'has_return' => (int) ($vo->has_return ?? 0) > 0,
                'store_name' => $vo->store?->name,
                'items_subtotal' => number_format($itemsSubtotal, 2, '.', ''),
                'discount' => number_format((float) $vo->discount, 2, '.', ''),
                'delivery_charge' => number_format((float) $vo->delivery_charge, 2, '.', ''),
                'tax' => number_format((float) $vo->tax, 2, '.', ''),
                'grand_total' => number_format((float) $vo->grand_total, 2, '.', ''),
                'commission_rate' => number_format($commissionRate, 2, '.', ''),
                'commission_amount' => number_format($commissionAmount, 2, '.', ''),
                'vendor_payable' => number_format($vendorPayable, 2, '.', ''),
                'refunded_amount' => number_format($refundedAmount, 2, '.', ''),
                'net_payable' => number_format($netPayable, 2, '.', ''),
                'settlement' => $settlementOrderMap->get($vo->id),
                'items' => $vo->items->map(function ($item) use ($itemsSubtotal, $commissionAmount) {
                    $lineTotal = (float) $item->line_total;
                    $lineCommission = $itemsSubtotal > 0 ? round($commissionAmount * ($lineTotal / $itemsSubtotal), 2) : 0.0;

                    return [
                        'product_name' => $item->product_name,
                        'sku' => $item->sku,
                        'variant_name' => $item->variant_name,
                        'quantity' => $item->quantity,
                        'unit_price' => number_format((float) $item->unit_price, 2, '.', ''),
                        'unit_discount' => number_format((float) ($item->unit_discount ?? 0), 2, '.', ''),
                        'line_total' => number_format($lineTotal, 2, '.', ''),
                        'line_commission' => number_format($lineCommission, 2, '.', ''),
                        'line_vendor_payable' => number_format($lineTotal - $lineCommission, 2, '.', ''),
                    ];
                }),
            ];
        })->values();

        $txnSearch = trim((string) $request->input('txn_search', ''));
        $txnPaginator = WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->when($txnSearch !== '', function ($q, $s) {
                $q->where(function ($q2) use ($s) {
                    $q2->where('description', 'like', "%{$s}%")
                        ->orWhere('transaction_type', 'like', "%{$s}%")
                        ->orWhere('reference_id', ctype_digit($s) ? (int) $s : 0);
                });
            })
            ->orderByDesc('id')
            ->paginate($request->integer('txn_per_page', 15), ['*'], 'txn_page');

        $transactions = $txnPaginator->getCollection()
            ->map(fn ($t) => (new WalletTransactionResource($t))->resolve($request))
            ->values();

        $settlementsPaginator = Settlement::query()
            ->where('vendor_id', $vendor->id)
            ->with(['payoutRequests'])
            ->latest('id')
            ->paginate($request->integer('settlements_per_page', 15), ['*'], 'settlements_page');

        $settlements = $settlementsPaginator->getCollection()
            ->map(fn ($s) => (new SettlementResource($s))->resolve($request))
            ->values();

        $payoutsPaginator = PayoutRequest::query()
            ->where('vendor_id', $vendor->id)
            ->with(['bankAccount', 'records', 'settlement'])
            ->latest('id')
            ->paginate($request->integer('payouts_per_page', 15), ['*'], 'payouts_page');

        $payouts = $payoutsPaginator->getCollection()
            ->map(fn ($p) => (new PayoutRequestResource($p))->resolve($request))
            ->values();

        $bankAccounts = BankAccount::query()
            ->where('vendor_id', $vendor->id)
            ->orderByDesc('is_default')
            ->orderByDesc('is_verified')
            ->latest('id')
            ->get();

        return Response::success([
            'vendor' => [
                'id' => $vendor->uuid,
                'company_name' => $vendor->company_name,
                'business_email' => $vendor->business_email,
                'pan_vat' => $vendor->pan_vat,
                'status' => $vendor->status->value,
                'settlement_cycle_days' => $this->settlementCycleDays($vendor),
            ],
            'wallet' => new WalletResource($wallet),
            'stats' => $stats,
            'orders' => $orders,
            'orders_pagination' => $this->paginationMeta($ordersPaginator),
            'transactions' => $transactions,
            'transactions_pagination' => $this->paginationMeta($txnPaginator),
            'settlements' => $settlements,
            'settlements_pagination' => $this->paginationMeta($settlementsPaginator),
            'payouts' => $payouts,
            'payouts_pagination' => $this->paginationMeta($payoutsPaginator),
            'bank_accounts' => BankAccountResource::collection($bankAccounts),
        ], 'Vendor finance ledger retrieved.');
    }

    protected function paginationMeta($paginator): array
    {
        return [
            'total' => $paginator->total(),
            'per_page' => $paginator->perPage(),
            'current_page' => $paginator->currentPage(),
            'last_page' => $paginator->lastPage(),
        ];
    }

    public function generateSettlement(GenerateSettlementRequest $request): JsonResponse
    {
        $vendor = $this->vendor($request->input('vendor_id'));

        $settlement = $this->service->settleVendor(
            $vendor,
            Carbon::parse($request->input('period_start')),
            Carbon::parse($request->input('period_end'))->endOfDay()
        );

        app(AuditLogService::class)->record(request()->user(), 'settlement.generated', 'settlement', $settlement->uuid, null, ['vendor' => $vendor->uuid]);

        return Response::created(new SettlementResource($settlement), 'Settlement generated.');
    }

    public function updateSettlementCycle(Request $request, string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        $validated = $request->validate([
            'settlement_cycle_days' => ['required', 'integer', 'min:1', 'max:120'],
        ]);

        $days = (int) $validated['settlement_cycle_days'];
        $meta = is_array($vendor->meta) ? $vendor->meta : [];
        $meta['settlement_cycle_days'] = $days;
        $vendor->update(['meta' => $meta]);

        app(AuditLogService::class)->record(request()->user(), 'settlement.cycle_updated', 'vendor', $vendor->uuid, null, ['settlement_cycle_days' => $days]);

        return Response::success([
            'vendor_id' => $vendor->uuid,
            'settlement_cycle_days' => $days,
        ], 'Settlement cycle updated.');
    }

    protected function settlementCycleDays(Vendor $vendor): int
    {
        return (int) ($vendor->meta['settlement_cycle_days'] ?? 14);
    }

    public function payouts(string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        return Response::success(
            PayoutRequestResource::collection($this->service->payoutsFor($vendor)),
            'Payout requests retrieved.'
        );
    }

    public function approvePayout(string $payoutId): JsonResponse
    {
        $payout = $this->payout($payoutId);
        $payout = $this->service->approvePayout($payout, request()->user());

        app(AuditLogService::class)->record(request()->user(), 'payout.approved', 'payout', $payout->uuid, ['status' => 'requested'], ['status' => $payout->status->value]);

        return Response::success(new PayoutRequestResource($payout), 'Payout approved.');
    }

    public function rejectPayout(RejectPayoutRequest $request, string $payoutId): JsonResponse
    {
        $payout = $this->payout($payoutId);
        $payout = $this->service->rejectPayout($payout, request()->user(), $request->input('reason'));

        app(AuditLogService::class)->record(request()->user(), 'payout.rejected', 'payout', $payout->uuid, ['status' => 'requested'], ['status' => 'rejected', 'reason' => $request->input('reason')]);

        return Response::success(new PayoutRequestResource($payout), 'Payout rejected.');
    }

    public function markPayoutPaid(MarkPayoutPaidRequest $request, string $payoutId): JsonResponse
    {
        $payout = $this->payout($payoutId);
        $payout = $this->service->markPayoutPaid(
            $payout,
            request()->user(),
            $request->input('provider_reference'),
            (float) $request->input('fee', 0)
        );

        app(AuditLogService::class)->record(request()->user(), 'payout.marked_paid', 'payout', $payout->uuid, ['status' => 'approved'], ['status' => 'paid', 'provider_reference' => $request->input('provider_reference')]);

        return Response::success(new PayoutRequestResource($payout), 'Payout marked as paid.');
    }

    public function cancelPayout(string $payoutId): JsonResponse
    {
        $payout = $this->payout($payoutId);
        $payout = $this->service->cancelPayout($payout, request()->user());

        app(AuditLogService::class)->record(request()->user(), 'payout.cancelled', 'payout', $payout->uuid, null, ['status' => 'cancelled']);

        return Response::success(new PayoutRequestResource($payout), 'Payout cancelled.');
    }

    public function adjustBalance(AdjustBalanceRequest $request, string $vendorId): JsonResponse
    {
        $vendor = $this->vendor($vendorId);

        $wallet = $this->service->adjustBalance(
            $vendor,
            (float) $request->input('amount'),
            $request->input('reason'),
            request()->user()
        );

        app(AuditLogService::class)->record(request()->user(), 'wallet.adjusted', 'wallet', $wallet->uuid, null, ['vendor' => $vendor->uuid, 'amount' => $request->input('amount'), 'reason' => $request->input('reason')]);

        return Response::success(new WalletResource($wallet), 'Balance adjusted.');
    }

    public function holdSettlement(Request $request, string $settlementId): JsonResponse
    {
        $settlement = $this->settlement($settlementId);
        $settlement = $this->service->holdSettlement($settlement, request()->user(), $request->input('reason', 'Held by administrator'));

        app(AuditLogService::class)->record(request()->user(), 'settlement.held', 'settlement', $settlement->uuid, ['status' => 'eligible'], ['status' => 'hold', 'reason' => $settlement->hold_reason]);

        return Response::success(new SettlementResource($settlement->load('vendor')), 'Settlement placed on hold.');
    }

    public function releaseSettlement(string $settlementId): JsonResponse
    {
        $settlement = $this->settlement($settlementId);
        $settlement = $this->service->releaseSettlement($settlement, request()->user());

        app(AuditLogService::class)->record(request()->user(), 'settlement.released', 'settlement', $settlement->uuid, ['status' => 'hold'], ['status' => $settlement->status->value]);

        return Response::success(new SettlementResource($settlement->load('vendor')), 'Settlement released from hold.');
    }

    public function distributeSettlement(string $settlementId): JsonResponse
    {
        $settlement = $this->settlement($settlementId);
        $settlement = $this->service->distributeSettlement($settlement, request()->user());

        app(AuditLogService::class)->record(request()->user(), 'settlement.distributed', 'settlement', $settlement->uuid, ['status' => $settlement->status->value], ['status' => SettlementStatus::PAID->value]);

        return Response::success(new SettlementResource($settlement->load('vendor')), 'Settlement distributed.');
    }

    protected function vendor(string $vendorId): Vendor
    {
        $vendor = Vendor::query()
            ->where('uuid', $vendorId)
            ->orWhere('id', ctype_digit($vendorId) ? (int) $vendorId : 0)
            ->first();

        if (! $vendor) {
            throw new DomainException('Vendor not found.', 404);
        }

        return $vendor;
    }

    protected function payout(string $payoutId): PayoutRequest
    {
        $payout = PayoutRequest::query()
            ->with(['bankAccount', 'settlement', 'records'])
            ->where('uuid', $payoutId)
            ->orWhere('id', ctype_digit($payoutId) ? (int) $payoutId : 0)
            ->first();

        if (! $payout) {
            throw new DomainException('Payout request not found.', 404);
        }

        return $payout;
    }

    protected function settlement(string $settlementId): Settlement
    {
        return Settlement::query()
            ->where('uuid', $settlementId)
            ->orWhere('id', ctype_digit($settlementId) ? (int) $settlementId : 0)
            ->firstOrFail();
    }
}
