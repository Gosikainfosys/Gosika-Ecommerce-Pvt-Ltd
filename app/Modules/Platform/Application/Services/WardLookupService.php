<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Validation\ValidationException;

/**
 * Resolves administrative ward identifiers.
 *
 * A ward record is only a named/numbered administrative unit. It never
 * contains boundary geometry; verified polygons remain in geo_boundaries.
 */
class WardLookupService
{
    public function find(int $municipalityId, int $wardNumber): ?Ward
    {
        return Ward::query()
            ->where('municipality_id', $municipalityId)
            ->where('ward_number', $wardNumber)
            ->first();
    }

    public function findOrCreate(int $municipalityId, int $wardNumber): Ward
    {
        if (! Municipality::whereKey($municipalityId)->exists()) {
            throw ValidationException::withMessages([
                'municipality_id' => 'The selected municipality does not exist.',
            ]);
        }

        return Ward::firstOrCreate(
            ['municipality_id' => $municipalityId, 'ward_number' => $wardNumber],
            ['is_active' => true, 'name' => null, 'code' => null]
        );
    }

    public function resolveId(?int $municipalityId, mixed $wardId, mixed $wardNumber, bool $create = false): ?int
    {
        if (! $municipalityId) {
            return null;
        }

        if ($wardId !== null && $wardId !== '') {
            $ward = Ward::query()
                ->whereKey((int) $wardId)
                ->where('municipality_id', $municipalityId)
                ->first();

            return $ward?->id;
        }

        if ($wardNumber === null || $wardNumber === '') {
            return null;
        }

        $number = (int) $wardNumber;
        if ($number < 1 || $number > 99) {
            return null;
        }

        $ward = $create
            ? $this->findOrCreate($municipalityId, $number)
            : $this->find($municipalityId, $number);

        return $ward?->id;
    }
}
