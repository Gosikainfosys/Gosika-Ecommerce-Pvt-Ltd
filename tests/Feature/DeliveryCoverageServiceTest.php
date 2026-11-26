<?php

namespace Tests\Feature;

use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use Database\Seeders\NepalGeoSchemaSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeliveryCoverageServiceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        (new NepalGeoSchemaSeeder)->run();
    }

    public function test_province_rule_uses_province_boundary_unless_strict_boundary_mode_is_requested(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule(['scope_type' => 'province', 'province_id' => $province->id]);
        $this->createBoundary('province', $province->id, $province->id, null, null);

        $standard = app(DeliveryCoverageService::class)->assess(
            $this->location($province, $district, $municipality, 27.5, 85.5),
            'standard',
            ['require_most_specific_boundary' => false]
        );

        $this->assertTrue($standard->serviceable);
        $this->assertSame('allowed_administrative', $standard->reason);
        $this->assertSame('province', $standard->boundaryType);

        $strict = app(DeliveryCoverageService::class)->validateAddress(
            $this->location($province, $district, $municipality, 27.5, 85.5)->toArray()
        );

        $this->assertFalse($strict->serviceable);
        $this->assertSame('boundary_missing', $strict->reason);
    }

    public function test_address_validation_requires_coordinates(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule(['scope_type' => 'municipality', 'province_id' => $province->id,
            'district_id' => $district->id, 'municipality_id' => $municipality->id]);
        $this->createBoundary('municipality', $municipality->id, $province->id, $district->id, $municipality->id);

        $assessment = app(DeliveryCoverageService::class)->validateAddress(
            $this->location($province, $district, $municipality)->toArray()
        );

        $this->assertFalse($assessment->serviceable);
        $this->assertSame('coordinates_required', $assessment->reason);
    }

    public function test_verified_custom_polygon_can_cover_a_boundary_gap(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule(['scope_type' => 'municipality', 'province_id' => $province->id,
            'district_id' => $district->id, 'municipality_id' => $municipality->id]);

        $polygon = app(CustomCoveragePolygonService::class)->create([
            'name' => 'Exceptional pocket',
            'reason' => 'The administrative boundary does not cover this delivery pocket.',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'geometry' => $this->geometry(),
            'is_active' => true,
        ]);
        app(CustomCoveragePolygonService::class)->verify($polygon, 1);

        $assessment = app(DeliveryCoverageService::class)->validateAddress(
            $this->location($province, $district, $municipality, 27.5, 85.5)->toArray()
        );

        $this->assertTrue($assessment->serviceable);
        $this->assertSame('allowed_custom', $assessment->reason);
        $this->assertSame($polygon->uuid, $assessment->customPolygon['uuid']);
    }

    public function test_block_rule_overrides_verified_custom_polygon(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule([
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'decision' => 'block',
        ]);

        $polygon = app(CustomCoveragePolygonService::class)->create([
            'name' => 'Exceptional pocket',
            'reason' => 'The administrative boundary does not cover this delivery pocket.',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'geometry' => $this->geometry(),
            'is_active' => true,
        ]);
        app(CustomCoveragePolygonService::class)->verify($polygon, 1);

        $assessment = app(DeliveryCoverageService::class)->validateAddress(
            $this->location($province, $district, $municipality, 27.5, 85.5)->toArray()
        );

        $this->assertFalse($assessment->serviceable);
        $this->assertSame('blocked_by_rule', $assessment->reason);
    }

    private function geoChain(): array
    {
        $municipality = Municipality::query()
            ->whereHas('district', fn ($q) => $q->whereNotNull('province_id'))
            ->firstOrFail();
        $district = $municipality->district;

        return [$district->province, $district, $municipality];
    }

    private function location(
        Province $province,
        District $district,
        Municipality $municipality,
        ?float $lat = null,
        ?float $lng = null
    ): DeliveryLocation {
        return DeliveryLocation::fromArray([
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'lat' => $lat,
            'lng' => $lng,
        ]);
    }

    private function createRule(array $attributes): DeliveryCoverageRule
    {
        return DeliveryCoverageRule::create(array_merge([
            'name' => 'Central service rule '.Str::random(5),
            'decision' => 'allow',
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ], $attributes));
    }

    private function createBoundary(
        string $type,
        int $geoId,
        int $provinceId,
        ?int $districtId,
        ?int $municipalityId
    ): void {
        GeoBoundary::create([
            'geo_type' => $type,
            'geo_id' => $geoId,
            'province_id' => $provinceId,
            'district_id' => $districtId,
            'municipality_id' => $municipalityId,
            'geometry' => $this->geometry(),
            'display_geometry' => $this->geometry(),
            'bbox_min_lng' => 85,
            'bbox_min_lat' => 27,
            'bbox_max_lng' => 86,
            'bbox_max_lat' => 28,
            'dataset_version' => 'TEST-CENTRAL',
            'source' => 'Test source',
            'source_url' => 'https://example.test',
            'license' => 'Test',
            'source_name' => 'Test',
            'is_verified' => true,
            'validation_status' => 'valid',
            'is_active' => true,
            'imported_at' => now(),
        ]);
    }

    private function geometry(): array
    {
        return [
            'type' => 'Polygon',
            'coordinates' => [[
                [85, 27],
                [86, 27],
                [86, 28],
                [85, 28],
                [85, 27],
            ]],
        ];
    }
}
