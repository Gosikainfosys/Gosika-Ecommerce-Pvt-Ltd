<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Database\Eloquent\Collection;
use InvalidArgumentException;

/**
 * Creates the hierarchical delivery coverage areas configured from
 * Shipping & Delivery. Province, district and municipality areas reuse the
 * verified imported boundary. Ward areas use an admin-drawn polygon because
 * no verified ADM4 dataset exists.
 */
class CoverageAreaService
{
    public function __construct(
        private readonly GeoBoundaryService $boundaries,
        private readonly CustomCoveragePolygonService $polygons,
        private readonly WardLookupService $wards,
    ) {
    }

    public function create(array $data, int $userId): CustomCoveragePolygon
    {
        $provinceId = (int) ($data['province_id'] ?? 0);
        $districtId = $this->nullableId($data['district_id'] ?? null);
        $municipalityId = $this->nullableId($data['municipality_id'] ?? null);
        $wardId = $this->nullableId($data['ward_id'] ?? null);
        $wardNumber = $this->nullableId($data['ward_number'] ?? null);

        $isWardArea = $wardId !== null || $wardNumber !== null;

        if ($isWardArea && ! $municipalityId) {
            throw new InvalidArgumentException('A municipality is required for a ward coverage area.');
        }

        if ($isWardArea) {
            $wardId = $this->resolveWard($municipalityId, $wardId, $wardNumber);
        }

        if ($isWardArea) {
            $type = 'ward';
            $geoId = $wardId;
            $geometry = $data['geometry'] ?? null;
            if (! $geometry) {
                throw new InvalidArgumentException('Draw a ward coverage polygon before saving.');
            }
            $displayGeometry = $geometry;
            $validated = $this->polygons->validateGeometry($geometry);
            $geometry = $validated['geometry'];
            $source = 'Admin-drawn ward area';
            $sourceUrl = null;
            $reason = trim((string) ($data['reason'] ?? ''));
            if ($reason === '') {
                throw new InvalidArgumentException('A documented reason is required for a ward coverage area.');
            }
        } else {
            [$type, $geoId] = $this->administrativeTarget($provinceId, $districtId, $municipalityId);
            $boundary = $this->boundaries->findBoundary($type, $geoId);
            if (! $boundary) {
                throw new InvalidArgumentException(
                    'No verified administrative boundary is available for the selected area.'
                );
            }

            $validated = $this->polygons->validateGeometry($boundary->geometry);
            $geometry = $validated['geometry'];
            $displayGeometry = $boundary->display_geometry ?: $geometry;
            $source = $boundary->source ?: 'Verified administrative boundary';
            $sourceUrl = $boundary->source_url;
            $reason = trim((string) ($data['reason'] ?? ''))
                ?: 'Verified administrative boundary selected in Shipping & Delivery.';
        }

        $attributes = [
            'name' => trim((string) ($data['name'] ?? '')),
            'description' => $data['description'] ?? null,
            'reason' => $reason,
            'is_coverage_area' => true,
            'province_id' => $provinceId,
            'district_id' => $districtId,
            'municipality_id' => $municipalityId,
            'ward_id' => $wardId,
            'geometry' => $geometry,
            'display_geometry' => $displayGeometry,
            'bbox_min_lng' => $validated['bbox']['min_lng'] ?? null,
            'bbox_min_lat' => $validated['bbox']['min_lat'] ?? null,
            'bbox_max_lng' => $validated['bbox']['max_lng'] ?? null,
            'bbox_max_lat' => $validated['bbox']['max_lat'] ?? null,
            'source' => $source,
            'source_url' => $sourceUrl,
            'verification_status' => CustomCoveragePolygon::STATUS_VERIFIED,
            'verified_at' => now(),
            'verified_by' => $userId,
            'expires_at' => null,
            'is_active' => (bool) ($data['is_active'] ?? true),
            'created_by' => $userId,
            'updated_by' => $userId,
        ];

        return $this->polygons->create($attributes);
    }

    public function destroy(CustomCoveragePolygon $area): void
    {
        if (! $area->is_coverage_area) {
            throw new InvalidArgumentException('This polygon is not a coverage area.');
        }

        $area->delete();
    }

    /**
     * All coverage areas and custom polygons that should be visible on the
     * public admin coverage map, including pending ones with their status.
     */
    public function mapAreas(): Collection
    {
        return CustomCoveragePolygon::query()
            ->with(['province', 'district', 'municipality', 'ward'])
            ->latest()
            ->limit(500)
            ->get();
    }

    private function resolveWard(?int $municipalityId, ?int $wardId, ?int $wardNumber): int
    {
        if ($wardId !== null) {
            $ward = Ward::query()
                ->whereKey($wardId)
                ->where('municipality_id', $municipalityId)
                ->first();

            if (! $ward) {
                throw new InvalidArgumentException('The selected ward does not belong to the selected municipality.');
            }

            return (int) $ward->id;
        }

        return (int) $this->wards->findOrCreate($municipalityId, (int) $wardNumber)->id;
    }

    private function administrativeTarget(int $provinceId, ?int $districtId, ?int $municipalityId): array
    {
        if ($municipalityId) {
            return ['municipality', $municipalityId];
        }

        if ($districtId) {
            return ['district', $districtId];
        }

        return ['province', $provinceId];
    }

    private function nullableId(mixed $value): ?int
    {
        if ($value === null || $value === '' || $value === false) {
            return null;
        }

        return (int) $value;
    }
}
