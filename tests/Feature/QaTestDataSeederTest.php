<?php

namespace Tests\Feature;

use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class QaTestDataSeederTest extends TestCase
{
    use RefreshDatabase;

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
