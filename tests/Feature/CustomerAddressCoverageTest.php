<?php

namespace Tests\Feature;

use App\Modules\Cart\Infrastructure\Models\Cart;
use App\Modules\Cart\Infrastructure\Models\CartItem;
use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Checkout\Application\Services\CheckoutService;
use App\Modules\Customer\Infrastructure\Models\CustomerAddress;
use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Platform\Application\Services\CoverageAreaService;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use App\Modules\Shared\Domain\Enums\UserStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Vendor\Infrastructure\Models\Store;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class CustomerAddressCoverageTest extends TestCase
{
    use RefreshDatabase;

    protected User $customer;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);
        (new NepalGeoSchemaSeeder)->run();

        $this->customer = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Coverage',
            'last_name' => 'Customer',
            'email' => 'coverage-customer@gosika.test',
            'phone' => '9812345678',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->customer->assignRole(Roles::CUSTOMER);
    }

    public function test_serviceable_shipping_address_can_be_saved(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->allowMunicipality($province, $district, $municipality);

        $response = $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $this->addressPayload($province, $district, $municipality, 27.5, 85.5));

        $response->assertCreated()
            ->assertJsonPath('data.province.id', $province->uuid)
            ->assertJsonPath('data.municipality.id', $municipality->uuid);
    }

    public function test_shipping_address_without_coordinates_is_rejected(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->allowMunicipality($province, $district, $municipality);

        $payload = $this->addressPayload($province, $district, $municipality, 27.5, 85.5);
        unset($payload['latitude'], $payload['longitude']);

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $payload)
            ->assertStatus(422)
            ->assertJsonPath('errors.coverage_reason.0', 'coordinates_required');
    }

    public function test_shipping_address_outside_verified_boundary_is_rejected(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->allowMunicipality($province, $district, $municipality);

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $this->addressPayload($province, $district, $municipality, 30, 90))
            ->assertStatus(422)
            ->assertJsonPath('errors.coverage_reason.0', 'outside_boundary');
    }

    public function test_shipping_address_is_rejected_when_no_rule_allows_delivery(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createBoundary($province, $district, $municipality);

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $this->addressPayload($province, $district, $municipality, 27.5, 85.5))
            ->assertStatus(422)
            ->assertJsonPath('errors.coverage_reason.0', 'no_matching_rule');
    }

    public function test_coverage_area_allows_only_addresses_inside_created_area(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createBoundary($province, $district, $municipality);

        app(CoverageAreaService::class)->create([
            'name' => 'Municipality coverage area',
            'reason' => null,
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'is_active' => true,
        ], $this->customer->id);

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $this->addressPayload($province, $district, $municipality, 27.5, 85.5))
            ->assertCreated();

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $this->addressPayload($province, $district, $municipality, 30, 90))
            ->assertStatus(422)
            ->assertJsonPath('errors.coverage_reason.0', 'outside_coverage_area');
    }

    public function test_ward_block_rule_applies_to_customer_address(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->allowMunicipality($province, $district, $municipality);

        $ward = Ward::create([
            'municipality_id' => $municipality->id,
            'ward_number' => 4,
            'is_active' => true,
        ]);
        DeliveryCoverageRule::create([
            'name' => 'Ward exclusion',
            'scope_type' => 'ward',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'ward_id' => $ward->id,
            'decision' => 'block',
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ]);

        $payload = $this->addressPayload($province, $district, $municipality, 27.5, 85.5);
        $payload['ward_number'] = 4;

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $payload)
            ->assertStatus(422)
            ->assertJsonPath('errors.coverage_reason.0', 'blocked_by_rule');
    }

    public function test_billing_address_does_not_require_delivery_coverage(): void
    {
        [$province, $district, $municipality] = $this->geoChain();

        $payload = $this->addressPayload($province, $district, $municipality, 27.5, 85.5);
        $payload['address_type'] = 'billing';

        $this->actingAs($this->customer, 'sanctum')
            ->postJson('/api/v1/customer/addresses', $payload)
            ->assertCreated();
    }

    public function test_public_check_endpoint_uses_the_same_coverage_engine(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->allowMunicipality($province, $district, $municipality);

        $this->getJson('/api/v1/platform/delivery-coverage/check?'.http_build_query([
            'province_id' => $province->uuid,
            'district_id' => $district->uuid,
            'municipality_id' => $municipality->uuid,
            'lat' => 27.5,
            'lng' => 85.5,
        ]))
            ->assertOk()
            ->assertJsonPath('data.serviceable', true)
            ->assertJsonPath('data.reason', 'allowed_administrative');

        $this->getJson('/api/v1/platform/delivery-coverage/check?'.http_build_query([
            'province_id' => $province->uuid,
            'district_id' => $district->uuid,
            'municipality_id' => $municipality->uuid,
            'lat' => 30,
            'lng' => 90,
        ]))
            ->assertOk()
            ->assertJsonPath('data.serviceable', false)
            ->assertJsonPath('data.reason', 'outside_boundary');
    }

    public function test_checkout_rejects_a_saved_address_that_is_not_serviceable(): void
    {
        [$province, $district, $municipality] = $this->geoChain();
        $this->createCartWithItem();

        $address = CustomerAddress::create([
            'user_id' => $this->customer->id,
            'address_type' => 'shipping',
            'full_name' => 'Coverage Customer',
            'phone' => '9812345678',
            'address_line_1' => 'Unverified location',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'latitude' => '27.5',
            'longitude' => '85.5',
        ]);

        try {
            app(CheckoutService::class)->create($this->customer, [
                'shipping_address_id' => $address->uuid,
            ]);
            $this->fail('Checkout should reject an address with no active coverage rule.');
        } catch (DomainException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
            $this->assertSame('no_matching_rule', $exception->getErrors()['coverage_reason'][0]);
        }
    }

    private function geoChain(): array
    {
        $municipality = Municipality::query()
            ->whereHas('district', fn ($q) => $q->whereNotNull('province_id'))
            ->firstOrFail();
        $district = $municipality->district;

        return [$district->province, $district, $municipality];
    }

    private function addressPayload(
        Province $province,
        District $district,
        Municipality $municipality,
        float $lat,
        float $lng
    ): array {
        return [
            'address_type' => 'shipping',
            'label' => 'Home',
            'full_name' => 'Coverage Customer',
            'phone' => '9812345678',
            'address_line_1' => 'Test address',
            'province_id' => $province->uuid,
            'district_id' => $district->uuid,
            'municipality_id' => $municipality->uuid,
            'latitude' => (string) $lat,
            'longitude' => (string) $lng,
        ];
    }

    private function allowMunicipality(Province $province, District $district, Municipality $municipality): void
    {
        DeliveryCoverageRule::create([
            'name' => 'Municipality delivery',
            'scope_type' => 'municipality',
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'decision' => 'allow',
            'service_mode' => 'all',
            'priority' => 0,
            'is_active' => true,
        ]);

        $this->createBoundary($province, $district, $municipality);
    }

    private function createBoundary(Province $province, District $district, Municipality $municipality): void
    {
        GeoBoundary::create([
            'geo_type' => 'municipality',
            'geo_id' => $municipality->id,
            'province_id' => $province->id,
            'district_id' => $district->id,
            'municipality_id' => $municipality->id,
            'geometry' => $this->geometry(),
            'display_geometry' => $this->geometry(),
            'bbox_min_lng' => 85,
            'bbox_min_lat' => 27,
            'bbox_max_lng' => 86,
            'bbox_max_lat' => 28,
            'dataset_version' => 'TEST-CUSTOMER',
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

    private function createCartWithItem(): void
    {
        $vendorUser = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Test',
            'last_name' => 'Vendor',
            'email' => 'coverage-vendor@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);

        $vendor = Vendor::create([
            'user_id' => $vendorUser->id,
            'company_name' => 'Coverage Vendor',
            'business_email' => 'coverage-vendor@gosika.test',
            'status' => 'approved',
        ]);

        $store = Store::create([
            'vendor_id' => $vendor->id,
            'name' => 'Coverage Store',
            'slug' => 'coverage-store-'.Str::random(6),
            'status' => 'active',
        ]);

        $product = Product::create([
            'vendor_id' => $vendor->id,
            'store_id' => $store->id,
            'name' => 'Coverage Product',
            'slug' => 'coverage-product-'.Str::random(6),
            'sku' => 'COV-'.Str::random(6),
            'status' => 'published',
            'stock_status' => 'in_stock',
            'quantity' => 10,
            'price' => 1000,
        ]);

        $cart = Cart::create([
            'user_id' => $this->customer->id,
            'status' => 'active',
        ]);

        CartItem::create([
            'cart_id' => $cart->id,
            'product_id' => $product->id,
            'quantity' => 1,
            'unit_price' => 1000,
            'total_price' => 1000,
        ]);
    }
}
