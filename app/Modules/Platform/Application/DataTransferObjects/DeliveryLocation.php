<?php

namespace App\Modules\Platform\Application\DataTransferObjects;

final class DeliveryLocation
{
    public function __construct(
        public readonly int $provinceId,
        public readonly ?int $districtId = null,
        public readonly ?int $municipalityId = null,
        public readonly ?int $wardId = null,
        public readonly ?float $lat = null,
        public readonly ?float $lng = null,
    ) {
    }

    public static function fromArray(array $data): self
    {
        return new self(
            provinceId: (int) ($data['province_id'] ?? 0),
            districtId: self::nullableInt($data['district_id'] ?? null),
            municipalityId: self::nullableInt($data['municipality_id'] ?? null),
            wardId: self::nullableInt($data['ward_id'] ?? null),
            lat: self::nullableFloat($data['lat'] ?? null),
            lng: self::nullableFloat($data['lng'] ?? null),
        );
    }

    public function hasCoordinates(): bool
    {
        return $this->lat !== null && $this->lng !== null;
    }

    public function toArray(): array
    {
        return [
            'province_id' => $this->provinceId,
            'district_id' => $this->districtId,
            'municipality_id' => $this->municipalityId,
            'ward_id' => $this->wardId,
            'lat' => $this->lat,
            'lng' => $this->lng,
        ];
    }

    public function boundaryTarget(): ?array
    {
        if ($this->wardId) {
            return ['type' => 'ward', 'id' => $this->wardId];
        }

        if ($this->municipalityId) {
            return ['type' => 'municipality', 'id' => $this->municipalityId];
        }

        if ($this->districtId) {
            return ['type' => 'district', 'id' => $this->districtId];
        }

        if ($this->provinceId > 0) {
            return ['type' => 'province', 'id' => $this->provinceId];
        }

        return null;
    }

    private static function nullableInt(mixed $value): ?int
    {
        return $value === null || $value === '' ? null : (int) $value;
    }

    private static function nullableFloat(mixed $value): ?float
    {
        return $value === null || $value === '' ? null : (float) $value;
    }
}
