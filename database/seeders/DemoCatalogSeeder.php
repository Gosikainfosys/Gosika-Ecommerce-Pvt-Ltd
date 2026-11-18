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
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use RuntimeException;

class DemoCatalogSeeder extends Seeder
{
    private const SEED_REFERENCE = 'public-demo-catalog';

    public function run(): void
    {
        if (! app()->environment(['local', 'testing', 'production'])) {
            throw new RuntimeException('The demo catalog may only be seeded in local, testing, or production environments.');
        }

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
        $this->command?->info('The clearly labeled demo catalog is ready.');
    }

    private function seedDemoUser(): User
    {
        $user = User::query()->firstOrNew(['email' => 'demo.catalog@gosika.com.np']);
        $isNew = ! $user->exists;
        $this->ensureSeedOwned($user->exists, data_get($user->meta, 'seed_reference'), 'demo user');

        if ($isNew) {
            $user->password = Hash::make(Str::random(64));
        }

        $user->forceFill([
            'first_name' => 'GOSIKA',
            'last_name' => 'Demo Catalog',
            'phone' => null,
            'status' => UserStatus::SUSPENDED,
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
                'motif' => 'textile',
                'accent' => '#b45309',
            ],
            'DEMO-ET-002' => [
                'name' => 'Demo Handwoven Table Runner',
                'category' => 'home-living',
                'brand' => 'everest-textiles',
                'price' => 2200,
                'motif' => 'textile',
                'accent' => '#166534',
            ],
            'DEMO-HH-001' => [
                'name' => 'Demo Himalayan Herbal Tea',
                'category' => 'food-beverages',
                'brand' => 'himalayan-herbals',
                'price' => 650,
                'motif' => 'tea',
                'accent' => '#15803d',
            ],
            'DEMO-HH-002' => [
                'name' => 'Demo Herbal Skin Balm',
                'category' => 'beauty-care',
                'brand' => 'himalayan-herbals',
                'price' => 480,
                'motif' => 'bottle',
                'accent' => '#7c3aed',
            ],
            'DEMO-KO-001' => [
                'name' => 'Demo Koshi Organic Honey',
                'category' => 'food-beverages',
                'brand' => 'koshi-organic',
                'price' => 900,
                'motif' => 'honey',
                'accent' => '#ca8a04',
            ],
            'DEMO-KO-002' => [
                'name' => 'Demo Timur Spice Blend',
                'category' => 'food-beverages',
                'brand' => 'koshi-organic',
                'price' => 550,
                'motif' => 'spice',
                'accent' => '#dc2626',
            ],
            'DEMO-NA-001' => [
                'name' => 'Demo Lokta Paper Journal',
                'category' => 'handicrafts',
                'brand' => 'nepali-arts',
                'price' => 750,
                'motif' => 'journal',
                'accent' => '#2563eb',
            ],
            'DEMO-NA-002' => [
                'name' => 'Demo Ceramic Tea Cup',
                'category' => 'home-living',
                'brand' => 'nepali-arts',
                'price' => 1200,
                'motif' => 'cup',
                'accent' => '#0891b2',
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
                'description' => 'Demonstration listing for the GOSIKA sample catalog. This product is illustrative only.',
                'short_description' => 'Demonstration product; not a commercial listing.',
                'status' => ProductStatus::PUBLISHED,
                'stock_status' => 'in_stock',
                'quantity' => 10,
                'low_stock_threshold' => 2,
                'price' => $item['price'],
                'compare_at_price' => null,
                'currency' => 'NPR',
                'tax_rate' => (int) $category->tax_rate,
                'is_featured' => true,
                'meta' => ['seed_reference' => self::SEED_REFERENCE, 'demo' => true],
            ])->save();

            $imagePath = 'catalog-demo/'.$sku.'.svg';
            $this->putFile('public', $imagePath, $this->productImageSvg($item['name'], $item['motif'], $item['accent']));

            ProductImage::query()->updateOrCreate(
                ['product_id' => $product->id, 'sort_order' => 0],
                [
                    'file_path' => Storage::disk('public')->url($imagePath),
                    'is_primary' => true,
                ]
            );
        }
    }

    private function ensureSeedOwned(bool $exists, ?string $seedReference, string $record): void
    {
        if ($exists && $seedReference !== self::SEED_REFERENCE) {
            throw new RuntimeException('Refusing to overwrite an existing non-demo '.$record.'.');
        }
    }

    private function productImageSvg(string $name, string $motif, string $accent): string
    {
        $title = htmlspecialchars($name, ENT_QUOTES | ENT_XML1, 'UTF-8');
        $illustrations = [
            'textile' => '<path d="M290 150h220l45 92-50 235H295l-50-235z" fill="'.$accent.'" opacity=".92"/><path d="M310 185h180M300 230h200M295 275h210M300 320h200M310 365h180M320 410h160" stroke="#fff" stroke-width="12" opacity=".8"/><path d="M290 150l-45 92 55 24 30-58M510 150l45 92-55 24-30-58" fill="#f3e8d2"/>',
            'tea' => '<path d="M305 240h190v155a65 65 0 0 1-65 65h-60a65 65 0 0 1-65-65z" fill="#fff" stroke="'.$accent.'" stroke-width="18"/><path d="M495 275h34a48 48 0 0 1 0 96h-34" fill="none" stroke="'.$accent.'" stroke-width="18"/><path d="M345 195c-20-35 25-42 5-78m70 78c-20-35 25-42 5-78m70 78c-20-35 25-42 5-78" fill="none" stroke="'.$accent.'" stroke-width="12" stroke-linecap="round"/>',
            'bottle' => '<path d="M365 155h70v70l55 50v190a35 35 0 0 1-35 35H345a35 35 0 0 1-35-35V275l55-50z" fill="#fff" stroke="'.$accent.'" stroke-width="18"/><rect x="340" y="320" width="120" height="90" rx="18" fill="'.$accent.'" opacity=".85"/><path d="M380 155h40v-35h-40z" fill="'.$accent.'"/>',
            'honey' => '<path d="M340 185h120l35 55v220a35 35 0 0 1-35 35h-120a35 35 0 0 1-35-35V240z" fill="#fef3c7" stroke="'.$accent.'" stroke-width="18"/><path d="M340 185v-35h120v35" fill="'.$accent.'"/><path d="M330 325h140v95H330z" fill="'.$accent.'" opacity=".82"/><path d="M400 345c-28 33-30 47 0 62 30-15 28-29 0-62z" fill="#fff"/>',
            'spice' => '<circle cx="400" cy="320" r="145" fill="#fff" stroke="'.$accent.'" stroke-width="18"/><path d="M400 175a145 145 0 0 1 145 145H400z" fill="'.$accent.'"/><path d="M400 465a145 145 0 0 1-145-145h145z" fill="'.$accent.'" opacity=".75"/><circle cx="400" cy="320" r="45" fill="#fef3c7"/>',
            'journal' => '<path d="M290 160h220a35 35 0 0 1 35 35v280a35 35 0 0 1-35 35H290z" fill="#fff" stroke="'.$accent.'" stroke-width="18"/><path d="M330 160v350M365 245h130M365 290h130M365 335h130M365 380h100" stroke="'.$accent.'" stroke-width="13" stroke-linecap="round"/><circle cx="312" cy="220" r="8" fill="'.$accent.'"/><circle cx="312" cy="280" r="8" fill="'.$accent.'"/><circle cx="312" cy="340" r="8" fill="'.$accent.'"/>',
            'cup' => '<path d="M275 250h230v150a80 80 0 0 1-80 80h-70a80 80 0 0 1-80-80z" fill="#fff" stroke="'.$accent.'" stroke-width="18"/><path d="M505 280h35a48 48 0 0 1 0 96h-35" fill="none" stroke="'.$accent.'" stroke-width="18"/><path d="M330 205h120M350 170h80" stroke="'.$accent.'" stroke-width="15" stroke-linecap="round"/>',
        ];
        if (! isset($illustrations[$motif])) {
            throw new RuntimeException('Unknown demo product illustration: '.$motif);
        }

        return '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><defs><linearGradient id="bg" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#fff7ed"/><stop offset="1" stop-color="#e0f2fe"/></linearGradient></defs><rect width="800" height="800" rx="48" fill="url(#bg)"/><circle cx="400" cy="320" r="225" fill="#fff" opacity=".82"/>'.$illustrations[$motif].'<text x="400" y="625" text-anchor="middle" font-family="sans-serif" font-size="30" font-weight="700" fill="#172554">'.$title.'</text><text x="400" y="675" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#64748b">GOSIKA DEMO CATALOG</text></svg>';
    }

    private function putFile(string $disk, string $path, string $contents): void
    {
        if (! Storage::disk($disk)->put($path, $contents)) {
            throw new RuntimeException('Unable to write the demo catalog image: '.$path);
        }
    }
}
