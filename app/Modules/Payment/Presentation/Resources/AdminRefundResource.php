<?php

namespace App\Modules\Payment\Presentation\Resources;

use App\Modules\Identity\Presentation\Resources\UserResource;
use App\Modules\Order\Presentation\Resources\OrderItemResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AdminRefundResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'refund_number' => $this->refund_number,
            'payment_id' => $this->payment?->uuid,
            'payment_number' => $this->payment?->payment_number,
            'order_id' => $this->order?->uuid,
            'order_number' => $this->order?->order_number,
            'customer' => new UserResource($this->whenLoaded('order.user')),
            'amount' => number_format((float) $this->amount, 2, '.', ''),
            'currency' => $this->payment?->currency ?? 'NPR',
            'status' => $this->status->value,
            'refund_type' => $this->resolveRefundType(),
            'reason' => $this->reason,
            'provider_refund_id' => $this->provider_refund_id,
            'order_item' => $this->orderItem ? [
                'id' => $this->orderItem->uuid,
                'product_name' => $this->orderItem->product_name,
                'sku' => $this->orderItem->sku,
                'image' => $this->orderItem->image,
                'quantity' => $this->orderItem->quantity,
                'line_total' => number_format((float) $this->orderItem->line_total, 2, '.', ''),
            ] : null,
            'initiated_at' => $this->initiated_at?->toISOString(),
            'completed_at' => $this->completed_at?->toISOString(),
            'created_at' => $this->created_at?->toISOString(),
        ];
    }

    /**
     * Resolve the refund type as 'full' or 'partial'.
     *
     * Priority:
     *  1. Stored in provider_response.refund_type (set at creation time).
     *  2. Derived from the eSewa gateway status written at completion time.
     *  3. Determined by comparing this refund's amount against the order-item
     *     line total (accounting for the return quantity), which catches records
     *     created before refund_type was persisted.
     *  4. Falls back to 'full' as the safest default.
     */
    private function resolveRefundType(): string
    {
        // 1. Explicitly stored at creation.
        $stored = data_get($this->provider_response, 'refund_type');
        if (in_array($stored, ['full', 'partial'], true)) {
            return $stored;
        }

        // 2. Derived from eSewa gateway confirmation.
        $esewaType = data_get($this->provider_response, 'esewa_refund_type')
            ?? data_get($this->provider_response, 'esewa_process.status');
        if ($esewaType === 'FULL_REFUND') {
            return 'full';
        }
        if ($esewaType === 'PARTIAL_REFUND') {
            return 'partial';
        }

        // 3. Amount-based fallback for legacy records.
        if ($this->orderItem) {
            $qty = max(1, (int) $this->orderItem->quantity);
            $returnQty = $qty;
            if ($this->return_request_id) {
                $rr = \App\Modules\Order\Infrastructure\Models\ReturnRequest::find($this->return_request_id);
                if ($rr) {
                    $returnQty = max(1, (int) $rr->quantity);
                }
            }
            $refundableAmt = round((float) $this->orderItem->line_total / $qty * $returnQty, 2);
            if ($refundableAmt > 0) {
                return round((float) $this->amount, 2) >= $refundableAmt - 0.01 ? 'full' : 'partial';
            }
        }

        // 4. Ultimate fallback.
        return 'full';
    }
}
