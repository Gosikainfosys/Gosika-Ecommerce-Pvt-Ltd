<?php

namespace Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Identity\Domain\Permissions;
use App\Modules\Identity\Domain\Roles;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class QaTestDataSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_default_seeder_skips_qa_fixtures_when_password_is_not_configured(): void
    {
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');

        putenv('QA_TEST_PASSWORD');
        unset($_ENV['QA_TEST_PASSWORD'], $_SERVER['QA_TEST_PASSWORD']);

        try {
            $this->seed(DatabaseSeeder::class);

            $this->assertSame(1, DB::table('users')->count());
            $this->assertSame(5, DB::table('categories')->count());
            $this->assertSame(4, DB::table('brands')->count());
            $this->assertSame(8, DB::table('products')->where('sku', 'like', 'DEMO-%')->count());
            $this->assertSame(0, DB::table('products')->where('sku', 'like', 'QA-%')->count());
            $this->assertDatabaseHas('users', [
                'email' => 'demo.catalog@gosika.com.np',
                'status' => 'suspended',
            ]);
            $this->assertTrue(
                Role::query()->where('name', Roles::VENDOR_ADMIN)->firstOrFail()
                    ->hasPermissionTo(Permissions::ORDERS_MANAGE)
            );
        } finally {
            putenv($previousProcessValue === false ? 'QA_TEST_PASSWORD' : 'QA_TEST_PASSWORD='.$previousProcessValue);

            if ($hadEnvValue) {
                $_ENV['QA_TEST_PASSWORD'] = $previousEnvValue;
            } else {
                unset($_ENV['QA_TEST_PASSWORD']);
            }

            if ($hadServerValue) {
                $_SERVER['QA_TEST_PASSWORD'] = $previousServerValue;
            } else {
                unset($_SERVER['QA_TEST_PASSWORD']);
            }
        }
    }

    public function test_database_seeder_runs_safe_seeders_in_production_without_qa_accounts(): void
    {
        $previousEnvironment = app()->environment();
        app()->detectEnvironment(static fn () => 'production');
        Storage::fake('public');

        try {
            $this->artisan('db:seed', [
                '--class' => DatabaseSeeder::class,
                '--force' => true,
                '--no-interaction' => true,
            ]);

            $this->assertSame(8, DB::table('products')->where('sku', 'like', 'DEMO-%')->count());
            $this->assertSame(0, DB::table('users')->whereIn('email', [
                'admin@gosika.com.np',
                'staff@gosika.com.np',
                'sellerA@gosika.com.np',
                'sellerB@gosika.com.np',
                'sellerC@gosika.com.np',
                'delivery1@gosika.com.np',
                'delivery2@gosika.com.np',
                'customerA@gosika.com.np',
                'customerB@gosika.com.np',
            ])->count());
            $this->assertDatabaseHas('stores', [
                'slug' => 'gosika-demo-catalog',
                'status' => 'active',
            ]);
        } finally {
            app()->detectEnvironment(static fn () => $previousEnvironment);
        }
    }

    public function test_default_seeder_creates_repeatable_qa_fixtures_in_testing(): void
    {
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');

        putenv('QA_TEST_PASSWORD=qa-only-test-password');
        $_ENV['QA_TEST_PASSWORD'] = 'qa-only-test-password';
        $_SERVER['QA_TEST_PASSWORD'] = 'qa-only-test-password';
        Storage::fake('local');
        Storage::fake('public');

        try {
            $this->seed(DatabaseSeeder::class);
            $legacyProduct = Product::query()->where('sku', 'QA-P-01')->firstOrFail()->replicate();
            $legacyProduct->forceFill([
                'uuid' => null,
                'name' => 'Legacy Product',
                'slug' => 'legacy-product',
                'sku' => 'LEGACY-KEEP-01',
                'meta' => ['legacy' => true],
            ])->save();

            $counts = [
                'qa_users' => DB::table('users')->where('email', 'like', '%@gosika.com.np')->count(),
                'qa_vendors' => DB::table('vendors')->count(),
                'qa_products' => DB::table('products')->where('sku', 'like', 'QA-%')->count(),
                'qa_addresses' => DB::table('customer_addresses')->count(),
                'catalog_seed_logs' => DB::table('activity_logs')->where('activity_type', 'catalog.seeded')->count(),
            ];

            $this->seed(DatabaseSeeder::class);

            $this->assertSame($counts, [
                'qa_users' => DB::table('users')->where('email', 'like', '%@gosika.com.np')->count(),
                'qa_vendors' => DB::table('vendors')->count(),
                'qa_products' => DB::table('products')->where('sku', 'like', 'QA-%')->count(),
                'qa_addresses' => DB::table('customer_addresses')->count(),
                'catalog_seed_logs' => DB::table('activity_logs')->where('activity_type', 'catalog.seeded')->count(),
            ]);
            $this->assertDatabaseHas('products', [
                'sku' => 'LEGACY-KEEP-01',
                'name' => 'Legacy Product',
                'slug' => 'legacy-product',
            ]);
            Storage::disk('local')->assertExists('qa-test-data/KYC-DUMMY/sample.pdf');
            Storage::disk('public')->assertExists('qa-test-data/P-01.svg');
        } finally {
            putenv($previousProcessValue === false ? 'QA_TEST_PASSWORD' : 'QA_TEST_PASSWORD='.$previousProcessValue);

            if ($hadEnvValue) {
                $_ENV['QA_TEST_PASSWORD'] = $previousEnvValue;
            } else {
                unset($_ENV['QA_TEST_PASSWORD']);
            }

            if ($hadServerValue) {
                $_SERVER['QA_TEST_PASSWORD'] = $previousServerValue;
            } else {
                unset($_SERVER['QA_TEST_PASSWORD']);
            }
        }
    }
}
