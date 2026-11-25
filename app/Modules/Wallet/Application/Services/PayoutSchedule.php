<?php

namespace App\Modules\Wallet\Application\Services;

use Carbon\Carbon;
use InvalidArgumentException;

class PayoutSchedule
{
    private const TIMEZONE = 'Asia/Kathmandu';

    public static function allowsRequest(string $frequency, ?Carbon $at = null): bool
    {
        $localDate = ($at ?? Carbon::now())->copy()->setTimezone(self::TIMEZONE);

        return match ($frequency) {
            'manual', 'daily' => true,
            'weekly' => $localDate->isSunday(),
            'biweekly' => in_array($localDate->day, [1, 15], true),
            'monthly' => $localDate->day === 1,
            default => throw new InvalidArgumentException('Unsupported payout frequency: '.$frequency),
        };
    }

    public static function requestWindowLabel(string $frequency): string
    {
        return match ($frequency) {
            'manual' => 'any day (manual on-demand)',
            'daily' => 'any day (daily batch)',
            'weekly' => 'Sunday',
            'biweekly' => 'the 1st or 15th of the month',
            'monthly' => 'the 1st of the month',
            default => throw new InvalidArgumentException('Unsupported payout frequency: '.$frequency),
        };
    }

    public static function closedMessage(string $frequency): string
    {
        return 'Payout requests are only accepted on '.self::requestWindowLabel($frequency).' (Nepal time).';
    }
}
