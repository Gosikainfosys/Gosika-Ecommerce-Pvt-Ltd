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
            CatalogSeeder::class,
            CategoryCommissionSeeder::class,
            DemoCatalogSeeder::class,
            QaTestDataSeeder::class,
        ]);
    }
}
