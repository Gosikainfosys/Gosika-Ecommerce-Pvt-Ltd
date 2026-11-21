<?php

namespace Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Identity\Domain\Permissions;
use App\Modules\Identity\Domain\Roles;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\QaTestDataSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Storage;
use Spatie\Permission\Models\Role;
use Tests\TestCase;

class QaTestDataSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_default_seeder_creates_qa_fixtures_without_login_access_when_password_is_not_configured(): void
    {
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');

        putenv('QA_TEST_PASSWORD');
        unset($_ENV['QA_TEST_PASSWORD'], $_SERVER['QA_TEST_PASSWORD']);
        Storage::fake('local');
        Storage::fake('public');

        try {
            $this->seed(DatabaseSeeder::class);

            $this->assertSame(10, DB::table('users')->count());
            $this->assertSame(5, DB::table('categories')->count());
            $this->assertSame(4, DB::table('brands')->count());
            $this->assertSame(8, DB::table('products')->where('sku', 'like', 'DEMO-%')->count());
            $this->assertSame(4, DB::table('products')->where('sku', 'like', 'QA-%')->count());
            $qaEmails = [
                'admin@gosika.com.np',
                'staff@gosika.com.np',
                'sellerA@gosika.com.np',
                'sellerB@gosika.com.np',
                'sellerC@gosika.com.np',
                'delivery1@gosika.com.np',
                'delivery2@gosika.com.np',
                'customerA@gosika.com.np',
                'customerB@gosika.com.np',
            ];
            $this->assertSame(9, DB::table('users')->whereIn('email', $qaEmails)->where('status', 'suspended')->count());
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

    public function test_database_seeder_creates_qa_fixtures_in_production_with_login_access_disabled(): void
    {
        $previousEnvironment = app()->environment();
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');
        putenv('QA_TEST_PASSWORD');
        unset($_ENV['QA_TEST_PASSWORD'], $_SERVER['QA_TEST_PASSWORD']);
        app()->detectEnvironment(static fn () => 'production');
        Storage::fake('local');
        Storage::fake('public');

        try {
            $this->artisan('db:seed', [
                '--class' => DatabaseSeeder::class,
                '--force' => true,
                '--no-interaction' => true,
            ]);

            $this->assertSame(8, DB::table('products')->where('sku', 'like', 'DEMO-%')->count());
            $this->assertSame(9, DB::table('users')->whereIn('email', [
                'admin@gosika.com.np',
                'staff@gosika.com.np',
                'sellerA@gosika.com.np',
                'sellerB@gosika.com.np',
                'sellerC@gosika.com.np',
                'delivery1@gosika.com.np',
                'delivery2@gosika.com.np',
                'customerA@gosika.com.np',
                'customerB@gosika.com.np',
            ])->where('status', 'suspended')->count());
            $this->assertSame(4, DB::table('products')->where('sku', 'like', 'QA-%')->count());
            $this->assertDatabaseHas('stores', [
                'slug' => 'gosika-demo-catalog',
                'status' => 'active',
            ]);
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

            app()->detectEnvironment(static fn () => $previousEnvironment);
        }
    }

    public function test_production_seeds_login_ready_demo_accounts_when_password_secret_is_configured(): void
    {
        $previousEnvironment = app()->environment();
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');
        $previousConfigPassword = config('app.qa_test_password');
        $password = 'qa-only-production-test-password';
        putenv('QA_TEST_PASSWORD');
        unset($_ENV['QA_TEST_PASSWORD'], $_SERVER['QA_TEST_PASSWORD']);
        config(['app.qa_test_password' => $password]);
        app()->detectEnvironment(static fn () => 'production');
        Storage::fake('local');
        Storage::fake('public');

        try {
            $this->artisan('db:seed', [
                '--force' => true,
                '--no-interaction' => true,
            ]);

            $qaEmails = [
                'admin@gosika.com.np',
                'staff@gosika.com.np',
                'sellerA@gosika.com.np',
                'sellerB@gosika.com.np',
                'sellerC@gosika.com.np',
                'delivery1@gosika.com.np',
                'delivery2@gosika.com.np',
                'customerA@gosika.com.np',
                'customerB@gosika.com.np',
            ];
            $this->assertSame(9, DB::table('users')->whereIn('email', $qaEmails)->where('status', 'active')->count());
            $this->assertTrue(Hash::check(
                $password,
                DB::table('users')->where('email', 'admin@gosika.com.np')->value('password')
            ));
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

            config(['app.qa_test_password' => $previousConfigPassword]);
            app()->detectEnvironment(static fn () => $previousEnvironment);
        }
    }

    public function test_qa_vendor_wallet_does_not_start_with_unledgered_money(): void
    {
        $hadEnvValue = array_key_exists('QA_TEST_PASSWORD', $_ENV);
        $previousEnvValue = $_ENV['QA_TEST_PASSWORD'] ?? null;
        $hadServerValue = array_key_exists('QA_TEST_PASSWORD', $_SERVER);
        $previousServerValue = $_SERVER['QA_TEST_PASSWORD'] ?? null;
        $previousProcessValue = getenv('QA_TEST_PASSWORD');
        $password = 'qa-only-test-password';
        putenv('QA_TEST_PASSWORD='.$password);
        $_ENV['QA_TEST_PASSWORD'] = $password;
        $_SERVER['QA_TEST_PASSWORD'] = $password;
        Storage::fake('local');
        Storage::fake('public');

        try {
            $this->seed(DatabaseSeeder::class);
            $vendorId = DB::table('vendors')
                ->where('company_name', 'QA Alpine Goods')
                ->value('id');
            $wallet = DB::table('vendor_wallets')->where('vendor_id', $vendorId)->first();

            $this->assertNotNull($wallet);
            $this->assertSame(0.0, (float) $wallet->balance);
            $this->assertSame(0.0, (float) $wallet->available_balance);
            $this->assertSame(0.0, (float) $wallet->pending_balance);
            $this->assertSame(
                0,
                DB::table('wallet_transactions')->where('wallet_id', $wallet->id)->count()
            );

            DB::table('vendor_wallets')->where('id', $wallet->id)->update([
                'balance' => 5000,
                'available_balance' => 5000,
                'pending_balance' => 0,
            ]);
            $this->seed(QaTestDataSeeder::class);
            $wallet = DB::table('vendor_wallets')->where('id', $wallet->id)->first();

            $this->assertSame(0.0, (float) $wallet->balance);
            $this->assertSame(0.0, (float) $wallet->available_balance);
            $this->assertSame(0.0, (float) $wallet->pending_balance);
            $this->assertSame(
                0,
                DB::table('wallet_transactions')->where('wallet_id', $wallet->id)->count()
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
