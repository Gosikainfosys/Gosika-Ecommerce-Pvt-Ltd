<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;

class DeliveryLocationResolver
{
    public function __construct(private readonly WardLookupService $wards)
    {
    }

    private const ID_MODELS = [
        'province_id' => Province::class,
        'district_id' => District::class,
        'municipality_id' => Municipality::class,
        'ward_id' => Ward::class,
    ];

    /**
     * Resolve UUID or numeric geographic identifiers into a delivery location.
     *
     * Defaults are used only when a key is absent from the incoming data.
     */
    public function resolve(array $data, array $defaults = []): DeliveryLocation
    {
        $resolved = [];

        foreach (array_keys(self::ID_MODELS) as $field) {
            $value = array_key_exists($field, $data) ? $data[$field] : ($defaults[$field] ?? null);
            $resolved[$field] = $this->resolveId($field, $value);
        }

        // A ward number is an administrative identifier, not a polygon. It is
        // resolved only when the municipality is known so all clients share
        // the same ward numbering.
        if (! $resolved['ward_id'] && $resolved['municipality_id']) {
            $wardNumber = array_key_exists('ward_number', $data)
                ? $data['ward_number']
                : ($defaults['ward_number'] ?? null);

            $resolved['ward_id'] = $this->wards->resolveId(
                $resolved['municipality_id'],
                null,
                $wardNumber
            );
        }

        $resolved['lat'] = $this->firstCoordinate($data, $defaults, 'lat', 'latitude');
        $resolved['lng'] = $this->firstCoordinate($data, $defaults, 'lng', 'longitude');

        return DeliveryLocation::fromArray($resolved);
    }

    private function resolveId(string $field, mixed $value): ?int
    {
        if ($value === null || $value === '') {
            return null;
        }

        if (is_numeric($value)) {
            return (int) $value;
        }

        $model = self::ID_MODELS[$field];

        return $model::where('uuid', (string) $value)->value('id');
    }

    private function firstCoordinate(array $data, array $defaults, string $shortKey, string $longKey): mixed
    {
        foreach ([$shortKey, $longKey] as $key) {
            if (array_key_exists($key, $data)) {
                return $data[$key];
            }
            if (array_key_exists($key, $defaults)) {
                return $defaults[$key];
            }
        }

        return null;
    }
}
