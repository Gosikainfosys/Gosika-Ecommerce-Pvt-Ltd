<?php

namespace App\Modules\Wallet\Application\Services;

use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class PayoutProofDownload
{
    public function download(PayoutRequest $payout, string $recordUuid, int $proofIndex): StreamedResponse
    {
        if ($proofIndex < 0) {
            throw new DomainException('Payout proof not found.', 404);
        }

        $record = $payout->records()->where('uuid', $recordUuid)->first();
        $proof = data_get($record?->meta, 'proofs.'.$proofIndex);
        $path = is_array($proof) ? ($proof['path'] ?? null) : null;

        if (! $path || ! Storage::disk('local')->exists($path)) {
            throw new DomainException('Payout proof not found.', 404);
        }

        $name = preg_replace('/[\x00-\x1F\x7F"\\\\]/', '_', (string) ($proof['name'] ?? basename($path)));
        $mimeType = (string) ($proof['mime_type'] ?? 'application/octet-stream');

        return Storage::disk('local')->download($path, $name ?: basename($path), [
            'Content-Type' => $mimeType,
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }
}
