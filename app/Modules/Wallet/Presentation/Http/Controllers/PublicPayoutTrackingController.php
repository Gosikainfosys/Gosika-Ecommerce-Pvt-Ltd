<?php

namespace App\Modules\Wallet\Presentation\Http\Controllers;

use App\Modules\Shared\Presentation\Http\Response;
use App\Modules\Wallet\Application\Services\PayoutTrackingToken;
use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class PublicPayoutTrackingController extends Controller
{
    public function show(Request $request, string $payoutId, PayoutTrackingToken $trackingToken): JsonResponse
    {
        $payout = PayoutRequest::query()
            ->with(['vendor:id,company_name', 'records'])
            ->where('uuid', $payoutId)
            ->firstOrFail();

        $providedToken = (string) $request->query('token', '');
        abort_unless(hash_equals($trackingToken->generate($payout), $providedToken), 404);

        $record = $payout->records->sortBy('id')->last();
        $updatedAt = $payout->updated_at;
        if ($record?->updated_at && (! $updatedAt || $record->updated_at->gt($updatedAt))) {
            $updatedAt = $record->updated_at;
        }

        return Response::success([
            'payout_number' => $payout->payout_number,
            'vendor_name' => $payout->vendor?->company_name,
            'amount' => number_format((float) $payout->amount, 2, '.', ''),
            'status' => $payout->status->value,
            'paid_at' => $payout->paid_at?->toISOString(),
            'provider_reference' => $record?->provider_reference ?? data_get($payout->meta, 'provider_reference'),
            'updated_at' => $updatedAt?->toISOString(),
        ], 'Current payout status from Gosika.')
            ->header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    }
}
