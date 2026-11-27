<?php

namespace Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Category;
use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Shared\Domain\Enums\UserStatus;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class AdminCategoryHierarchyTest extends TestCase
{
    use RefreshDatabase;

    protected User $admin;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);

        $this->admin = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Catalog',
            'last_name' => 'Admin',
            'email' => 'catalog-admin@gosika.test',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->admin->assignRole(Roles::SUPER_ADMIN);
    }

    public function test_admin_category_list_exposes_parent_uuid_for_tree_rendering(): void
    {
        $parent = $this->createCategory('Electronics', 'electronics');
        $child = $this->createCategory('Mobile Phones', 'mobile-phones', $parent);

        $this->actingAs($this->admin, 'sanctum')
            ->getJson('/api/v1/admin/categories')
            ->assertOk()
            ->assertJsonPath('data.0.parent_id', null)
            ->assertJsonPath('data.1.parent_id', $parent->uuid)
            ->assertJsonFragment([
                'id' => $child->uuid,
                'name' => 'Mobile Phones',
                'parent_id' => $parent->uuid,
            ]);
    }

    public function test_admin_can_create_subcategories_at_any_depth(): void
    {
        $parent = $this->createCategory('Electronics', 'electronics');
        $child = $this->createCategory('Mobile Phones', 'mobile-phones', $parent);

        $response = $this->actingAs($this->admin, 'sanctum')
            ->postJson('/api/v1/admin/categories', [
                'parent_id' => $child->uuid,
                'name' => 'Flagship Phones',
                'slug' => 'flagship-phones',
                'tax_rate' => 13,
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.parent_id', $child->uuid)
            ->assertJsonPath('data.name', 'Flagship Phones');

        $this->assertDatabaseHas('categories', [
            'uuid' => $response->json('data.id'),
            'parent_id' => $child->id,
            'tax_rate' => 13,
        ]);
    }

    public function test_admin_cannot_move_a_category_under_its_own_descendant(): void
    {
        $parent = $this->createCategory('Electronics', 'electronics');
        $child = $this->createCategory('Mobile Phones', 'mobile-phones', $parent);
        $grandchild = $this->createCategory('Flagship Phones', 'flagship-phones', $child);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/admin/categories/{$parent->uuid}", [
                'name' => 'Electronics',
                'parent_id' => $grandchild->uuid,
            ])
            ->assertStatus(422)
            ->assertJsonPath('errors.parent_id.0', 'A category cannot have one of its descendants as a parent.');

        $this->assertDatabaseHas('categories', [
            'id' => $parent->id,
            'parent_id' => null,
        ]);
    }

    public function test_partial_category_update_preserves_the_existing_parent(): void
    {
        $parent = $this->createCategory('Electronics', 'electronics');
        $child = $this->createCategory('Mobile Phones', 'mobile-phones', $parent);

        $this->actingAs($this->admin, 'sanctum')
            ->putJson("/api/v1/admin/categories/{$child->uuid}", [
                'name' => 'Mobile Devices',
            ])
            ->assertOk()
            ->assertJsonPath('data.parent_id', $parent->uuid);

        $this->assertDatabaseHas('categories', [
            'id' => $child->id,
            'parent_id' => $parent->id,
        ]);
    }

    public function test_public_storage_route_serves_uploaded_category_images(): void
    {
        $svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        Storage::disk('public')->put('categories/category-test.svg', $svg);

        try {
            $this->get('/storage/categories/category-test.svg')
                ->assertOk()
                ->assertHeader('content-type', 'image/svg+xml')
                ->assertStreamedContent($svg);
        } finally {
            Storage::disk('public')->delete('categories/category-test.svg');
        }
    }

    public function test_public_storage_route_rejects_traversal_attempts(): void
    {
        $this->get('/storage/../.env')->assertNotFound();
    }

    private function createCategory(string $name, string $slug, ?Category $parent = null): Category
    {
        return Category::create([
            'uuid' => (string) Str::uuid(),
            'parent_id' => $parent?->id,
            'name' => $name,
            'slug' => $slug,
            'status' => 'active',
            'tax_rate' => 13,
            'sort_order' => $slug === 'electronics' ? 1 : 2,
        ]);
    }
}
