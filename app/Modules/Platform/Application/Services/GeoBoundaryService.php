<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;

class GeoBoundaryService
{
    public const GEO_TYPES = ['country', 'province', 'district', 'municipality', 'ward'];

    /** Nepal's approximate outer envelope; used only as a sanity check, never for validation. */
    public const NEPAL_BOUNDS = [
        'min_lng' => 79.0,
        'min_lat' => 25.0,
        'max_lng' => 91.0,
        'max_lat' => 33.0,
    ];

    private const INTERSECTION_GRID_SIZE = 0.02;
    private const INTERSECTION_MAX_SEGMENTS = 20000;
    private const INTERSECTION_MAX_PAIR_TESTS = 2000000;

    public function findBoundary(string $geoType, int $geoId, ?string $datasetVersion = null): ?GeoBoundary
    {
        $key = $this->cacheKey($geoType, $geoId, $datasetVersion);

        return Cache::remember($key, now()->addHours(6), function () use ($geoType, $geoId, $datasetVersion) {
            return GeoBoundary::query()
                ->active()
                ->verified()
                ->forGeo($geoType, $geoId)
                ->when($datasetVersion, fn ($q) => $q->where('dataset_version', $datasetVersion))
                ->latest('imported_at')
                ->latest('id')
                ->first();
        });
    }

    public function getGeometry(string $geoType, int $geoId, bool $display = false, ?string $datasetVersion = null): ?array
    {
        $boundary = $this->findBoundary($geoType, $geoId, $datasetVersion);

        if (! $boundary) {
            return null;
        }

        return $display ? ($boundary->display_geometry ?: $boundary->geometry) : $boundary->geometry;
    }

    public function boundariesFor(string $geoType, array $geoIds, ?string $datasetVersion = null): Collection
    {
        return GeoBoundary::query()
            ->active()
            ->verified()
            ->where('geo_type', $geoType)
            ->whereIn('geo_id', $geoIds)
            ->when($datasetVersion, fn ($q) => $q->where('dataset_version', $datasetVersion))
            ->get();
    }

    public function invalidateCache(?string $geoType = null, ?int $geoId = null): void
    {
        if ($geoType && $geoId) {
            Cache::forget($this->cacheKey($geoType, $geoId));
        }

        Cache::forget('geo-boundaries:index');
    }

    private function cacheKey(string $geoType, int $geoId, ?string $datasetVersion = null): string
    {
        return 'geo-boundaries:'.Str::slug($geoType).':'.$geoId.($datasetVersion ? ':'.Str::slug($datasetVersion) : '');
    }

    /**
     * Validate a raw GeoJSON geometry object (Polygon or MultiPolygon).
     *
     * @return array{valid: bool, errors: array<int, string>, warnings: array<int, string>, bbox: array<string, float>|null, point_count: int, ring_count: int}
     */
    public function validateGeometry(mixed $geometry): array
    {
        $errors = [];
        $warnings = [];
        $bbox = null;
        $pointCount = 0;
        $ringCount = 0;

        if (! is_array($geometry)) {
            return [
                'valid' => false,
                'errors' => ['Geometry must be an array.'],
                'warnings' => $warnings,
                'bbox' => null,
                'point_count' => 0,
                'ring_count' => 0,
            ];
        }

        $type = $geometry['type'] ?? null;
        if (! in_array($type, ['Polygon', 'MultiPolygon'], true)) {
            $errors[] = 'Unsupported geometry type; only Polygon and MultiPolygon are accepted.';

            return [
                'valid' => false,
                'errors' => $errors,
                'warnings' => $warnings,
                'bbox' => null,
                'point_count' => 0,
                'ring_count' => 0,
            ];
        }

        $polygons = $type === 'Polygon'
            ? [$geometry['coordinates'] ?? null]
            : ($geometry['coordinates'] ?? []);

        if (! is_array($polygons) || $polygons === []) {
            $errors[] = 'Geometry contains no polygons.';
        }

        foreach ($polygons as $polygonIndex => $polygon) {
            if (! is_array($polygon) || $polygon === []) {
                $errors[] = "Polygon {$polygonIndex} is empty.";
                continue;
            }

            foreach ($polygon as $ringIndex => $ring) {
                $ringCount++;
                $label = "Polygon {$polygonIndex} ring {$ringIndex}";

                if (! is_array($ring) || count($ring) < 4) {
                    $errors[] = "{$label} must contain at least four positions.";
                    continue;
                }

                $first = $ring[0] ?? null;
                $last = $ring[count($ring) - 1] ?? null;
                if (! $this->samePoint($first, $last)) {
                    $errors[] = "{$label} is not closed.";
                }

                foreach ($ring as $pointIndex => $point) {
                    if (! is_array($point) || count($point) < 2
                        || ! is_numeric($point[0]) || ! is_numeric($point[1])
                        || ! is_finite((float) $point[0]) || ! is_finite((float) $point[1])) {
                        $errors[] = "{$label} position {$pointIndex} is invalid.";
                        continue;
                    }

                    $lng = (float) $point[0];
                    $lat = (float) $point[1];
                    $pointCount++;

                    if ($lng < -180 || $lng > 180 || $lat < -90 || $lat > 90) {
                        $errors[] = "{$label} position {$pointIndex} is outside WGS84 longitude/latitude bounds.";
                        continue;
                    }

                    if ($lng < self::NEPAL_BOUNDS['min_lng'] || $lng > self::NEPAL_BOUNDS['max_lng']
                        || $lat < self::NEPAL_BOUNDS['min_lat'] || $lat > self::NEPAL_BOUNDS['max_lat']) {
                        $warnings[] = "{$label} position {$pointIndex} is outside Nepal's expected envelope.";
                    }

                    $bbox = $this->extendBbox($bbox, $lng, $lat);
                }

                if (count($ring) > self::INTERSECTION_MAX_SEGMENTS) {
                    $warnings[] = "{$label} was too large for exhaustive self-intersection testing.";
                    continue;
                }

                if ($this->ringHasSelfIntersection($ring)) {
                    $errors[] = "{$label} self-intersects.";
                }
            }
        }

        return [
            'valid' => $errors === [],
            'errors' => array_values(array_unique($errors)),
            'warnings' => array_values(array_unique($warnings)),
            'bbox' => $bbox,
            'point_count' => $pointCount,
            'ring_count' => $ringCount,
        ];
    }

    public function bbox(array $geometry): ?array
    {
        $bbox = null;

        foreach ($this->polygonsOf($geometry) as $polygon) {
            $polygonBbox = $this->bboxForPolygon($polygon);
            if (! $polygonBbox) {
                continue;
            }

            $bbox = $bbox ? [
                'min_lng' => min($bbox['min_lng'], $polygonBbox['min_lng']),
                'min_lat' => min($bbox['min_lat'], $polygonBbox['min_lat']),
                'max_lng' => max($bbox['max_lng'], $polygonBbox['max_lng']),
                'max_lat' => max($bbox['max_lat'], $polygonBbox['max_lat']),
            ] : $polygonBbox;
        }

        return $bbox;
    }

    public function bboxOverlaps(array $first, array $second): bool
    {
        return ! ($first['max_lng'] < $second['min_lng']
            || $first['min_lng'] > $second['max_lng']
            || $first['max_lat'] < $second['min_lat']
            || $first['min_lat'] > $second['max_lat']);
    }

    public function containsPoint(array $geometry, float $lng, float $lat): bool
    {
        $type = $geometry['type'] ?? null;
        $coordinates = $geometry['coordinates'] ?? null;

        if (! is_array($coordinates)) {
            return false;
        }

        if ($type === 'Polygon') {
            return $this->polygonContainsPoint($coordinates, $lng, $lat);
        }

        if ($type === 'MultiPolygon') {
            foreach ($coordinates as $polygon) {
                if (is_array($polygon) && $this->polygonContainsPoint($polygon, $lng, $lat)) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * Find a dependable point inside the geometry for parent matching.
     * Full-resolution geometry is always used here; simplified geometry is display-only.
     */
    public function representativePoint(array $geometry): ?array
    {
        $polygons = $this->polygonsOf($geometry);
        $largest = null;
        $largestArea = -1.0;

        foreach ($polygons as $polygon) {
            $outer = $polygon[0] ?? null;
            if (! is_array($outer) || count($outer) < 4) {
                continue;
            }

            $area = $this->ringArea($outer);
            if ($area > $largestArea) {
                $largestArea = $area;
                $largest = $polygon;
            }
        }

        if (! $largest) {
            return null;
        }

        $outer = $largest[0];
        $centroid = $this->ringCentroid($outer);
        if ($this->polygonContainsPoint($largest, $centroid['lng'], $centroid['lat'])) {
            return $centroid;
        }

        $bbox = $this->bboxForPolygon($largest);
        if (! $bbox) {
            return null;
        }

        for ($x = 1; $x <= 9; $x++) {
            for ($y = 1; $y <= 9; $y++) {
                $lng = $bbox['min_lng'] + ($bbox['max_lng'] - $bbox['min_lng']) * ($x / 10);
                $lat = $bbox['min_lat'] + ($bbox['max_lat'] - $bbox['min_lat']) * ($y / 10);
                if ($this->polygonContainsPoint($largest, $lng, $lat)) {
                    return ['lng' => $lng, 'lat' => $lat];
                }
            }
        }

        return null;
    }

    public function normalizeName(string $name): string
    {
        $value = Str::ascii($name);
        $value = strtolower($value);
        $value = preg_replace('/[^a-z0-9]+/', ' ', $value) ?? '';
        $value = preg_replace('/\s+/', ' ', trim($value)) ?? '';

        $suffixes = [
            'village development committee',
            'sub metropolitan city',
            'metropolitan city',
            'rural municipality',
            'municipality',
            'development committee',
            'province',
            'district',
            'city',
            'nagar',
            'vdc',
        ];

        foreach ($suffixes as $suffix) {
            if (str_ends_with($value, ' '.$suffix)) {
                $value = trim(substr($value, 0, -strlen($suffix) - 1));
            }
        }

        return preg_replace('/\s+/', ' ', trim($value)) ?? '';
    }

    /**
     * @return array<int, array<int, array<int, float>>>
     */
    private function polygonsOf(array $geometry): array
    {
        $coordinates = $geometry['coordinates'] ?? null;
        if (! is_array($coordinates)) {
            return [];
        }

        if (($geometry['type'] ?? null) === 'Polygon') {
            return [$coordinates];
        }

        if (($geometry['type'] ?? null) === 'MultiPolygon') {
            return array_values(array_filter($coordinates, 'is_array'));
        }

        return [];
    }

    private function polygonContainsPoint(array $polygon, float $lng, float $lat): bool
    {
        $outer = $polygon[0] ?? null;
        if (! is_array($outer) || ! $this->pointInRing($outer, $lng, $lat)) {
            return false;
        }

        foreach (array_slice($polygon, 1) as $hole) {
            if (is_array($hole) && $this->pointInRing($hole, $lng, $lat)) {
                return false;
            }
        }

        return true;
    }

    private function pointInRing(array $ring, float $lng, float $lat): bool
    {
        $inside = false;
        $count = count($ring);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
            $a = $ring[$i] ?? null;
            $b = $ring[$j] ?? null;
            if (! is_array($a) || ! is_array($b) || count($a) < 2 || count($b) < 2) {
                continue;
            }

            $xi = (float) $a[0];
            $yi = (float) $a[1];
            $xj = (float) $b[0];
            $yj = (float) $b[1];

            if ($this->pointOnSegment($lng, $lat, $xi, $yi, $xj, $yj)) {
                return true;
            }

            if (($yi > $lat) !== ($yj > $lat)
                && $lng < ($xj - $xi) * ($lat - $yi) / (($yj - $yi) ?: PHP_FLOAT_EPSILON) + $xi) {
                $inside = ! $inside;
            }
        }

        return $inside;
    }

    private function pointOnSegment(float $px, float $py, float $x1, float $y1, float $x2, float $y2): bool
    {
        $cross = ($px - $x1) * ($y2 - $y1) - ($py - $y1) * ($x2 - $x1);
        if (abs($cross) > 1e-10) {
            return false;
        }

        return $px >= min($x1, $x2) - 1e-10 && $px <= max($x1, $x2) + 1e-10
            && $py >= min($y1, $y2) - 1e-10 && $py <= max($y1, $y2) + 1e-10;
    }

    private function ringHasSelfIntersection(array $ring): bool
    {
        $segments = count($ring) - 1;
        if ($segments < 2 || $segments > self::INTERSECTION_MAX_SEGMENTS) {
            return false;
        }

        $grid = [];
        $hugeSegments = 0;

        for ($i = 0; $i < $segments; $i++) {
            $a = $ring[$i];
            $b = $ring[$i + 1];
            $minX = (int) floor(min($a[0], $b[0]) / self::INTERSECTION_GRID_SIZE);
            $maxX = (int) floor(max($a[0], $b[0]) / self::INTERSECTION_GRID_SIZE);
            $minY = (int) floor(min($a[1], $b[1]) / self::INTERSECTION_GRID_SIZE);
            $maxY = (int) floor(max($a[1], $b[1]) / self::INTERSECTION_GRID_SIZE);

            if (($maxX - $minX + 1) * ($maxY - $minY + 1) > 64) {
                $hugeSegments++;
                continue;
            }

            for ($x = $minX; $x <= $maxX; $x++) {
                for ($y = $minY; $y <= $maxY; $y++) {
                    $grid["{$x}:{$y}"][] = $i;
                }
            }
        }

        if ($hugeSegments > 0) {
            return false;
        }

        $tested = [];
        $tests = 0;

        foreach ($grid as $bucket) {
            $bucketCount = count($bucket);
            for ($i = 0; $i < $bucketCount - 1; $i++) {
                for ($j = $i + 1; $j < $bucketCount; $j++) {
                    $first = $bucket[$i];
                    $second = $bucket[$j];
                    if ($first === $second) {
                        continue;
                    }

                    $adjacent = abs($first - $second) === 1
                        || ($first === 0 && $second === $segments - 1)
                        || ($second === 0 && $first === $segments - 1);
                    if ($adjacent) {
                        continue;
                    }

                    $key = $first < $second ? "{$first}:{$second}" : "{$second}:{$first}";
                    if (isset($tested[$key])) {
                        continue;
                    }
                    $tested[$key] = true;
                    $tests++;

                    if ($tests > self::INTERSECTION_MAX_PAIR_TESTS) {
                        return false;
                    }

                    if ($this->segmentsIntersect(
                        $ring[$first],
                        $ring[$first + 1],
                        $ring[$second],
                        $ring[$second + 1]
                    )) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    private function segmentsIntersect(array $a1, array $a2, array $b1, array $b2): bool
    {
        $o1 = $this->orientation($a1, $a2, $b1);
        $o2 = $this->orientation($a1, $a2, $b2);
        $o3 = $this->orientation($b1, $b2, $a1);
        $o4 = $this->orientation($b1, $b2, $a2);

        if ($o1 !== 0 && $o2 !== 0 && $o3 !== 0 && $o4 !== 0) {
            return $o1 !== $o2 && $o3 !== $o4;
        }

        return ($o1 === 0 && $this->pointOnSegment((float) $b1[0], (float) $b1[1], (float) $a1[0], (float) $a1[1], (float) $a2[0], (float) $a2[1]))
            || ($o2 === 0 && $this->pointOnSegment((float) $b2[0], (float) $b2[1], (float) $a1[0], (float) $a1[1], (float) $a2[0], (float) $a2[1]))
            || ($o3 === 0 && $this->pointOnSegment((float) $a1[0], (float) $a1[1], (float) $b1[0], (float) $b1[1], (float) $b2[0], (float) $b2[1]))
            || ($o4 === 0 && $this->pointOnSegment((float) $a2[0], (float) $a2[1], (float) $b1[0], (float) $b1[1], (float) $b2[0], (float) $b2[1]));
    }

    private function orientation(array $a, array $b, array $c): int
    {
        $value = ((float) $b[0] - (float) $a[0]) * ((float) $c[1] - (float) $a[1])
            - ((float) $b[1] - (float) $a[1]) * ((float) $c[0] - (float) $a[0]);

        if (abs($value) < 1e-12) {
            return 0;
        }

        return $value > 0 ? 1 : -1;
    }

    private function samePoint(mixed $first, mixed $second): bool
    {
        if (! is_array($first) || ! is_array($second) || count($first) < 2 || count($second) < 2) {
            return false;
        }

        return abs((float) $first[0] - (float) $second[0]) < 1e-9
            && abs((float) $first[1] - (float) $second[1]) < 1e-9;
    }

    private function extendBbox(?array $bbox, float $lng, float $lat): array
    {
        if (! $bbox) {
            return [
                'min_lng' => $lng,
                'min_lat' => $lat,
                'max_lng' => $lng,
                'max_lat' => $lat,
            ];
        }

        $bbox['min_lng'] = min($bbox['min_lng'], $lng);
        $bbox['min_lat'] = min($bbox['min_lat'], $lat);
        $bbox['max_lng'] = max($bbox['max_lng'], $lng);
        $bbox['max_lat'] = max($bbox['max_lat'], $lat);

        return $bbox;
    }

    private function ringArea(array $ring): float
    {
        $area = 0.0;
        $count = count($ring);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
            if (! is_array($ring[$i]) || ! is_array($ring[$j]) || count($ring[$i]) < 2 || count($ring[$j]) < 2) {
                continue;
            }
            $area += ((float) $ring[$j][0] + (float) $ring[$i][0])
                * ((float) $ring[$j][1] - (float) $ring[$i][1]);
        }

        return abs($area / 2);
    }

    private function ringCentroid(array $ring): array
    {
        $x = 0.0;
        $y = 0.0;
        $area = 0.0;
        $count = count($ring);

        for ($i = 0, $j = $count - 1; $i < $count; $j = $i++) {
            if (! is_array($ring[$i]) || ! is_array($ring[$j]) || count($ring[$i]) < 2 || count($ring[$j]) < 2) {
                continue;
            }

            $xj = (float) $ring[$j][0];
            $yj = (float) $ring[$j][1];
            $xi = (float) $ring[$i][0];
            $yi = (float) $ring[$i][1];
            $cross = $xj * $yi - $xi * $yj;
            $area += $cross;
            $x += ($xj + $xi) * $cross;
            $y += ($yj + $yi) * $cross;
        }

        if (abs($area) < 1e-12) {
            $lng = 0.0;
            $lat = 0.0;
            $used = 0;
            foreach ($ring as $point) {
                if (! is_array($point) || count($point) < 2) {
                    continue;
                }
                $lng += (float) $point[0];
                $lat += (float) $point[1];
                $used++;
            }

            return $used > 0
                ? ['lng' => $lng / $used, 'lat' => $lat / $used]
                : ['lng' => 0.0, 'lat' => 0.0];
        }

        return ['lng' => $x / (3 * $area), 'lat' => $y / (3 * $area)];
    }

    private function bboxForPolygon(array $polygon): ?array
    {
        $bbox = null;
        foreach ($polygon as $ring) {
            if (! is_array($ring)) {
                continue;
            }
            foreach ($ring as $point) {
                if (! is_array($point) || count($point) < 2 || ! is_numeric($point[0]) || ! is_numeric($point[1])) {
                    continue;
                }
                $bbox = $this->extendBbox($bbox, (float) $point[0], (float) $point[1]);
            }
        }

        return $bbox;
    }
}
