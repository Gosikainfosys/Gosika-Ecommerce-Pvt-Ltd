<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use Illuminate\Database\Eloquent\Collection;
use InvalidArgumentException;

class CustomCoveragePolygonService
{
    private const SPECIFICITY_ORDER = ['ward' => 4, 'municipality' => 3, 'district' => 2, 'province' => 1];

    public function __construct(private readonly GeoBoundaryService $boundaries)
    {
    }

    public function validateGeometry(mixed $geometry): array
    {
        $decoded = $this->decode($geometry);
        $validation = $this->boundaries->validateGeometry($decoded);

        if (! $validation['valid']) {
            throw new InvalidArgumentException(implode(' ', $validation['errors']));
        }

        return [
            'geometry' => $decoded,
            'bbox' => $validation['bbox'],
        ];
    }

    public function create(array $data): CustomCoveragePolygon
    {
        $validated = $this->prepare($data);

        return CustomCoveragePolygon::create($validated)->fresh();
    }

    public function update(CustomCoveragePolygon $polygon, array $data): CustomCoveragePolygon
    {
        $polygon->update($this->prepare($data, $polygon));

        return $polygon->fresh();
    }

    public function verify(CustomCoveragePolygon $polygon, int $userId): CustomCoveragePolygon
    {
        $polygon->forceFill([
            'verification_status' => CustomCoveragePolygon::STATUS_VERIFIED,
            'verified_at' => now(),
            'verified_by' => $userId,
        ])->save();

        return $polygon->fresh();
    }

    public function reject(CustomCoveragePolygon $polygon, int $userId): CustomCoveragePolygon
    {
        $polygon->forceFill([
            'verification_status' => CustomCoveragePolygon::STATUS_REJECTED,
            'verified_at' => now(),
            'verified_by' => $userId,
        ])->save();

        return $polygon->fresh();
    }

    /**
     * Verified, active custom polygons whose hierarchy contains this location.
     */
    public function usableFor(DeliveryLocation $location, ?bool $coverageAreaOnly = null): Collection
    {
        return CustomCoveragePolygon::query()
            ->usable()
            ->when(
                $coverageAreaOnly !== null,
                fn ($query) => $query->where('is_coverage_area', $coverageAreaOnly)
            )
            ->where(function ($query) use ($location) {
                $query->where(function ($q) use ($location) {
                    $q->whereNull('district_id')
                        ->whereNull('municipality_id')
                        ->whereNull('ward_id')
                        ->where('province_id', $location->provinceId);
                });

                if ($location->districtId) {
                    $query->orWhere(function ($q) use ($location) {
                        $q->where('district_id', $location->districtId)
                            ->whereNull('municipality_id')
                            ->whereNull('ward_id');
                    });
                }

                if ($location->municipalityId) {
                    $query->orWhere(function ($q) use ($location) {
                        $q->where('municipality_id', $location->municipalityId)
                            ->whereNull('ward_id');
                    });
                }

                if ($location->wardId) {
                    $query->orWhere('ward_id', $location->wardId);
                }
            })
            ->get()
            ->sort(function (CustomCoveragePolygon $a, CustomCoveragePolygon $b) {
                return [
                    self::specificity($b),
                    $b->id,
                ] <=> [
                    self::specificity($a),
                    $a->id,
                ];
            })
            ->values();
    }

    public function findContaining(DeliveryLocation $location, ?bool $coverageAreaOnly = null): ?CustomCoveragePolygon
    {
        if (! $location->hasCoordinates()) {
            return null;
        }

        foreach ($this->usableFor($location, $coverageAreaOnly) as $polygon) {
            if ($this->boundaries->containsPoint($polygon->geometry, $location->lng, $location->lat)) {
                return $polygon;
            }
        }

        return null;
    }

    /**
     * Whether any coverage area has been configured. Once one exists, the
     * created areas are the complete allow-list even if that area is later
     * deactivated; the system must not silently fall back to legacy rules.
     */
    public function hasAnyCoverageAreas(): bool
    {
        return CustomCoveragePolygon::query()
            ->where('is_coverage_area', true)
            ->exists();
    }

    private function prepare(array $data, ?CustomCoveragePolygon $polygon = null): array
    {
        $result = $data;

        if (array_key_exists('geometry', $data)) {
            $validated = $this->validateGeometry($data['geometry']);
            $result['geometry'] = $validated['geometry'];
            $result = $this->mergeBbox($result, $validated['bbox']);
        } elseif (! $polygon) {
            throw new InvalidArgumentException('A geometry is required.');
        }

        if (array_key_exists('display_geometry', $data) && $data['display_geometry'] !== null) {
            $display = $this->decode($data['display_geometry']);
            $displayValidation = $this->boundaries->validateGeometry($display);
            if (! $displayValidation['valid']) {
                throw new InvalidArgumentException(implode(' ', $displayValidation['errors']));
            }
            $result['display_geometry'] = $display;
        }

        return $result;
    }

    private function mergeBbox(array $data, ?array $bbox): array
    {
        if (! $bbox) {
            return $data;
        }

        return array_merge($data, [
            'bbox_min_lng' => $bbox['min_lng'],
            'bbox_min_lat' => $bbox['min_lat'],
            'bbox_max_lng' => $bbox['max_lng'],
            'bbox_max_lat' => $bbox['max_lat'],
        ]);
    }

    private function decode(mixed $geometry): mixed
    {
        if (is_string($geometry)) {
            $decoded = json_decode($geometry, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                throw new InvalidArgumentException('Geometry must be valid GeoJSON.');
            }

            return $decoded;
        }

        return $geometry;
    }

    private static function specificity(CustomCoveragePolygon $polygon): int
    {
        if ($polygon->ward_id) {
            return self::SPECIFICITY_ORDER['ward'];
        }

        if ($polygon->municipality_id) {
            return self::SPECIFICITY_ORDER['municipality'];
        }

        if ($polygon->district_id) {
            return self::SPECIFICITY_ORDER['district'];
        }

        return self::SPECIFICITY_ORDER['province'];
    }
}
