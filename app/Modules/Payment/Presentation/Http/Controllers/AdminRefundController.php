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
     * Trigger an eSewa refund directly via their Refund API, then mark the refund as REFUNDED.
     *
     * POST /admin/orders/returns/{return}/refunds/{refund}/esewa-process
     *
     * Optional body: { amount: float }  — override the stored refund amount for partial payouts.
     */
    public function processEsewaRefund(Request $request, string $returnId, string $refundId): JsonResponse
    {
        $request->validate([
            'amount' => ['nullable', 'numeric', 'min:0.01'],
        ]);

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

        // Use caller-supplied amount for partial payouts; otherwise use the stored refund amount.
        $refundAmount = $request->filled('amount')
            ? (float) $request->input('amount')
            : (float) $refund->amount;

        if ($refundAmount <= 0 || $refundAmount > round((float) $refund->amount + 0.001, 2)) {
            return Response::error(
                'Refund amount must be between 0.01 and '.number_format((float) $refund->amount, 2).'.',
                ['max' => (float) $refund->amount],
                422
            );
        }

        // Call the eSewa Refund API
        $result = $this->paymentService->esewaRefund($payment, $refundAmount);

        if (! ($result['success'] ?? false)) {
            return Response::error(
                $result['message'] ?? 'eSewa refund failed.',
                ['esewa_response' => $result['raw'] ?? null],
                422
            );
        }

        $esewaStatus = $result['status']; // 'FULL_REFUND' or 'PARTIAL_REFUND'

        // Mark the refund as REFUNDED and store the eSewa ref_id and raw response
        try {
            $refund = $this->refundService->updateStatus(
                $request->user(),
                $refund,
                RefundStatus::REFUNDED,
                $result['ref_id'] !== '' ? $result['ref_id'] : null,
                ['esewa_refund' => $result['raw'], 'esewa_refund_type' => $esewaStatus]
            );
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }

        $typeLabel = $esewaStatus === 'PARTIAL_REFUND' ? 'Partial refund' : 'Full refund';

        return Response::success(
            new AdminRefundResource($refund->load('payment', 'order', 'orderItem')),
            $typeLabel.' of NPR '.number_format($refundAmount, 2).' processed via eSewa'
                .' (ref: '.($result['ref_id'] ?: 'N/A').').'
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
                        'eSewa reports this payment as not yet refunded (status: COMPLETE). Use "Process via eSewa" to trigger the refund directly, or confirm the payout from the eSewa merchant dashboard before marking as refunded.',
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
