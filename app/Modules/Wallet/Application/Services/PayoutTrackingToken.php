<?php

namespace App\Modules\Wallet\Application\Services;

use App\Modules\Wallet\Infrastructure\Models\PayoutRequest;
use RuntimeException;

class PayoutTrackingToken
{
    public function generate(PayoutRequest $payout): string
    {
        $key = (string) config('app.key');
        if ($key === '') {
            throw new RuntimeException('The application key is required to generate payout tracking links.');
        }

        return hash_hmac('sha256', 'payout-tracking:'.$payout->uuid, $key);
    }
}
