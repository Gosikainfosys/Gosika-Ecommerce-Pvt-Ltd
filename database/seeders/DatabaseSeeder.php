<?php

namespace Database\Seeders;

use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    public function run(): void
    {
        $this->call([
            RolePermissionSeeder::class,
            NepalGeoSchemaSeeder::class,
            SettingsSeeder::class,
            DemoCatalogSeeder::class,
            CategoryCommissionSeeder::class,
        ]);

        if (app()->isProduction()) {
            $this->command?->warn('QA test accounts and marketplace fixtures were skipped in production.');

            return;
        }

        if (blank(env('QA_TEST_PASSWORD'))) {
            $this->command?->warn('QA test accounts and marketplace fixtures were skipped because QA_TEST_PASSWORD is not set.');

            return;
        }

        $this->call(QaTestDataSeeder::class);
    }
}
