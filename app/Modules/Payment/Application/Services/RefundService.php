<?php

namespace App\Modules\Payment\Application\Services;

use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Order\Infrastructure\Models\Order;
use App\Modules\Order\Infrastructure\Models\OrderItem;
use App\Modules\Order\Infrastructure\Models\ReturnRequest;
use App\Modules\Payment\Infrastructure\Models\Payment;
use App\Modules\Payment\Infrastructure\Models\PaymentStatusHistory;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Shared\Domain\Enums\PaymentStatus;
use App\Modules\Shared\Domain\Enums\RefundStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Infrastructure\Services\ReferenceNumber;
use App\Modules\Wallet\Application\Services\WalletService;
use Illuminate\Support\Facades\DB;

class RefundService
{
    public function __construct(
        protected WalletService $walletService,
    ) {}

    public function remainingRefundableAmount(Payment $payment): float
    {
        $reserved = $payment->refunds()
            ->whereIn('status', [
                RefundStatus::REQUESTED->value,
                RefundStatus::APPROVED->value,
                RefundStatus::PROCESSING->value,
                RefundStatus::REFUNDED->value,
            ])
            ->sum('amount');

        return max(0, round((float) $payment->amount - (float) $reserved, 2));
    }

    public function create(
        Payment $payment,
        User $actor,
        float $amount,
        ?string $reason,
        ?array $gateway = null,
        ?ReturnRequest $returnRequest = null,
        ?string $refundType = null
    ): Refund
    {
        return DB::transaction(function () use ($payment, $actor, $amount, $reason, $gateway, $returnRequest, $refundType) {
            // Lock the payment row so concurrent refund creations cannot both pass
            // the outstanding-sum cap check and over-refund the payment.
            $payment = Payment::query()->whereKey($payment->getKey())->lockForUpdate()->firstOrFail();
            $returnRequest = $returnRequest
                ? ReturnRequest::query()->whereKey($returnRequest->getKey())->lockForUpdate()->firstOrFail()
                : null;

            if (! $payment->isPaid()) {
                throw new DomainException('Only paid payments can be refunded.', 422);
            }

            $already = $payment->refunds()
                ->whereIn('status', [
                    RefundStatus::REQUESTED->value,
                    RefundStatus::APPROVED->value,
                    RefundStatus::PROCESSING->value,
                    RefundStatus::REFUNDED->value,
                ])
                ->sum('amount');
            $paymentRemaining = round((float) $payment->amount - (float) $already, 2);

            $orderItem = null;
            if ($returnRequest) {
                $orderItem = OrderItem::query()->find($returnRequest->order_item_id);
                $returnRefunds = Refund::query()
                    ->where('return_request_id', $returnRequest->id)
                    ->whereIn('status', [
                        RefundStatus::REQUESTED->value,
                        RefundStatus::APPROVED->value,
                        RefundStatus::PROCESSING->value,
                        RefundStatus::REFUNDED->value,
                    ])
                    ->sum('amount');

                $quantity = max(1, (int) $orderItem?->quantity);
                $returnLimit = round(((float) ($orderItem?->line_total ?? 0) / $quantity) * $returnRequest->quantity, 2);
                $returnRemaining = round($returnLimit - (float) $returnRefunds, 2);
                $refundType ??= (round($amount, 2) >= $paymentRemaining ? 'full' : 'partial');

                if (! $orderItem) {
                    throw new DomainException('The returned order item could not be found.', 422);
                }

                if ($refundType !== 'full') {
                    $itemRefunds = Refund::query()
                        ->where('order_item_id', $returnRequest->order_item_id)
                        ->whereIn('status', [
                            RefundStatus::REQUESTED->value,
                            RefundStatus::APPROVED->value,
                            RefundStatus::PROCESSING->value,
                            RefundStatus::REFUNDED->value,
                        ])
                        ->sum('amount');

                    if (round((float) $itemRefunds, 2) + round($amount, 2) > round((float) $orderItem->line_total, 2)
                        || round((float) $returnRefunds, 2) + round($amount, 2) > $returnLimit) {
                        throw new DomainException('Partial refund amount exceeds the refundable value for this returned item.', 422);
                    }
                }
            }

            if ($refundType === 'full' && round($amount, 2) !== $paymentRemaining) {
                throw new DomainException('A full refund must equal the remaining amount paid for the order.', 422);
            }

            if (round($already, 2) + round($amount, 2) > round((float) $payment->amount, 2)) {
                throw new DomainException('Refund amount exceeds the payment balance.', 422);
            }

            $refund = new Refund();
            $refund->refund_number = ReferenceNumber::unique('REF');
            $refund->payment_id = $payment->id;
            $refund->order_id = $payment->order_id;
            $refund->vendor_order_id = $returnRequest?->vendor_order_id ?? $payment->vendor_order_id;
            $refund->order_item_id = $returnRequest?->order_item_id;
            $refund->return_request_id = $returnRequest?->id;
            $refund->amount = round($amount, 2);
            $refund->reason = $reason;
            $refund->status = RefundStatus::REQUESTED;
            $refund->initiated_by = $actor->id;
            $refund->initiated_at = now();

            if (isset($gateway['provider_refund_id']) && $gateway['provider_refund_id'] !== null) {
                $refund->provider_refund_id = (string) $gateway['provider_refund_id'];
            }

            $providerResponse = $gateway['provider_response'] ?? [];
            if ($returnRequest && $refundType !== null) {
                $providerResponse['refund_type'] = $refundType;
            }
            if ($providerResponse !== []) {
                $refund->provider_response = $providerResponse;
            }

            $refund->save();

            if ($returnRequest) {
                $returnRequest->refund_amount = round((float) $returnRefunds + $amount, 2);
                $returnRequest->status = \App\Modules\Shared\Domain\Enums\ReturnStatus::REFUND_PENDING;
                $returnRequest->reviewed_by = $returnRequest->reviewed_by ?? $actor->id;
                $returnRequest->reviewed_at = $returnRequest->reviewed_at ?? now();
                $returnRequest->save();
            }

            PaymentStatusHistory::create([
                'payment_id' => $payment->id,
                'from_status' => $payment->status->value,
                'to_status' => $payment->status->value,
                'reason' => "Refund requested: {$refund->refund_number} (".number_format($amount, 2).').',
                'actor_user_id' => $actor->id,
            ]);

            return $refund;
        });
    }

    public function approve(User $actor, Refund $refund): Refund
    {
        if (! in_array($refund->status->value, [RefundStatus::REQUESTED->value, RefundStatus::PROCESSING->value], true)) {
            throw new DomainException('Refund is not in a requestable state.', 422);
        }

        return DB::transaction(function () use ($actor, $refund) {
            $refund = Refund::query()->whereKey($refund->getKey())->lockForUpdate()->firstOrFail();

            if (! in_array($refund->status->value, [RefundStatus::REQUESTED->value, RefundStatus::PROCESSING->value], true)) {
                throw new DomainException('Refund is not in a requestable state.', 422);
            }

            $refund->status = RefundStatus::APPROVED;
            $refund->initiated_by = $refund->initiated_by ?? $actor->id;
            $refund->save();

            return $refund->load('payment', 'order', 'orderItem');
        });
    }

    public function updateStatus(
        User $actor,
        Refund $refund,
        RefundStatus $status,
        ?string $providerRefundId = null,
        ?array $providerResponse = null
    ): Refund
    {
        return DB::transaction(function () use ($actor, $refund, $status, $providerRefundId, $providerResponse) {
            $refund = Refund::query()->whereKey($refund->getKey())->lockForUpdate()->firstOrFail();
            $oldStatus = $refund->status;

            if ($oldStatus === RefundStatus::REFUNDED) {
                throw new DomainException('A refunded transaction cannot be modified.', 422);
            }

            if ($status === RefundStatus::REFUNDED && $refund->return_request_id) {
                $payment = Payment::query()->find($refund->payment_id);
                if ($payment?->method === 'cod') {
                    $returnRequest = ReturnRequest::query()
                        ->whereKey($refund->return_request_id)
                        ->lockForUpdate()
                        ->firstOrFail();
                    $approvedAmount = (float) $returnRequest->refunds()
                        ->whereIn('status', [
                            RefundStatus::APPROVED->value,
                            RefundStatus::REFUNDED->value,
                        ])
                        ->sum('amount');
                    if (! in_array($refund->status, [RefundStatus::APPROVED, RefundStatus::REFUNDED], true)) {
                        $approvedAmount += (float) $refund->amount;
                    }

                    if (! $returnRequest->cash_refund_handed_at
                        || round((float) $returnRequest->cash_refund_amount, 2) + 0.001 < round($approvedAmount, 2)) {
                        throw new DomainException(
                            'A COD refund can only be completed after the delivery partner confirms the exact cash handoff.',
                            422
                        );
                    }
                }
            }

            $refund->status = $status;
            if ($providerRefundId !== null) {
                $refund->provider_refund_id = $providerRefundId;
            }
            if ($providerResponse !== null) {
                $refund->provider_response = array_merge($refund->provider_response ?? [], $providerResponse);
            }
            $refund->completed_at = in_array($status, [RefundStatus::REFUNDED, RefundStatus::FAILED, RefundStatus::CANCELLED], true)
                ? now()
                : null;
            $refund->save();

            if ($status === RefundStatus::REFUNDED) {
                $payment = Payment::query()->whereKey($refund->payment_id)->lockForUpdate()->first();
                if ($payment) {
                    $completedTotal = (float) $payment->refunds()
                        ->where('status', RefundStatus::REFUNDED->value)
                        ->sum('amount');

                    $from = $payment->status;
                    $payment->status = round($completedTotal, 2) >= round((float) $payment->amount, 2)
                        ? PaymentStatus::REFUNDED
                        : PaymentStatus::PARTIALLY_REFUNDED;
                    $payment->save();

                    if ($from !== $payment->status) {
                        PaymentStatusHistory::create([
                            'payment_id' => $payment->id,
                            'from_status' => $from->value,
                            'to_status' => $payment->status->value,
                            'reason' => "Refund completed: {$refund->refund_number}.",
                            'actor_user_id' => $actor->id,
                        ]);
                    }
                }

                if ($refund->return_request_id) {
                    ReturnRequest::query()
                        ->whereKey($refund->return_request_id)
                        ->update(['status' => \App\Modules\Shared\Domain\Enums\ReturnStatus::REFUNDED->value]);

                    if ($refund->vendor_order_id) {
                        $vo = \App\Modules\Order\Infrastructure\Models\VendorOrder::find($refund->vendor_order_id);
                        if ($vo) {
                            $totalRefunded = (float) $vo->refunds()->where('status', RefundStatus::REFUNDED->value)->sum('amount');
                            if (round($totalRefunded, 2) >= round((float) $vo->grand_total, 2)) {
                                $vo->status = \App\Modules\Shared\Domain\Enums\OrderStatus::RETURNED;
                                $vo->save();
                            }
                        }
                    }
                }

                $this->syncOrderPaymentStatus($refund->order_id);

                // Immediately debit the vendor wallet so the balance is
                // updated in real-time — settlement cycle uses the same
                // idempotency guard so it will not double-debit.
                try {
                    $this->walletService->debitRefund($refund->load('vendorOrder'));
                } catch (\Throwable $e) {
                    // Log but don't fail the refund — wallet can re-sync at settlement
                    \Illuminate\Support\Facades\Log::error('Wallet debit-refund failed', [
                        'refund_id' => $refund->id,
                        'error'     => $e->getMessage(),
                    ]);
                }
            }

            return $refund->load('payment', 'order', 'orderItem');
        });
    }

    private function syncOrderPaymentStatus(int $orderId): void
    {
        $payments = Payment::query()
            ->where('order_id', $orderId)
            ->whereIn('status', [
                PaymentStatus::PAID->value,
                PaymentStatus::PARTIALLY_REFUNDED->value,
                PaymentStatus::REFUNDED->value,
            ])
            ->get();

        if ($payments->isEmpty()) {
            return;
        }

        $paidTotal = (float) $payments->sum('amount');
        $refundedTotal = (float) Refund::query()
            ->where('order_id', $orderId)
            ->where('status', RefundStatus::REFUNDED->value)
            ->sum('amount');

        $status = round($refundedTotal, 2) >= round($paidTotal, 2)
            ? \App\Modules\Shared\Domain\Enums\OrderPaymentStatus::REFUNDED
            : \App\Modules\Shared\Domain\Enums\OrderPaymentStatus::PARTIALLY_REFUNDED;

        Order::query()->whereKey($orderId)->update(['payment_status' => $status->value]);
    }

    public function reject(User $actor, Refund $refund, ?string $reason): Refund
    {
        if (! in_array($refund->status->value, [RefundStatus::REQUESTED->value, RefundStatus::PROCESSING->value], true)) {
            throw new DomainException('Refund is not in a requestable state.', 422);
        }

        $refund->status = RefundStatus::CANCELLED;
        $refund->reason = trim(($refund->reason ?? '').($reason ? " — {$reason}" : ''));
        $refund->completed_at = now();
        $refund->save();

        return $refund->load('payment', 'order', 'orderItem');
    }
}
