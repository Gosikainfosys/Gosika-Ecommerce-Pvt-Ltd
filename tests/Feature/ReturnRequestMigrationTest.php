<?php

namespace Tests\Feature;

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReturnRequestMigrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_return_request_schema_is_in_the_original_migration_and_number_repair_is_idempotent(): void
    {
        $this->assertTrue(Schema::hasColumn('return_requests', 'request_type'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'preferred_resolution'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'pickup_collected_at'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'pickup_collected_by'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'exchange_order_id'));
        $this->assertTrue(Schema::hasTable('return_request_media'));
        $this->assertTrue(Schema::hasTable('return_status_history'));
        $this->assertTrue(Schema::hasTable('return_status_histories'));

        Schema::table('return_requests', function (Blueprint $table) {
            $table->dropUnique('return_requests_return_number_unique');
            $table->dropColumn('return_number');
        });

        $returnNumberMigration = require database_path('migrations/2026_11_05_000001_repair_return_request_numbers.php');
        $returnNumberMigration->up();
        $returnNumberMigration->up();

        $this->assertTrue(Schema::hasColumn('return_requests', 'return_number'));
        $this->assertTrue(Schema::hasIndex('return_requests', 'return_requests_return_number_unique', 'unique'));
    }
}
