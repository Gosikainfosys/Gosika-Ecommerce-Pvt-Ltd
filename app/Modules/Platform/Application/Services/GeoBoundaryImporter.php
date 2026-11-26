<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\GeoBoundaryImport;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Throwable;

class GeoBoundaryImporter
{
    private const PROVINCE_ALIASES = [
        'biratnagar' => 'Koshi Province',
        'janakpur' => 'Madhesh Province',
        'sudurpaschim' => 'Sudurpashchim Province',
    ];

    private const DISTRICT_ALIASES = [
        'tanahu' => 'Tanahun',
        'nawalapur' => 'Nawalpur',
        'synagja' => 'Syangja',
        'kapilbastu' => 'Kapilvastu',
        'rukum e' => 'Eastern Rukum',
        'rukum w' => 'Western Rukum',
        'baijura' => 'Bajura',
        'dadeidhura' => 'Dadeldhura',
        'chitawan' => 'Chitwan',
        'kabherepalanchok' => 'Kavrepalanchok',
        'dhanusha' => 'Dhanusa',
        'makawanpur' => 'Makwanpur',
    ];

    private const MUNICIPALITY_ALIASES = [
        'pathibhara yangwarak' => 'Pathivara Yangwarak',
        'bhokraha narsingh' => 'Bhokraha Narsing',
        'tyamkemaiyung' => 'Temkemaiyung',
        'dudhkoshi' => 'Maapya Dudhkoshi',
        'rupakot majhuwagadhi' => 'Diktel Rupakot Majhuwagadhi',
        'meghang' => 'Myagang',
        'janakpur' => 'Janakpurdham',
        'bhimsen' => 'Bhimsenthapa',
        'pokhara leknath' => 'Pokhara',
        'narphu' => 'Narpa Bhumi',
        'nashong' => 'Narshon',
        'barhagaun muktikhsetra' => 'Waragung Muktikhsetra',
        'lumbini sanskritik development area' => 'Lumbini Sanskritik',
        'duikholi' => 'Dudhouli',
        'suwarnabati' => 'Suwarna',
        'dhorchaur' => 'Dharche',
        'chhededaha' => 'Khaptad Chhededaha',
        'swami kartik' => 'Swami Kartik Khaapar',
        'bogtan' => 'Bogtan Foodsil',
    ];

    private const MINIMUM_MATCH_RATIO = 0.8;

    public function __construct(private readonly GeoBoundaryService $boundaries)
    {
    }

    /**
     * @param array{levels?: array<int, string>, dry_run?: bool, allow_incomplete?: bool} $options
     * @return array<string, mixed>
     */
    public function import(array $options = []): array
    {
        $levels = $options['levels'] ?? ['province', 'district', 'municipality'];
        $dryRun = (bool) ($options['dry_run'] ?? false);
        $allowIncomplete = (bool) ($options['allow_incomplete'] ?? false);
        $manifestPath = (string) ($options['manifest_path'] ?? database_path('data/geo-boundaries/manifest.json'));

        $manifest = $this->readManifest($manifestPath);
        $baseDir = dirname($manifestPath);
        $districtGeometries = collect();
        $results = [];

        foreach ($manifest['datasets'] as $dataset) {
            $level = $dataset['level'] ?? null;
            if (! in_array($level, $levels, true)) {
                continue;
            }

            $record = null;
            if (! $dryRun) {
                $record = GeoBoundaryImport::create([
                    'provider' => $manifest['provider'] ?? 'geoBoundaries',
                    'dataset_version' => $dataset['version'] ?? 'unknown',
                    'level' => $level,
                    'source' => $dataset['source'] ?? null,
                    'source_url' => $dataset['source_url'] ?? null,
                    'license' => $dataset['license'] ?? null,
                    'file' => $dataset['file'] ?? null,
                    'checksum' => $dataset['sha256'] ?? null,
                    'status' => 'running',
                ]);
            }

            try {
                $result = $this->importDataset($dataset, $baseDir, $districtGeometries, $dryRun, $allowIncomplete);
                $results[$level] = $result;

                if ($level === 'district' && isset($result['geometries'])) {
                    $districtGeometries = $result['geometries'];
                }

                if ($record) {
                    $persistedSummary = $result;
                    unset($persistedSummary['geometries']);
                    $record->update([
                        'status' => 'completed',
                        'summary' => $persistedSummary,
                        'imported_at' => now(),
                    ]);
                }
            } catch (Throwable $exception) {
                if ($record) {
                    $record->update([
                        'status' => 'failed',
                        'summary' => $results[$level] ?? null,
                        'error' => $exception->getMessage(),
                    ]);
                }

                throw $exception;
            }
        }

        if ($results === []) {
            throw new DomainException('No supported boundary dataset was selected for import.', 422);
        }

        foreach ($results as &$result) {
            unset($result['geometries']);
        }
        unset($result);

        return [
            'dry_run' => $dryRun,
            'levels' => $results,
        ];
    }

    private function readManifest(string $path): array
    {
        if (! is_file($path)) {
            throw new DomainException('Boundary dataset manifest is missing.', 500);
        }

        $manifest = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (! is_array($manifest) || ! isset($manifest['datasets']) || ! is_array($manifest['datasets'])) {
            throw new DomainException('Boundary dataset manifest is invalid.', 500);
        }

        return $manifest;
    }

    private function importDataset(
        array $dataset,
        string $baseDir,
        Collection $districtGeometries,
        bool $dryRun,
        bool $allowIncomplete
    ): array {
        $level = (string) ($dataset['level'] ?? '');
        $path = $baseDir.DIRECTORY_SEPARATOR.($dataset['file'] ?? '');
        if (! is_file($path)) {
            throw new DomainException("Boundary dataset file for {$level} is missing.", 500);
        }

        $checksum = strtoupper((string) hash_file('sha256', $path));
        if (strtoupper((string) ($dataset['sha256'] ?? '')) !== $checksum) {
            throw new DomainException("Boundary dataset checksum mismatch for {$level}; import aborted.", 422);
        }

        $collection = json_decode((string) file_get_contents($path), true, 512, JSON_THROW_ON_ERROR);
        if (($collection['type'] ?? null) !== 'FeatureCollection' || ! is_array($collection['features'] ?? null)) {
            throw new DomainException("Boundary dataset for {$level} is not a valid GeoJSON FeatureCollection.", 422);
        }

        $displayGeometries = $this->loadDisplayGeometries($dataset, $baseDir);
        $summary = $this->emptySummary($level, count($collection['features']));

        $run = function () use ($collection, $dataset, $level, $displayGeometries, $districtGeometries, &$summary, $dryRun, $allowIncomplete) {
            $matchedMasterIds = [];
            $geometries = collect();

            foreach ($collection['features'] as $feature) {
                $properties = is_array($feature['properties'] ?? null) ? $feature['properties'] : [];
                $sourceName = (string) ($properties['shapeName'] ?? '');
                $featureId = (string) ($properties['shapeID'] ?? '');
                $geometry = $feature['geometry'] ?? null;

                $featureLabel = $sourceName !== '' ? $sourceName : ($featureId !== '' ? $featureId : 'unnamed feature');
                $validation = $this->boundaries->validateGeometry($geometry);
                if (! $validation['valid']) {
                    $summary['skipped_invalid']++;
                    $summary['invalid_features'][] = $featureLabel;
                    continue;
                }

                [$geoType, $geoId, $parentIds, $issue, $parentWarnings] = $this->resolveMaster($level, $sourceName, $geometry, $districtGeometries);
                if (! $geoType || ! $geoId) {
                    $summary['skipped_'.$issue]++;
                    $summary[$issue.'_features'][] = $featureLabel;
                    continue;
                }

                if (isset($matchedMasterIds[$geoId])) {
                    $summary['skipped_duplicate']++;
                    $summary['duplicate_features'][] = $featureLabel;
                    continue;
                }

                $hasParentWarning = collect($parentWarnings)->contains(
                    fn (string $warning) => str_contains($warning, 'Parent district geometry')
                );
                if ($hasParentWarning) {
                    $summary['parent_geometry_warnings']++;
                    $summary['parent_mismatch_features'][] = $featureLabel;
                }

                $matchedMasterIds[$geoId] = true;

                if ($level === 'district') {
                    $geometries->put($geoId, $geometry);
                }

                if ($dryRun) {
                    $summary['stored']++;
                    continue;
                }

                $attributes = [
                    'source_feature_id' => $featureId ?: null,
                    'source_name' => $sourceName ?: null,
                    'geometry' => $geometry,
                    'display_geometry' => $displayGeometries[$featureId] ?? null,
                    'bbox_min_lng' => $validation['bbox']['min_lng'] ?? null,
                    'bbox_min_lat' => $validation['bbox']['min_lat'] ?? null,
                    'bbox_max_lng' => $validation['bbox']['max_lng'] ?? null,
                    'bbox_max_lat' => $validation['bbox']['max_lat'] ?? null,
                    'dataset_version' => (string) ($dataset['version'] ?? 'unknown'),
                    'source' => $dataset['source'] ?? null,
                    'source_url' => $dataset['source_url'] ?? null,
                    'license' => $dataset['license'] ?? null,
                    'is_verified' => true,
                    'validation_status' => 'valid',
                    'validation_errors' => array_values(array_unique([...$validation['warnings'], ...$parentWarnings])) ?: null,
                    'is_active' => true,
                    'imported_at' => now(),
                    'province_id' => $parentIds['province_id'] ?? null,
                    'district_id' => $parentIds['district_id'] ?? null,
                    'municipality_id' => $parentIds['municipality_id'] ?? null,
                    'ward_id' => $parentIds['ward_id'] ?? null,
                ];

                $boundary = GeoBoundary::updateOrCreate([
                    'geo_type' => $geoType,
                    'geo_id' => $geoId,
                    'dataset_version' => $attributes['dataset_version'],
                ], $attributes);

                $boundary->wasRecentlyCreated ? $summary['created']++ : $summary['updated']++;
                $summary['stored']++;
                $this->boundaries->invalidateCache($geoType, $geoId);
            }

            $summary['matched_master_units'] = count($matchedMasterIds);
            $expected = (int) ($dataset['expected_units'] ?? 0);
            $summary['expected_units'] = $expected;
            $summary['match_ratio'] = $expected > 0
                ? round($summary['matched_master_units'] / $expected, 4)
                : null;

            if (! $allowIncomplete && $expected > 0
                && $summary['match_ratio'] < self::MINIMUM_MATCH_RATIO) {
                throw new DomainException(
                    "Boundary import for {$level} matched only {$summary['matched_master_units']} of {$expected} expected units; import aborted. "
                    .'Use --allow-incomplete only when the source dataset is known to be partial.',
                    422
                );
            }

            return $geometries;
        };

        $geometries = $dryRun
            ? $run()
            : DB::transaction($run);

        $summary['geometries'] = $geometries;

        return $summary;
    }

    /**
     * @return array{0: ?string, 1: ?int, 2: array<string, int|null>, 3: ?string, 4: array<int, string>}
     */
    private function resolveMaster(
        string $level,
        string $sourceName,
        array $geometry,
        Collection $districtGeometries
    ): array {
        $normalized = $this->boundaries->normalizeName($sourceName);

        if ($level === 'province') {
            $name = $this->alias($normalized, self::PROVINCE_ALIASES) ?: $sourceName;
            $province = Province::query()
                ->whereRaw('LOWER(name) = LOWER(?)', [$name])
                ->orWhereRaw('LOWER(name) = LOWER(?)', [$this->boundaries->normalizeName($name)])
                ->first();

            if (! $province) {
                $province = Province::query()->get()->first(
                    fn (Province $item) => $this->boundaries->normalizeName($item->name) === $normalized
                );
            }

            if (! $province) {
                return [null, null, [], 'unmatched', []];
            }

            return ['province', $province->id, ['province_id' => $province->id], null, []];
        }

        if ($level === 'district') {
            $name = $this->alias($normalized, self::DISTRICT_ALIASES) ?: $sourceName;
            $district = District::query()
                ->whereRaw('LOWER(name) = LOWER(?)', [$name])
                ->first();

            if (! $district) {
                $district = District::query()->get()->first(
                    fn (District $item) => $this->boundaries->normalizeName($item->name) === $normalized
                );
            }

            if (! $district) {
                return [null, null, [], 'unmatched', []];
            }

            return ['district', $district->id, [
                'province_id' => $district->province_id,
                'district_id' => $district->id,
            ], null, []];
        }

        if ($level === 'municipality') {
            $name = $this->alias($normalized, self::MUNICIPALITY_ALIASES) ?: $sourceName;
            $normalizedName = $this->boundaries->normalizeName($name);

            $candidates = Municipality::query()->with('district')->get()->filter(
                fn (Municipality $item) => $this->boundaries->normalizeName($item->name) === $normalizedName
            )->values();

            $point = $this->boundaries->representativePoint($geometry);
            if ($candidates->count() > 1 && $point) {
                $scores = [];

                foreach ($candidates as $item) {
                    $districtGeometry = $districtGeometries->get($item->district_id);
                    if (! $districtGeometry) {
                        $scores[$item->id] = PHP_INT_MAX;
                        continue;
                    }

                    if ($this->boundaries->containsPoint(
                        $districtGeometry,
                        $point['lng'],
                        $point['lat']
                    )) {
                        $scores[$item->id] = 0;
                        continue;
                    }

                    $bbox = $this->boundaries->bbox($districtGeometry);
                    $scores[$item->id] = $bbox
                        ? pow($point['lng'] - ($bbox['min_lng'] + $bbox['max_lng']) / 2, 2)
                            + pow($point['lat'] - ($bbox['min_lat'] + $bbox['max_lat']) / 2, 2)
                        : PHP_INT_MAX;
                }

                $bestScore = min($scores);
                if ($bestScore < PHP_INT_MAX) {
                    $bestIds = array_keys($scores, $bestScore, true);
                    $candidates = $candidates->filter(
                        fn (Municipality $item) => in_array($item->id, $bestIds, true)
                    )->values();
                }
            }

            if ($candidates->count() > 1) {
                return [null, null, [], 'ambiguous', []];
            }

            if ($candidates->count() === 0) {
                return [null, null, [], 'unmatched', []];
            }

            $municipality = $candidates->first();
            $district = $municipality->district;
            $warnings = [];

            if ($districtGeometries->has($municipality->district_id)) {
                if (! $point || ! $this->boundaries->containsPoint(
                    $districtGeometries->get($municipality->district_id),
                    $point['lng'],
                    $point['lat']
                )) {
                    $warnings[] = 'Parent district geometry does not contain the representative point; source vintages may differ.';
                }
            } else {
                $warnings[] = 'Parent district geometry was not available for containment verification.';
            }

            return ['municipality', $municipality->id, [
                'province_id' => $district?->province_id,
                'district_id' => $municipality->district_id,
                'municipality_id' => $municipality->id,
            ], null, $warnings];
        }

        return [null, null, [], 'unmatched', []];
    }

    private function loadDisplayGeometries(array $dataset, string $baseDir): array
    {
        $file = $dataset['simplified_file'] ?? null;
        if (! $file || ! is_file($baseDir.DIRECTORY_SEPARATOR.$file)) {
            return [];
        }

        $collection = json_decode(
            (string) file_get_contents($baseDir.DIRECTORY_SEPARATOR.$file),
            true,
            512,
            JSON_THROW_ON_ERROR
        );

        $result = [];
        foreach ($collection['features'] ?? [] as $feature) {
            $id = (string) ($feature['properties']['shapeID'] ?? '');
            if ($id !== '' && isset($feature['geometry'])) {
                $result[$id] = $feature['geometry'];
            }
        }

        return $result;
    }

    private function alias(string $normalized, array $aliases): ?string
    {
        return $aliases[$normalized] ?? null;
    }

    private function emptySummary(string $level, int $totalFeatures): array
    {
        return [
            'level' => $level,
            'total_features' => $totalFeatures,
            'stored' => 0,
            'created' => 0,
            'updated' => 0,
            'skipped_invalid' => 0,
            'skipped_unmatched' => 0,
            'skipped_ambiguous' => 0,
            'skipped_duplicate' => 0,
            'parent_geometry_warnings' => 0,
            'invalid_features' => [],
            'unmatched_features' => [],
            'ambiguous_features' => [],
            'duplicate_features' => [],
            'parent_mismatch_features' => [],
            'matched_master_units' => 0,
            'expected_units' => 0,
            'match_ratio' => null,
        ];
    }
}
