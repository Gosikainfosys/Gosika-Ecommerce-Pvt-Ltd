<?php

namespace App\Modules\Payment\Presentation\Http\Controllers;

use App\Modules\Identity\Domain\Permissions;
use App\Modules\Order\Infrastructure\Models\ReturnRequest;
use App\Modules\Payment\Application\Services\PaymentService;
use App\Modules\Payment\Application\Services\RefundService;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Payment\Presentation\Resources\AdminRefundResource;
use App\Modules\Shared\Domain\Enums\RefundStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Validation\Rule;

class AdminRefundController extends Controller
{
    public function __construct(protected RefundService $refundService, protected PaymentService $paymentService)
    {
        $this->middleware('auth:sanctum');
        $this->middleware('admin');
        $this->middleware('permission:'.Permissions::ORDERS_MANAGE.'|'.Permissions::REFUNDS_MANAGE);
    }

    public function updateReturnRefundStatus(Request $request, string $returnId, string $refundId): JsonResponse
    {
        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();
        $refund = Refund::where('return_request_id', $return->id)
            ->where(function ($query) use ($refundId) {
                $query->where('uuid', $refundId);
                if (ctype_digit($refundId)) {
                    $query->orWhere('id', (int) $refundId);
                }
            })
            ->firstOrFail();

        return $this->applyStatusUpdate($request, $refund);
    }

    /**
     * POST /admin/orders/returns/{return}/refunds/{refund}/esewa-process
     *
     * Verifies the refund status at eSewa and, when eSewa confirms the refund
     * is complete, marks the local record as REFUNDED. If eSewa cannot be reached
     * or has not yet processed the refund, returns an actionable error so the
     * admin can either retry later or use the manual-override flow.
     */
    public function processEsewaRefund(Request $request, string $returnId, string $refundId): JsonResponse
    {
        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        $refund = Refund::where('return_request_id', $return->id)
            ->where(function ($query) use ($refundId) {
                $query->where('uuid', $refundId);
                if (ctype_digit($refundId)) {
                    $query->orWhere('id', (int) $refundId);
                }
            })
            ->with('payment')
            ->firstOrFail();

        if ($refund->status->value === RefundStatus::REFUNDED->value) {
            return Response::error('This refund has already been completed.', ['status' => 'refunded'], 422);
        }

        if (! in_array($refund->status->value, [
            RefundStatus::REQUESTED->value,
            RefundStatus::APPROVED->value,
            RefundStatus::PROCESSING->value,
        ], true)) {
            return Response::error('Refund is not in a processable state.', ['status' => $refund->status->value], 422);
        }

        $payment = $refund->payment;

        if (! $payment || $payment->method !== 'esewa') {
            return Response::error('This refund is not linked to an eSewa payment.', [], 422);
        }

        // Check the current status of this transaction at eSewa.
        $check = $this->paymentService->esewaRefundCheck($payment);

        if (! ($check['available'] ?? false)) {
            return Response::error(
                'Could not reach the eSewa status API — process the refund in the eSewa Merchant Portal and use the manual override to mark it complete.',
                ['reason' => $check['reason'] ?? 'unavailable', 'hint' => 'manual_override'],
                502
            );
        }

        $gatewayStatus = strtoupper((string) ($check['status'] ?? ''));

        // eSewa reports refund confirmed.
        if (in_array($gatewayStatus, ['FULL_REFUND', 'PARTIAL_REFUND'], true)) {
            $providerResponse = ['esewa_process' => $check['raw'] ?? $check];

            try {
                $refund = $this->refundService->updateStatus(
                    $request->user(),
                    $refund,
                    RefundStatus::REFUNDED,
                    ($check['ref_id'] ?? '') !== '' ? (string) $check['ref_id'] : $refund->provider_refund_id,
                    $providerResponse
                );
            } catch (DomainException $e) {
                return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
            }

            $typeLabel = $gatewayStatus === 'PARTIAL_REFUND' ? 'Partial refund' : 'Full refund';

            return Response::success(
                new AdminRefundResource($refund->load('payment', 'order', 'orderItem')),
                $typeLabel.' of NPR '.number_format((float) $refund->amount, 2)
                .' verified and synced via eSewa (ref: '.(($check['ref_id'] ?? '') ?: 'N/A').').'
            );
        }

        // Payment has not been refunded at eSewa yet.
        if ($gatewayStatus === 'COMPLETE') {
            return Response::error(
                'eSewa confirms this payment is not yet refunded (status: COMPLETE). '
                .'Open the eSewa Merchant Portal to process the refund, then click this button again.',
                ['gateway_status' => 'COMPLETE', 'merchant_portal' => 'https://merchant.esewa.com.np/'],
                422
            );
        }

        return Response::error(
            'Unexpected eSewa status "'.$gatewayStatus.'". Open the eSewa Merchant Portal to verify the refund manually.',
            ['gateway_status' => $gatewayStatus, 'merchant_portal' => 'https://merchant.esewa.com.np/'],
            422
        );
    }

    private function applyStatusUpdate(Request $request, Refund $refund): JsonResponse
    {
        $request->validate([
            'status' => ['required', Rule::enum(RefundStatus::class)],
            'provider_refund_id' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:500'],
        ]);

        if ($refund->status->value === RefundStatus::REFUNDED->value) {
            return Response::error('A refunded transaction cannot be modified.', ['status' => 'refunded'], 422);
        }

        $newStatus = RefundStatus::from($request->input('status'));
        $message = 'Refund status updated.';
        $providerResponse = [];
        $refund->load('payment');

        if ($newStatus === RefundStatus::REFUNDED && $refund->payment?->method === 'esewa') {
            $check = $this->paymentService->esewaRefundCheck($refund->payment);

            if ($check['available'] ?? false) {
                $gatewayStatus = (string) $check['status'];

                if (in_array($gatewayStatus, ['FULL_REFUND', 'PARTIAL_REFUND'], true)) {
                    if (! $refund->provider_refund_id && $check['ref_id'] !== '') {
                        $refund->provider_refund_id = (string) $check['ref_id'];
                    }

                    $providerResponse['esewa_completed'] = $check['raw'] ?? $check;
                    $message = 'Refund finalized — verified at eSewa (status: '.$gatewayStatus.').';
                } elseif ($gatewayStatus === 'COMPLETE') {
                    return Response::error(
                        'eSewa reports this payment as not yet refunded (status: COMPLETE). Process the refund in the eSewa Merchant Portal, then verify and sync it here.',
                        ['gateway_status' => 'COMPLETE'],
                        422
                    );
                }
            } else {
                $providerResponse['esewa_check'] = [
                    'available' => false,
                    'reason' => $check['reason'] ?? 'unavailable',
                    'message' => $check['message'] ?? null,
                ];
                $message = 'Refund finalized (could not verify with eSewa — confirm the payout from the eSewa merchant dashboard).';
            }
        }

        try {
            $refund = $this->refundService->updateStatus(
                $request->user(),
                $refund,
                $newStatus,
                $request->input('provider_refund_id') ?? $refund->provider_refund_id,
                $providerResponse ?: null
            );
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }

        return Response::success(
            new AdminRefundResource($refund->load('payment', 'order', 'orderItem')),
            $message
        );
    }
}
