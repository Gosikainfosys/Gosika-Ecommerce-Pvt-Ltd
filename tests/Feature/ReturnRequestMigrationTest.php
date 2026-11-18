<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ReturnRequestMigrationTest extends TestCase
{
    use RefreshDatabase;

    public function test_return_request_schema_and_unique_number_are_in_the_original_migration(): void
    {
        $this->assertTrue(Schema::hasColumn('return_requests', 'request_type'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'preferred_resolution'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'pickup_collected_at'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'pickup_collected_by'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'exchange_order_id'));
        $this->assertTrue(Schema::hasTable('return_request_media'));
        $this->assertTrue(Schema::hasTable('return_status_history'));
        $this->assertTrue(Schema::hasTable('return_status_histories'));
        $this->assertTrue(Schema::hasColumn('return_requests', 'return_number'));
        $this->assertTrue(Schema::hasIndex('return_requests', 'return_requests_return_number_unique', 'unique'));
    }
}
