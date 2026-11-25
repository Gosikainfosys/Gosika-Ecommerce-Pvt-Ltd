<?php

namespace App\Modules\Wallet\Presentation\Resources;

use App\Modules\Platform\Infrastructure\Models\Setting;
use App\Modules\Wallet\Application\Services\PayoutSchedule;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WalletResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $returnWindowDays = max(1, (int) Setting::get('return.window_days', 7));
        $settlementCycleDays = max(1, (int) ($this->vendor?->meta['settlement_cycle_days'] ?? 14));
        $settlementHoldingDays = max(0, (int) Setting::get('settlement.waiting_days', 7));
        $requiresManualApproval = Setting::get('settlement.require_manual_payout_approval', true);
        $payoutsEnabled = Setting::get('commission.vendor_payouts_enabled', true);
        $payoutFrequency = (string) Setting::get('settlement.payout_frequency', 'weekly');

        return [
            'id' => $this->uuid,
            'vendor_id' => $this->vendor?->uuid,
            'vendor_name' => $this->whenLoaded('vendor', fn () => $this->vendor?->company_name),
            'balance' => number_format((float) $this->balance, 2, '.', ''),
            'available_balance' => number_format((float) $this->available_balance, 2, '.', ''),
            'pending_balance' => number_format((float) $this->pending_balance, 2, '.', ''),
            'minimum_payout_amount' => number_format((float) Setting::get('settlement.min_payout_amount', 1000), 2, '.', ''),
            'payout_frequency' => $payoutFrequency,
            'payout_request_window_open' => PayoutSchedule::allowsRequest($payoutFrequency),
            'payout_request_window_label' => PayoutSchedule::requestWindowLabel($payoutFrequency),
            'requires_manual_payout_approval' => in_array($requiresManualApproval, [true, 1, '1', 'true'], true),
            'vendor_payouts_enabled' => in_array($payoutsEnabled, [true, 1, '1', 'true'], true),
            'settlement_holding_days' => $settlementHoldingDays,
            'return_window_days' => $returnWindowDays,
            'settlement_cycle_days' => $settlementCycleDays,
            'earnings_maturity_days' => $settlementHoldingDays,
            'currency' => $this->currency,
            'version' => $this->version,
            'created_at' => $this->created_at?->toISOString(),
        ];
    }
}
