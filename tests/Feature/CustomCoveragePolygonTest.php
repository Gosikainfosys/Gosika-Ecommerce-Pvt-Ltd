<?php

namespace Tests\Feature;

use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Shared\Domain\Enums\UserStatus;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CustomCoveragePolygonTest extends TestCase
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
            'first_name' => 'Polygon',
            'last_name' => 'Admin',
            'email' => 'polygon-admin@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->admin->assignRole(Roles::SUPER_ADMIN);
    }

    public function test_pending_custom_polygon_is_not_usable_until_verified(): void
    {
        $municipality = $this->municipality();
        $location = $this->location($municipality);

        $polygon = app(CustomCoveragePolygonService::class)->create($this->payload($municipality));

        $this->assertSame(CustomCoveragePolygon::STATUS_PENDING, $polygon->verification_status);
        $this->assertSame(85.0, (float) $polygon->bbox_min_lng);
        $this->assertNull(app(CustomCoveragePolygonService::class)->findContaining($location));

        app(CustomCoveragePolygonService::class)->verify($polygon, $this->admin->id);

        $found = app(CustomCoveragePolygonService::class)->findContaining($location);
        $this->assertNotNull($found);
        $this->assertSame($polygon->id, $found->id);
    }

    public function test_admin_can_create_and_verify_custom_polygon_via_api(): void
    {
        $municipality = $this->municipality();

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/custom-polygons', $this->payload($municipality));

        $created->assertCreated()
            ->assertJsonPath('data.verification_status', 'pending')
            ->assertJsonPath('data.geometry.type', 'Polygon');

        $uuid = $created->json('data.uuid');

        $this->actingAs($this->admin, 'sanctum')
            ->postJson("/api/v1/admin/delivery-coverage/custom-polygons/{$uuid}/verify")
            ->assertOk()
            ->assertJsonPath('data.verification_status', 'verified');

        $found = app(CustomCoveragePolygonService::class)->findContaining($this->location($municipality));
        $this->assertNotNull($found);
        $this->assertSame($uuid, $found->uuid);
    }

    public function test_invalid_geometry_and_missing_reason_are_rejected(): void
    {
        $municipality = $this->municipality();
        $payload = $this->payload($municipality);
        $payload['geometry']['type'] = 'LineString';

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/custom-polygons', $payload)
            ->assertStatus(422);

        $payload = $this->payload($municipality);
        $payload['reason'] = 'short';

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/custom-polygons', $payload)
            ->assertStatus(422);
    }

    public function test_guest_cannot_manage_custom_polygons(): void
    {
        $this->getJson('/api/v1/admin/delivery-coverage/custom-polygons')
            ->assertStatus(401);
    }

    private function municipality(): Municipality
    {
        return Municipality::query()
            ->whereHas('district', fn ($q) => $q->whereNotNull('province_id'))
            ->firstOrFail();
    }

    private function location(Municipality $municipality): DeliveryLocation
    {
        return DeliveryLocation::fromArray([
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'lat' => 27.5,
            'lng' => 85.5,
        ]);
    }

    private function payload(Municipality $municipality): array
    {
        $geometry = [
            'type' => 'Polygon',
            'coordinates' => [[
                [85, 27],
                [86, 27],
                [86, 28],
                [85, 28],
                [85, 27],
            ]],
        ];

        return [
            'name' => 'Exceptional delivery pocket '.Str::random(4),
            'description' => 'Admin-drawn exceptional coverage area.',
            'reason' => 'Administrative boundary does not cover this exceptional pocket.',
            'province_id' => $municipality->district->province_id,
            'district_id' => $municipality->district_id,
            'municipality_id' => $municipality->id,
            'geometry' => $geometry,
            'display_geometry' => $geometry,
            'source' => 'Admin drawing',
            'is_active' => true,
        ];
    }
}
