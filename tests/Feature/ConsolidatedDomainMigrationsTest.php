<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Schema;
use Tests\TestCase;

class ConsolidatedDomainMigrationsTest extends TestCase
{
    use RefreshDatabase;

    public function test_domain_feature_tables_and_columns_are_created_by_original_migrations(): void
    {
        foreach ([
            'seller_tiers',
            'customer_wallets',
            'customer_wallet_transactions',
            'category_commission_rules',
            'campaigns',
            'cms_pages',
            'seo_meta',
            'seo_templates',
            'seo_keywords',
            'seo_redirects',
            'seo_audit_results',
            'shipping_zones',
            'couriers',
            'broadcasts',
            'vendor_notifications',
            'customer_notifications',
            'admin_notifications',
            'delivery_notifications',
            'vendor_promotions',
            'return_request_media',
            'return_status_history',
            'return_status_histories',
            'chat_conversations',
            'chat_messages',
        ] as $table) {
            $this->assertTrue(Schema::hasTable($table), "Missing consolidated table: {$table}");
        }

        foreach ([
            'vendors' => ['seller_tier_id'],
            'vendor_kycs' => ['landmark'],
            'delivery_assignments' => ['cod_reconciled_at', 'cod_reconciled_by'],
            'return_requests' => [
                'request_type',
                'preferred_resolution',
                'return_method',
                'pickup_instructions',
                'pickup_collected_at',
                'pickup_collected_by',
                'inspection_condition',
                'inspection_notes',
                'inspection_photos',
                'inspected_at',
                'inspected_by',
                'exchange_order_id',
                'exchange_dispatched_at',
                'replacement_dispatched_at',
                'closed_at',
            ],
            'product_reviews' => ['photos'],
            'chat_messages' => ['images'],
        ] as $table => $columns) {
            foreach ($columns as $column) {
                $this->assertTrue(
                    Schema::hasColumn($table, $column),
                    "Missing consolidated column: {$table}.{$column}"
                );
            }
        }
    }
}
