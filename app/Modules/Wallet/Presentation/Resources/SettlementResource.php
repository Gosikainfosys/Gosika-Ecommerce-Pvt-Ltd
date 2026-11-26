<?php

namespace App\Modules\Wallet\Presentation\Resources;

use App\Modules\Shared\Domain\Enums\PayoutStatus;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use App\Modules\Wallet\Infrastructure\Models\Settlement;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SettlementResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $status = $this->status->value;
        if ($status === 'paid') {
            $hasPaidPayout = $this->relationLoaded('payoutRequests')
                ? $this->payoutRequests->contains(fn ($payout) => $payout->status->value === 'paid')
                : $this->payoutRequests()->where('status', 'paid')->exists();

            if (! $hasPaidPayout) {
                $status = $this->hasBeenWithdrawnFromAvailableBalance($request) ? 'paid' : 'released';
            }
        }

        return [
            'id' => $this->uuid,
            'ledger_reference_id' => (int) $this->getKey(),
            'settlement_number' => $this->settlement_number,
            'vendor_id' => $this->vendor?->uuid,
            'vendor_name' => $this->whenLoaded('vendor', fn () => $this->vendor?->company_name),
            'period_start' => $this->period_start?->toDateString(),
            'period_end' => $this->period_end?->toDateString(),
            'gross_sales' => number_format((float) $this->gross_sales, 2, '.', ''),
            'commission_total' => number_format((float) $this->commission_total, 2, '.', ''),
            'refunds_total' => number_format((float) $this->refunds_total, 2, '.', ''),
            'adjustments_total' => number_format((float) $this->adjustments_total, 2, '.', ''),
            'net_payable' => number_format((float) $this->net_payable, 2, '.', ''),
            'status' => $status,
            'hold_reason' => $this->hold_reason,
            'orders_count' => count($this->meta['vendor_order_ids'] ?? []),
            'generated_at' => $this->generated_at?->toISOString(),
            'paid_at' => $this->paid_at?->toISOString(),
            'payout_requests' => $this->whenLoaded('payoutRequests', fn () => $this->payoutRequests->map(fn ($p) => [
                'id' => $p->uuid,
                'payout_number' => $p->payout_number,
                'amount' => number_format((float) $p->amount, 2, '.', ''),
                'status' => $p->status->value,
            ])),
        ];
    }

    private function hasBeenWithdrawnFromAvailableBalance(Request $request): bool
    {
        $cacheKey = 'wallet.paid_available_balance_settlements.'.$this->vendor_id;
        $withdrawnSettlementIds = $request->attributes->get($cacheKey);

        if (! is_array($withdrawnSettlementIds)) {
            $releasedSettlements = Settlement::query()
                ->where('vendor_id', $this->vendor_id)
                ->where('status', 'paid')
                ->whereDoesntHave('payoutRequests', fn ($query) => $query
                    ->where('status', PayoutStatus::PAID->value))
                ->orderBy('id')
                ->get(['id', 'net_payable']);
            $remainingPaidPayouts = (float) PayoutRequest::query()
                ->where('vendor_id', $this->vendor_id)
                ->whereNull('settlement_id')
                ->where('status', PayoutStatus::PAID->value)
                ->sum('amount');
            $withdrawnSettlementIds = [];

            foreach ($releasedSettlements as $settlement) {
                $settlementAmount = max(0, (float) $settlement->net_payable);

                if ($remainingPaidPayouts + 0.001 < $settlementAmount) {
                    break;
                }

                $withdrawnSettlementIds[] = (int) $settlement->id;
                $remainingPaidPayouts -= $settlementAmount;
            }

            $request->attributes->set($cacheKey, $withdrawnSettlementIds);
        }

        return in_array((int) $this->getKey(), $withdrawnSettlementIds, true);
    }
}
