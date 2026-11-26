<?php

namespace Tests\Feature;

use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Shared\Domain\Enums\UserStatus;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CoverageAreaTest extends TestCase
{
    use RefreshDatabase;

    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);
        (new NepalGeoSchemaSeeder)->run();

        $this->admin = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Coverage',
            'last_name' => 'Area Admin',
            'email' => 'coverage-area-admin@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->admin->assignRole(Roles::SUPER_ADMIN);
    }

    public function test_admin_can_create_a_municipality_area_from_the_verified_boundary(): void
    {
        $municipality = $this->municipality();
        GeoBoundary::create($this->boundaryAttributes($municipality));

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->boundaryPayload($municipality));

        $created->assertCreated()
            ->assertJsonPath('data.is_coverage_area', true)
            ->assertJsonPath('data.verification_status', 'verified')
            ->assertJsonPath('data.geometry.type', 'Polygon')
            ->assertJsonPath('data.ward_id', null);

        $this->assertDatabaseHas('custom_coverage_polygons', [
            'uuid' => $created->json('data.uuid'),
            'is_coverage_area' => true,
            'municipality_id' => $municipality->id,
            'verification_status' => 'verified',
        ]);
    }

    public function test_only_created_areas_are_serviceable(): void
    {
        $municipality = $this->municipality();
        GeoBoundary::create($this->boundaryAttributes($municipality));

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->boundaryPayload($municipality))
            ->assertCreated();

        $service = app(DeliveryCoverageService::class);

        $inside = $service->validateAddress($this->address($municipality, 27.5, 85.5));
        $this->assertTrue($inside->serviceable);
        $this->assertSame('allowed_coverage_area', $inside->reason);

        $outside = $service->validateAddress($this->address($municipality, 29.5, 85.5));
        $this->assertFalse($outside->serviceable);
        $this->assertSame('outside_coverage_area', $outside->reason);
    }

    public function test_inactive_coverage_area_keeps_allow_list_mode_and_denies_delivery(): void
    {
        $municipality = $this->municipality();
        GeoBoundary::create($this->boundaryAttributes($municipality));

        DeliveryCoverageRule::create([
            'name' => 'Legacy municipality allowance',
            'scope_type' => DeliveryCoverageRule::SCOPE_MUNICIPALITY,
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'decision' => DeliveryCoverageRule::DECISION_ALLOW,
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ]);

        $payload = $this->boundaryPayload($municipality);
        $payload['is_active'] = false;

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $payload)
            ->assertCreated();

        $result = app(DeliveryCoverageService::class)
            ->validateAddress($this->address($municipality, 27.5, 85.5));

        $this->assertFalse($result->serviceable);
        $this->assertSame('outside_coverage_area', $result->reason);
    }

    public function test_ward_area_requires_a_drawn_polygon_and_documented_reason(): void
    {
        $municipality = $this->municipality();
        $payload = $this->wardPayload($municipality, 'too short');
        unset($payload['geometry']);

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $payload)
            ->assertStatus(422)
            ->assertJsonValidationErrors(['geometry', 'reason']);

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->wardPayload($municipality, 'Drawn because no verified ward dataset exists.'))
            ->assertCreated();

        $created->assertJsonPath('data.ward_number', 4)
            ->assertJsonPath('data.verification_status', 'verified');

        $this->assertDatabaseHas('wards', [
            'municipality_id' => $municipality->id,
            'ward_number' => 4,
        ]);
        $this->assertDatabaseHas('custom_coverage_polygons', [
            'uuid' => $created->json('data.uuid'),
            'is_coverage_area' => true,
        ]);
    }

    public function test_ward_area_allows_inside_points_and_denies_outside_points(): void
    {
        $municipality = $this->municipality();

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->wardPayload($municipality, 'Drawn because no verified ward dataset exists.'))
            ->assertCreated();

        $wardId = (int) $created->json('data.ward_id');
        $service = app(DeliveryCoverageService::class);

        $inside = $service->validateAddress($this->address($municipality, 27.5, 85.5, $wardId));
        $this->assertTrue($inside->serviceable);
        $this->assertSame('coverage_area', $inside->boundaryType);

        $outside = $service->validateAddress($this->address($municipality, 29.5, 85.5, $wardId));
        $this->assertFalse($outside->serviceable);
        $this->assertSame('outside_coverage_area', $outside->reason);
    }

    public function test_areas_endpoint_exposes_all_polygons_for_the_coverage_map(): void
    {
        $municipality = $this->municipality();
        GeoBoundary::create($this->boundaryAttributes($municipality));

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->boundaryPayload($municipality))
            ->assertCreated();

        CustomCoveragePolygon::create(array_merge($this->wardPayload($municipality, 'Administrative boundary does not cover this exceptional pocket.'), [
            'ward_id' => null,
            'ward_number' => null,
            'is_coverage_area' => false,
            'verification_status' => CustomCoveragePolygon::STATUS_PENDING,
        ]));

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/delivery-coverage/areas')
            ->assertOk();

        $data = collect($response->json('data'));
        $this->assertCount(2, $data);
        $this->assertTrue($data->contains('is_coverage_area', true));
        $this->assertTrue($data->contains('is_coverage_area', false));
        $this->assertTrue($data->every(fn ($area) => ! empty($area['geometry'])));
    }

    public function test_block_rule_still_overrides_a_created_coverage_area(): void
    {
        $municipality = $this->municipality();
        GeoBoundary::create($this->boundaryAttributes($municipality));

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/areas', $this->boundaryPayload($municipality))
            ->assertCreated();

        DeliveryCoverageRule::create([
            'name' => 'Municipality exclusion',
            'scope_type' => DeliveryCoverageRule::SCOPE_MUNICIPALITY,
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'decision' => DeliveryCoverageRule::DECISION_BLOCK,
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ]);

        $result = app(DeliveryCoverageService::class)
            ->validateAddress($this->address($municipality, 27.5, 85.5));

        $this->assertFalse($result->serviceable);
        $this->assertSame('blocked_by_rule', $result->reason);
    }

    public function test_guest_cannot_manage_coverage_areas(): void
    {
        $this->getJson('/api/v1/admin/delivery-coverage/areas')->assertStatus(401);
    }

    private function municipality(): Municipality
    {
        return Municipality::query()
            ->whereHas('district', fn ($q) => $q->whereNotNull('province_id'))
            ->firstOrFail();
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

    private function boundaryAttributes(Municipality $municipality): array
    {
        return [
            'geo_type' => 'municipality',
            'geo_id' => $municipality->id,
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'geometry' => $this->geometry(),
            'display_geometry' => $this->geometry(),
            'bbox_min_lng' => 85,
            'bbox_min_lat' => 27,
            'bbox_max_lng' => 86,
            'bbox_max_lat' => 28,
            'dataset_version' => 'TEST-AREA-1',
            'source' => 'Test boundary',
            'source_url' => 'https://example.test',
            'license' => 'Test',
            'source_name' => $municipality->name,
            'is_verified' => true,
            'validation_status' => 'valid',
            'is_active' => true,
            'imported_at' => now(),
        ];
    }

    private function boundaryPayload(Municipality $municipality): array
    {
        return [
            'name' => 'Municipality delivery area',
            'description' => 'Created from the verified boundary.',
            'reason' => null,
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'is_active' => true,
        ];
    }

    private function wardPayload(Municipality $municipality, string $reason): array
    {
        return [
            'name' => 'Ward 4 delivery area',
            'description' => 'Admin-drawn ward coverage.',
            'reason' => $reason,
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'ward_number' => 4,
            'geometry' => $this->geometry(),
            'is_active' => true,
        ];
    }

    private function address(Municipality $municipality, float $lat, float $lng, ?int $wardId = null): array
    {
        return [
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'ward_id' => $wardId,
            'lat' => $lat,
            'lng' => $lng,
        ];
    }
}
