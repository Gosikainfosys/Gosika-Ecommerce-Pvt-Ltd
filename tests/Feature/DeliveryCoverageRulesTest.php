<?php

namespace Tests\Feature;

use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Application\Services\DeliveryCoverageRuleResolver;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use App\Modules\Shared\Domain\Enums\UserStatus;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class DeliveryCoverageRulesTest extends TestCase
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
            'first_name' => 'Rules',
            'last_name' => 'Admin',
            'email' => 'rules-admin@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->admin->assignRole(Roles::SUPER_ADMIN);
    }

    public function test_specific_block_rule_overrides_broad_allow_rule(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule([
            'name' => 'Province-wide delivery',
            'scope_type' => 'province',
            'province_id' => $province->id,
        ]);
        $this->createRule([
            'name' => 'Municipality exclusion',
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'decision' => 'block',
        ]);

        $result = $this->resolver()->resolve($this->location($province, $district, $municipality));

        $this->assertFalse($result['serviceable']);
        $this->assertSame('rule_block', $result['reason']);
        $this->assertSame('municipality', $result['scope']);
        $this->assertSame('Municipality exclusion', $result['rule']->name);
    }

    public function test_ward_block_rule_overrides_municipality_allow_rule(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $ward = $this->createWard($municipality, 4);

        $this->createRule([
            'name' => 'Municipality delivery',
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
        ]);
        $this->createRule([
            'name' => 'Ward exclusion',
            'scope_type' => 'ward',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'ward_id' => $ward->id,
            'decision' => 'block',
        ]);

        $result = $this->resolver()->resolve($this->location($province, $district, $municipality, null, null, $ward->id));

        $this->assertFalse($result['serviceable']);
        $this->assertSame('rule_block', $result['reason']);
        $this->assertSame('ward', $result['scope']);
        $this->assertSame('Ward exclusion', $result['rule']->name);
    }

    public function test_admin_can_create_a_ward_rule_by_ward_number(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/rules', [
                'name' => 'Ward 4 delivery',
                'scope_type' => 'ward',
                'province_id' => $province->id,
                'district_id' => $district->id,
                'municipality_id' => $municipality->id,
                'ward_number' => 4,
                'decision' => 'allow',
                'service_mode' => 'all',
            ]);

        $created->assertCreated()
            ->assertJsonPath('data.scope_type', 'ward')
            ->assertJsonPath('data.ward_number', 4)
            ->assertJsonPath('data.ward.ward_number', 4);

        $this->assertDatabaseHas('wards', [
            'municipality_id' => $municipality->id,
            'ward_number' => 4,
            'is_active' => true,
        ]);
        $this->assertDatabaseHas('delivery_coverage_rules', [
            'uuid' => $created->json('data.uuid'),
            'scope_type' => 'ward',
        ]);
    }

    public function test_ward_number_is_rejected_without_a_municipality(): void
    {
        [$province, $district] = $this->geoChain();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/rules', [
                'name' => 'Invalid ward rule',
                'scope_type' => 'ward',
                'province_id' => $province->id,
                'district_id' => $district->id,
                'municipality_id' => null,
                'ward_number' => 4,
                'decision' => 'allow',
                'service_mode' => 'all',
            ])
            ->assertStatus(422)
            ->assertJsonValidationErrors(['municipality_id']);
    }

    public function test_allow_rule_requires_verified_boundary_and_point_must_be_inside(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $this->createRule([
            'name' => 'Municipality delivery',
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
        ]);

        $result = $this->resolver()->resolve($this->location($province, $district, $municipality));
        $this->assertFalse($result['serviceable']);
        $this->assertSame('boundary_missing', $result['reason']);

        $this->createBoundary($province, $district, $municipality);

        $inside = $this->resolver()->resolve($this->location($province, $district, $municipality, 27.5, 85.5));
        $this->assertTrue($inside['serviceable']);
        $this->assertSame('rule_allow', $inside['reason']);

        $outside = $this->resolver()->resolve($this->location($province, $district, $municipality, 0.0, 0.0));
        $this->assertFalse($outside['serviceable']);
        $this->assertSame('outside_boundary', $outside['reason']);
    }

    public function test_no_matching_rule_denies_service(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $result = $this->resolver()->resolve($this->location($province, $district, $municipality));

        $this->assertFalse($result['serviceable']);
        $this->assertSame('no_matching_rule', $result['reason']);
    }

    public function test_hierarchy_mismatch_denies_service(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createRule([
            'scope_type' => 'province',
            'province_id' => $province->id,
        ]);

        $otherDistrict = District::whereKeyNot($district->id)->firstOrFail();
        $result = $this->resolver()->resolve(
            DeliveryLocation::fromArray([
                'province_id' => $province->id,
                'district_id' => $otherDistrict->id,
                'municipality_id' => $municipality->id,
            ])
        );

        $this->assertFalse($result['serviceable']);
        $this->assertSame('hierarchy_mismatch', $result['reason']);
    }

    public function test_service_mode_filters_rules(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createBoundary($province, $district, $municipality);

        $this->createRule([
            'name' => 'Express only',
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'service_mode' => 'express',
        ]);

        $standard = $this->resolver()->resolve($this->location($province, $district, $municipality), 'standard');
        $express = $this->resolver()->resolve($this->location($province, $district, $municipality), 'express');

        $this->assertSame('no_matching_rule', $standard['reason']);
        $this->assertTrue($express['serviceable']);
    }

    public function test_admin_can_create_update_and_evaluate_rules(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createBoundary($province, $district, $municipality);

        $created = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/rules', [
                'name' => 'Kathmandu valley',
                'scope_type' => 'municipality',
                'province_id' => $province->id,
                'district_id' => $district->id,
                'municipality_id' => $municipality->id,
                'decision' => 'allow',
                'service_mode' => 'all',
                'priority' => 5,
            ]);

        $created->assertCreated()->assertJsonPath('data.scope_type', 'municipality');
        $uuid = $created->json('data.uuid');

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/admin/delivery-coverage/rules/{$uuid}", ['priority' => 9])
            ->assertOk()
            ->assertJsonPath('data.priority', 9);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/delivery-coverage/rules/evaluate?'.http_build_query([
                'province_id' => $province->id,
                'district_id' => $district->id,
                'municipality_id' => $municipality->id,
                'lat' => 27.5,
                'lng' => 85.5,
                'service_mode' => 'standard',
            ]))
            ->assertOk()
            ->assertJsonPath('data.serviceable', true)
            ->assertJsonPath('data.rule.name', 'Kathmandu valley');
    }

    public function test_invalid_child_parent_rule_is_rejected(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $otherDistrict = District::whereKeyNot($district->id)->firstOrFail();

        $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/delivery-coverage/rules', [
                'name' => 'Broken hierarchy',
                'scope_type' => 'municipality',
                'province_id' => $province->id,
                'district_id' => $otherDistrict->id,
                'municipality_id' => $municipality->id,
                'decision' => 'allow',
                'service_mode' => 'all',
            ])
            ->assertStatus(422)
            ->assertJsonPath('success', false);
    }

    public function test_guest_cannot_manage_rules(): void
    {
        $this->getJson('/api/v1/admin/delivery-coverage/rules')
            ->assertStatus(401);
    }

    private function resolver(): DeliveryCoverageRuleResolver
    {
        return app(DeliveryCoverageRuleResolver::class);
    }

    private function geoChain(): array
    {
        $municipality = Municipality::query()
            ->whereHas('district', fn ($q) => $q->whereNotNull('province_id'))
            ->firstOrFail();
        $district = $municipality->district;
        $province = $district->province;

        return [$province, $district, $municipality];
    }

    private function location(
        Province $province,
        District $district,
        Municipality $municipality,
        ?float $lat = null,
        ?float $lng = null,
        ?int $wardId = null
    ): DeliveryLocation {
        return DeliveryLocation::fromArray([
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'ward_id' => $wardId,
            'lat' => $lat,
            'lng' => $lng,
        ]);
    }

    private function createWard(Municipality $municipality, int $number): Ward
    {
        return Ward::create([
            'municipality_id' => $municipality->id,
            'ward_number' => $number,
            'is_active' => true,
        ]);
    }

    private function createRule(array $attributes): DeliveryCoverageRule
    {
        return DeliveryCoverageRule::create(array_merge([
            'name' => 'Test rule '.Str::random(6),
            'decision' => 'allow',
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ], $attributes));
    }

    private function createBoundary(Province $province, District $district, Municipality $municipality): void
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

        GeoBoundary::create([
            'geo_type' => 'municipality',
            'geo_id' => $municipality->id,
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'geometry' => $geometry,
            'display_geometry' => $geometry,
            'bbox_min_lng' => 85,
            'bbox_min_lat' => 27,
            'bbox_max_lng' => 86,
            'bbox_max_lat' => 28,
            'dataset_version' => 'TEST-RULES',
            'source' => 'Test source',
            'source_url' => 'https://example.test',
            'license' => 'Test',
            'source_name' => $municipality->name,
            'is_verified' => true,
            'validation_status' => 'valid',
            'is_active' => true,
            'imported_at' => now(),
        ]);
    }
}
