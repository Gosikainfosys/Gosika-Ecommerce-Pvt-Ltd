<?php

namespace Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Platform\Infrastructure\Models\Country;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Setting;
use Database\Seeders\CatalogSeeder;
use Database\Seeders\NepalGeoSchemaSeeder;
use Database\Seeders\SettingsSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class SeederRepeatabilityTest extends TestCase
{
    use RefreshDatabase;

    public function test_catalog_geo_and_settings_seeders_preserve_ids_and_do_not_duplicate_logs(): void
    {
        $catalogSeeder = new CatalogSeeder;
        $geoSeeder = new NepalGeoSchemaSeeder;
        $settingsSeeder = new SettingsSeeder;

        $catalogSeeder->run();
        $geoSeeder->run();
        $settingsSeeder->run();

        $uuids = [
            Category::query()->where('slug', 'apparel')->value('uuid'),
            Brand::query()->where('slug', 'nepali-arts')->value('uuid'),
            Country::query()->where('code', 'NP')->value('uuid'),
            Province::query()->where('name', 'Bagmati Province')->value('uuid'),
            Setting::query()->where('key', 'commission.default_rate')->value('uuid'),
        ];

        $catalogSeeder->run();
        $geoSeeder->run();
        $settingsSeeder->run();

        $this->assertSame($uuids, [
            Category::query()->where('slug', 'apparel')->value('uuid'),
            Brand::query()->where('slug', 'nepali-arts')->value('uuid'),
            Country::query()->where('code', 'NP')->value('uuid'),
            Province::query()->where('name', 'Bagmati Province')->value('uuid'),
            Setting::query()->where('key', 'commission.default_rate')->value('uuid'),
        ]);
        $this->assertSame(1, DB::table('activity_logs')->where('activity_type', 'catalog.seeded')->count());
    }
}
