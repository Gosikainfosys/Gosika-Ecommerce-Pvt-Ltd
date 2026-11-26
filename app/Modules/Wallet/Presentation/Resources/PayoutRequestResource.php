<?php

namespace App\Modules\Wallet\Presentation\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class PayoutRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->uuid,
            'ledger_reference_id' => (int) $this->getKey(),
            'payout_number' => $this->payout_number,
            'vendor_id' => $this->vendor?->uuid,
            'vendor_name' => $this->whenLoaded('vendor', fn () => $this->vendor?->company_name),
            'settlement_id' => $this->settlement?->uuid,
            'funding_source' => $this->funding_source,
            'settlement' => $this->whenLoaded('settlement', fn () => $this->settlement ? [
                'id' => $this->settlement->uuid,
                'settlement_number' => $this->settlement->settlement_number,
                'status' => $this->settlement->status->value,
            ] : null),
            'amount' => number_format((float) $this->amount, 2, '.', ''),
            'status' => $this->status->value,
            'requested_at' => $this->requested_at?->toISOString(),
            'approved_at' => $this->approved_at?->toISOString(),
            'paid_at' => $this->paid_at?->toISOString(),
            'rejection_reason' => $this->rejection_reason,
            'bank_account' => $this->whenLoaded('bankAccount', fn () => $this->bankAccount ? [
                'id' => $this->bankAccount->uuid,
                'bank_name' => $this->bankAccount->bank_name,
                'branch_name' => $this->bankAccount->branch_name,
                'account_name' => $this->bankAccount->account_name,
                'account_number' => $this->bankAccount->account_number,
                'account_type' => $this->bankAccount->account_type,
                'is_verified' => $this->bankAccount->is_verified,
                'is_default' => $this->bankAccount->is_default,
            ] : null),
            'records' => $this->whenLoaded('records', fn () => $this->records->map(fn ($r) => [
                'id' => $r->uuid,
                'provider_reference' => $r->provider_reference,
                'amount' => number_format((float) $r->amount, 2, '.', ''),
                'fee' => number_format((float) $r->fee, 2, '.', ''),
                'net_amount' => number_format((float) $r->net_amount, 2, '.', ''),
                'status' => $r->status,
                'paid_at' => $r->paid_at?->toISOString(),
                'notes' => data_get($r->meta, 'notes'),
                'proofs' => collect(data_get($r->meta, 'proofs', []))
                    ->values()
                    ->map(fn (array $proof, int $index) => [
                        'index' => $index,
                        'name' => $proof['name'] ?? 'Payout proof',
                        'mime_type' => $proof['mime_type'] ?? 'application/octet-stream',
                        'size' => $proof['size'] ?? null,
                    ]),
            ])),
        ];
    }
}
