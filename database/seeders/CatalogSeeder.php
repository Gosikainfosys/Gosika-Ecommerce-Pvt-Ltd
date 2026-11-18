<?php

namespace Database\Seeders;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

class CatalogSeeder extends Seeder
{
    public function run(): void
    {
        $categories = [
            ['name' => 'Handicrafts', 'slug' => 'handicrafts', 'description' => 'Handmade Nepali crafts and artisan heritage.', 'icon' => '🎨', 'image' => 'https://images.unsplash.com/photo-1578749556568-bc2c40e68b61?w=600&q=80', 'tax_rate' => 13],
            ['name' => 'Food & Beverages', 'slug' => 'food-beverages', 'description' => 'Local organic honey, teas and highland foods.', 'icon' => '🍯', 'image' => 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80', 'tax_rate' => 5],
            ['name' => 'Apparel', 'slug' => 'apparel', 'description' => 'Traditional Dhaka clothing, woolens and textiles.', 'icon' => '🧣', 'image' => 'https://images.unsplash.com/photo-1489987707025-afc232f7ea0f?w=600&q=80', 'tax_rate' => 13],
            ['name' => 'Home & Living', 'slug' => 'home-living', 'description' => 'Ceramic homeware, candle holders and decor.', 'icon' => '🏠', 'image' => 'https://images.unsplash.com/photo-1513694203232-719a280e022f?w=600&q=80', 'tax_rate' => 13],
            ['name' => 'Beauty & Care', 'slug' => 'beauty-care', 'description' => 'Himalayan herbal balms and organic skincare.', 'icon' => '🌿', 'image' => 'https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?w=600&q=80', 'tax_rate' => 13],
        ];

        foreach ($categories as $index => $category) {
            Category::query()->updateOrCreate(
                ['slug' => $category['slug']],
                [
                    'name' => $category['name'],
                    'description' => $category['description'],
                    'icon' => $category['icon'],
                    'image' => $category['image'],
                    'status' => 'active',
                    'tax_rate' => $category['tax_rate'],
                    'sort_order' => $index + 1,
                ]
            );
        }

        $brands = [
            ['name' => 'Nepali Arts', 'slug' => 'nepali-arts', 'description' => 'Artisan craft collective.', 'logo' => 'https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?w=300&q=80'],
            ['name' => 'Himalayan Herbals', 'slug' => 'himalayan-herbals', 'description' => 'Herbal health and wellness products.', 'logo' => 'https://images.unsplash.com/photo-1540555700478-4be289fbecef?w=300&q=80'],
            ['name' => 'Koshi Organic', 'slug' => 'koshi-organic', 'description' => 'Organic food and tea from Koshi province.', 'logo' => 'https://images.unsplash.com/photo-1615485290382-441e4d049cb5?w=300&q=80'],
            ['name' => 'Everest Textiles', 'slug' => 'everest-textiles', 'description' => 'Quality Nepali handwoven textiles.', 'logo' => 'https://images.unsplash.com/photo-1607604276583-eef5d076aa5f?w=300&q=80'],
        ];

        foreach ($brands as $brand) {
            Brand::query()->updateOrCreate(
                ['slug' => $brand['slug']],
                [
                    'name' => $brand['name'],
                    'description' => $brand['description'],
                    'logo' => $brand['logo'],
                    'status' => 'active',
                ]
            );
        }

        if (! DB::table('activity_logs')->where('activity_type', 'catalog.seeded')->exists()) {
            DB::table('activity_logs')->insert([
                'uuid' => (string) Str::uuid(),
                'user_id' => null,
                'activity_type' => 'catalog.seeded',
                'description' => 'Seeded '.count($categories).' categories and '.count($brands).' brands.',
                'properties' => null,
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }
}
