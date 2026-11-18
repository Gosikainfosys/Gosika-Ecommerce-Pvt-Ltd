<?php

namespace Tests\Feature;

use Database\Seeders\CatalogSeeder;
use Database\Seeders\DemoCatalogSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class DemoCatalogSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_demo_catalog_seeder_creates_repeatable_public_products_and_artwork(): void
    {
        Storage::fake('public');
        $this->seed(CatalogSeeder::class);
        $this->getJson('/api/v1/brands')->assertJsonPath('data.0.products_count', 0);

        $this->seed(DemoCatalogSeeder::class);
        $this->seed(DemoCatalogSeeder::class);

        $this->assertSame(8, DB::table('products')->where('sku', 'like', 'DEMO-%')->count());
        $this->assertSame(8, DB::table('product_images')->count());
        $this->assertDatabaseHas('users', [
            'email' => 'demo.catalog@gosika.com.np',
            'status' => 'suspended',
        ]);
        $this->assertDatabaseHas('stores', [
            'slug' => 'gosika-demo-catalog',
            'status' => 'active',
        ]);

        $brands = collect($this->getJson('/api/v1/brands')->assertOk()->json('data'))->keyBy('slug');
        foreach (['everest-textiles', 'himalayan-herbals', 'koshi-organic', 'nepali-arts'] as $brandSlug) {
            $this->assertSame(2, $brands->get($brandSlug)['products_count']);

            $productCount = DB::table('products')
                ->join('brands', 'brands.id', '=', 'products.brand_id')
                ->where('brands.slug', $brandSlug)
                ->where('products.sku', 'like', 'DEMO-%')
                ->where('products.status', 'published')
                ->count();

            $this->assertSame(2, $productCount, 'Expected two published demo products for '.$brandSlug.'.');
        }

        $this->getJson('/api/v1/products')->assertJsonPath('meta.total', 8);
        Storage::disk('public')->assertExists('catalog-demo/DEMO-ET-001.svg');
    }
}
