<?php

namespace Tests\Feature;

use App\Modules\Platform\Application\Services\GeoBoundaryImporter;
use App\Modules\Platform\Application\Services\GeoBoundaryService;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\GeoBoundaryImport;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use Database\Seeders\NepalGeoSchemaSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\File;
use Illuminate\Support\Str;
use Tests\TestCase;

class GeoBoundaryImportTest extends TestCase
{
    use RefreshDatabase;

    private string $tempDirectory;

    protected function setUp(): void
    {
        parent::setUp();

        (new NepalGeoSchemaSeeder)->run();

        $this->tempDirectory = sys_get_temp_dir().DIRECTORY_SEPARATOR.'gosika-geo-boundary-test-'.Str::uuid()->toString();
        File::ensureDirectoryExists($this->tempDirectory);
    }

    protected function tearDown(): void
    {
        File::deleteDirectory($this->tempDirectory);
        parent::tearDown();
    }

    public function test_geometry_validation_and_point_in_polygon_use_full_resolution_geometry(): void
    {
        $service = app(GeoBoundaryService::class);
        $geometry = $this->squareGeometry();

        $validation = $service->validateGeometry($geometry);

        $this->assertTrue($validation['valid']);
        $this->assertSame(85.0, $validation['bbox']['min_lng']);
        $this->assertTrue($service->containsPoint($geometry, 85.5, 27.5));
        $this->assertFalse($service->containsPoint($geometry, 0.0, 0.0));
        $this->assertSame('parsa wildlife reserve', $service->normalizeName('Parsa Wildlife Reserve'));

        $invalid = $service->validateGeometry([
            'type' => 'Polygon',
            'coordinates' => [[[0, 0], [1, 0], [0, 1]]],
        ]);

        $this->assertFalse($invalid['valid']);
    }

    public function test_importer_matches_master_province_and_stores_verified_boundary(): void
    {
        $manifest = $this->writeDataset(expectedUnits: 1);

        $result = app(GeoBoundaryImporter::class)->import([
            'levels' => ['province'],
            'manifest_path' => $manifest,
        ]);

        $this->assertSame(1, $result['levels']['province']['stored']);
        $this->assertSame([], $result['levels']['province']['unmatched_features']);
        $this->assertSame([], $result['levels']['province']['duplicate_features']);
        $this->assertSame(1, GeoBoundary::count());

        $province = Province::where('name', 'Bagmati Province')->firstOrFail();
        $boundary = GeoBoundary::where('geo_type', 'province')->where('geo_id', $province->id)->firstOrFail();

        $this->assertTrue($boundary->is_verified);
        $this->assertSame('valid', $boundary->validation_status);
        $this->assertSame(85.0, $boundary->bbox_min_lng);
        $this->assertSame('completed', GeoBoundaryImport::firstOrFail()->status);

        $service = app(GeoBoundaryService::class);
        $this->assertTrue($service->containsPoint($service->getGeometry('province', $province->id), 85.5, 27.5));
    }

    public function test_incomplete_import_is_rolled_back_unless_explicitly_allowed(): void
    {
        $manifest = $this->writeDataset(expectedUnits: 7);

        try {
            app(GeoBoundaryImporter::class)->import([
                'levels' => ['province'],
                'manifest_path' => $manifest,
            ]);
            $this->fail('An incomplete import should be rejected.');
        } catch (DomainException $exception) {
            $this->assertStringContainsString('import aborted', $exception->getMessage());
        }

        $this->assertSame(0, GeoBoundary::count());
        $this->assertSame('failed', GeoBoundaryImport::firstOrFail()->status);

        app(GeoBoundaryImporter::class)->import([
            'levels' => ['province'],
            'manifest_path' => $manifest,
            'allow_incomplete' => true,
        ]);

        $this->assertSame(1, GeoBoundary::count());
    }

    private function writeDataset(int $expectedUnits): string
    {
        $geojson = [
            'type' => 'FeatureCollection',
            'features' => [[
                'type' => 'Feature',
                'properties' => [
                    'shapeName' => 'Bagmati',
                    'shapeID' => 'TEST-BAGMATI',
                    'shapeGroup' => 'NPL',
                    'shapeType' => 'ADM1',
                ],
                'geometry' => $this->squareGeometry(),
            ]],
        ];

        $file = $this->tempDirectory.DIRECTORY_SEPARATOR.'provinces.geojson';
        file_put_contents($file, json_encode($geojson, JSON_THROW_ON_ERROR));

        $manifest = [
            'provider' => 'Test Provider',
            'datasets' => [[
                'level' => 'province',
                'file' => 'provinces.geojson',
                'version' => 'TEST-1',
                'source' => 'Test source',
                'source_url' => 'https://example.test',
                'license' => 'Test',
                'expected_units' => $expectedUnits,
                'sha256' => strtoupper((string) hash_file('sha256', $file)),
            ]],
        ];

        $manifestPath = $this->tempDirectory.DIRECTORY_SEPARATOR.'manifest.json';
        file_put_contents($manifestPath, json_encode($manifest, JSON_THROW_ON_ERROR));

        return $manifestPath;
    }

    private function squareGeometry(): array
    {
        return [
            'type' => 'Polygon',
            'coordinates' => [[
                [85.0, 27.0],
                [86.0, 27.0],
                [86.0, 28.0],
                [85.0, 28.0],
                [85.0, 27.0],
            ]],
        ];
    }
}
