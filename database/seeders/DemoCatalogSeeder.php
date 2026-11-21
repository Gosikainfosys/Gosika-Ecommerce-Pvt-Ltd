<?php

namespace Database\Seeders;

use App\Modules\Catalog\Infrastructure\Models\Brand;
use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Catalog\Infrastructure\Models\ProductImage;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Shared\Domain\Enums\ProductStatus;
use App\Modules\Shared\Domain\Enums\StoreStatus;
use App\Modules\Shared\Domain\Enums\UserStatus;
use App\Modules\Shared\Domain\Enums\VendorStatus;
use App\Modules\Vendor\Infrastructure\Models\Store;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use RuntimeException;

class DemoCatalogSeeder extends Seeder
{
    private const SEED_REFERENCE = 'public-demo-catalog';

    public function run(): void
    {
        DB::transaction(function (): void {
            $this->call(CatalogSeeder::class);

            $user = $this->seedDemoUser();
            $vendor = $this->seedDemoVendor($user);
            $store = $this->seedDemoStore($vendor);
            $this->seedProducts($vendor, $store);
        });

        Cache::forget('catalog.brands.public');
        Cache::forget('catalog.categories.public.0');
        Cache::forget('catalog.categories.public.1');
        $this->command?->info('The clearly labeled demo catalog is ready with real product images.');
    }

    private function seedDemoUser(): User
    {
        $user = User::query()->firstOrNew(['email' => 'demo.catalog@gosika.com.np']);
        $this->ensureSeedOwned($user->exists, data_get($user->meta, 'seed_reference'), 'demo user');

        $user->password = Hash::make('password');
        $user->forceFill([
            'first_name' => 'GOSIKA',
            'last_name' => 'Demo Catalog',
            'phone' => null,
            'status' => UserStatus::SUSPENDED,
            'email_verified_at' => now(),
            'meta' => ['seed_reference' => self::SEED_REFERENCE],
        ])->save();

        return $user;
    }

    private function seedDemoVendor(User $user): Vendor
    {
        $vendor = Vendor::query()->firstOrNew(['user_id' => $user->id]);
        $this->ensureSeedOwned($vendor->exists, data_get($vendor->meta, 'seed_reference'), 'demo vendor');

        $vendor->fill([
            'company_name' => 'GOSIKA Demo Catalog',
            'business_email' => $user->email,
            'business_phone' => null,
            'status' => VendorStatus::APPROVED,
            'commission_rate' => 0,
            'approved_at' => now(),
            'meta' => ['seed_reference' => self::SEED_REFERENCE],
        ])->save();

        return $vendor;
    }

    private function seedDemoStore(Vendor $vendor): Store
    {
        $store = Store::query()->firstOrNew(['vendor_id' => $vendor->id]);
        $this->ensureSeedOwned($store->exists, data_get($store->settings, 'seed_reference'), 'demo store');

        $conflictingStore = Store::query()
            ->where('slug', 'gosika-demo-catalog')
            ->where('vendor_id', '!=', $vendor->id)
            ->exists();
        if ($conflictingStore) {
            throw new RuntimeException('The reserved demo store slug is already in use by another store.');
        }

        $store->fill([
            'name' => 'GOSIKA Demo Catalog',
            'slug' => 'gosika-demo-catalog',
            'description' => 'A clearly labeled demonstration catalog. These sample listings are for display and testing only.',
            'contact_email' => $vendor->business_email,
            'logo' => 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=300&q=80',
            'banner' => 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=1200&q=80',
            'status' => StoreStatus::ACTIVE,
            'approved_at' => now(),
            'settings' => ['seed_reference' => self::SEED_REFERENCE],
        ])->save();

        return $store;
    }

    private function seedProducts(Vendor $vendor, Store $store): void
    {
        $catalog = [
            'DEMO-ET-001' => [
                'name' => 'Demo Dhaka Cotton Scarf',
                'category' => 'apparel',
                'brand' => 'everest-textiles',
                'price' => 1800,
                'compare_at_price' => 2400,
                'image' => 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=800&q=80',
            ],
            'DEMO-ET-002' => [
                'name' => 'Demo Handwoven Table Runner',
                'category' => 'home-living',
                'brand' => 'everest-textiles',
                'price' => 2200,
                'compare_at_price' => 2800,
                'image' => 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=800&q=80',
            ],
            'DEMO-HH-001' => [
                'name' => 'Demo Himalayan Herbal Tea',
                'category' => 'food-beverages',
                'brand' => 'himalayan-herbals',
                'price' => 650,
                'compare_at_price' => 850,
                'image' => 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=800&q=80',
            ],
            'DEMO-HH-002' => [
                'name' => 'Demo Herbal Skin Balm',
                'category' => 'beauty-care',
                'brand' => 'himalayan-herbals',
                'price' => 480,
                'compare_at_price' => null,
                'image' => 'https://images.unsplash.com/photo-1556228720-195a672e8a03?w=800&q=80',
            ],
            'DEMO-KO-001' => [
                'name' => 'Demo Koshi Organic Honey',
                'category' => 'food-beverages',
                'brand' => 'koshi-organic',
                'price' => 900,
                'compare_at_price' => 1200,
                'image' => 'https://images.unsplash.com/photo-1587049352846-4a222e784d38?w=800&q=80',
            ],
            'DEMO-KO-002' => [
                'name' => 'Demo Timur Spice Blend',
                'category' => 'food-beverages',
                'brand' => 'koshi-organic',
                'price' => 550,
                'compare_at_price' => null,
                'image' => 'https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=800&q=80',
            ],
            'DEMO-NA-001' => [
                'name' => 'Demo Lokta Paper Journal',
                'category' => 'handicrafts',
                'brand' => 'nepali-arts',
                'price' => 750,
                'compare_at_price' => 950,
                'image' => 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?w=800&q=80',
            ],
            'DEMO-NA-002' => [
                'name' => 'Demo Ceramic Tea Cup',
                'category' => 'home-living',
                'brand' => 'nepali-arts',
                'price' => 1200,
                'compare_at_price' => 1500,
                'image' => 'https://images.unsplash.com/photo-1514432324607-a09d9b4aefdd?w=800&q=80',
            ],
        ];

        foreach ($catalog as $sku => $item) {
            $category = Category::query()->where('slug', $item['category'])->firstOrFail();
            $brand = Brand::query()->where('slug', $item['brand'])->firstOrFail();
            $product = Product::query()->firstOrNew(['vendor_id' => $vendor->id, 'sku' => $sku]);
            $this->ensureSeedOwned($product->exists, data_get($product->meta, 'seed_reference'), 'demo product '.$sku);

            $product->fill([
                'store_id' => $store->id,
                'category_id' => $category->id,
                'brand_id' => $brand->id,
                'name' => $item['name'],
                'slug' => Str::slug($sku.'-'.$item['name']),
                'description' => 'Demonstration listing for the GOSIKA sample catalog. Authentic Nepali handcrafted and organic product.',
                'short_description' => 'High quality Nepali demo product.',
                'status' => ProductStatus::PUBLISHED,
                'stock_status' => 'in_stock',
                'quantity' => 15,
                'low_stock_threshold' => 3,
                'price' => $item['price'],
                'compare_at_price' => $item['compare_at_price'],
                'currency' => 'NPR',
                'tax_rate' => (int) $category->tax_rate,
                'is_featured' => true,
                'meta' => ['seed_reference' => self::SEED_REFERENCE, 'demo' => true],
            ])->save();

            ProductImage::query()->where('product_id', $product->id)->delete();
            ProductImage::query()->create([
                'product_id' => $product->id,
                'file_path' => $item['image'],
                'sort_order' => 0,
                'is_primary' => true,
            ]);
        }
    }

    private function ensureSeedOwned(bool $exists, ?string $seedReference, string $record): void
    {
        if ($exists && $seedReference !== self::SEED_REFERENCE) {
            throw new RuntimeException('Refusing to overwrite an existing non-demo '.$record.'.');
        }
    }
}
