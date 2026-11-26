<?php

namespace Tests\Feature;

use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Shared\Domain\Enums\UserStatus;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminGeoBoundaryApiTest extends TestCase
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
            'last_name' => 'Admin',
            'email' => 'coverage-admin@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->admin->assignRole(Roles::SUPER_ADMIN);
    }

    public function test_admin_can_load_verified_boundary_geometry_for_a_province(): void
    {
        $province = Province::where('name', 'Bagmati Province')->firstOrFail();

        GeoBoundary::create($this->boundaryAttributes($province));

        $response = $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/admin/geo/boundaries/province/{$province->uuid}");

        $response->assertOk()
            ->assertJsonPath('data.available', true)
            ->assertJsonPath('data.name', 'Bagmati Province')
            ->assertJsonPath('data.geometry.type', 'Polygon')
            ->assertJsonPath('data.geometry_mode', 'display')
            ->assertJsonPath('data.is_verified', true);
    }

    public function test_admin_can_request_full_resolution_geometry(): void
    {
        $province = Province::where('name', 'Bagmati Province')->firstOrFail();

        GeoBoundary::create($this->boundaryAttributes($province));

        $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/admin/geo/boundaries/province/{$province->uuid}?display=0")
            ->assertOk()
            ->assertJsonPath('data.geometry_mode', 'full')
            ->assertJsonPath('data.geometry.coordinates.0.0.0', 85);
    }

    public function test_ward_boundary_is_reported_as_unavailable_without_fabrication(): void
    {
        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/geo/boundaries/ward/any-ward')
            ->assertStatus(422)
            ->assertJsonPath('data.available', false)
            ->assertJsonPath('data.reason', 'no_verified_dataset');
    }

    public function test_admin_can_load_boundary_by_numeric_master_id(): void
    {
        $province = Province::where('name', 'Bagmati Province')->firstOrFail();

        GeoBoundary::create($this->boundaryAttributes($province));

        $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/admin/geo/boundaries/province/{$province->id}")
            ->assertOk()
            ->assertJsonPath('data.name', 'Bagmati Province')
            ->assertJsonPath('data.available', true);
    }

    public function test_guest_cannot_load_boundary(): void
    {
        $this->getJson('/api/v1/admin/geo/boundaries/province/1')
            ->assertStatus(401);
    }

    public function test_unverified_boundary_is_not_returned(): void
    {
        $province = Province::where('name', 'Bagmati Province')->firstOrFail();

        GeoBoundary::create(array_merge($this->boundaryAttributes($province), [
            'is_verified' => false,
            'validation_status' => 'pending',
        ]));

        $this->actingAs($this->admin, 'sanctum')
            ->getJson("/api/v1/admin/geo/boundaries/province/{$province->uuid}")
            ->assertStatus(404)
            ->assertJsonPath('data.reason', 'boundary_missing');
    }

    private function boundaryAttributes(Province $province): array
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
            'geo_type' => 'province',
            'geo_id' => $province->id,
            'province_id' => $province->id,
            'geometry' => $geometry,
            'display_geometry' => $geometry,
            'bbox_min_lng' => 85,
            'bbox_min_lat' => 27,
            'bbox_max_lng' => 86,
            'bbox_max_lat' => 28,
            'dataset_version' => 'TEST-1',
            'source' => 'Test source',
            'source_url' => 'https://example.test',
            'license' => 'Test',
            'source_name' => 'Bagmati',
            'is_verified' => true,
            'validation_status' => 'valid',
            'is_active' => true,
            'imported_at' => now(),
        ];
    }
}
