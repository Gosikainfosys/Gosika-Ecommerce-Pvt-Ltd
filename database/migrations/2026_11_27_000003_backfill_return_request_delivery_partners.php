<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        DB::table('return_requests')
            ->whereNull('delivery_partner_id')
            ->whereExists(function ($query) {
                $query->selectRaw('1')
                    ->from('delivery_assignments')
                    ->whereColumn('delivery_assignments.vendor_order_id', 'return_requests.vendor_order_id')
                    ->whereNotNull('delivery_assignments.delivered_at');
            })
            ->update([
                'delivery_partner_id' => DB::raw(
                    '(SELECT delivery_assignments.delivery_partner_id '
                    .'FROM delivery_assignments '
                    .'WHERE delivery_assignments.vendor_order_id = return_requests.vendor_order_id '
                    .'AND delivery_assignments.delivered_at IS NOT NULL '
                    .'ORDER BY delivery_assignments.id DESC LIMIT 1)'
                ),
                'delivery_partner_assigned_at' => DB::raw('CURRENT_TIMESTAMP'),
            ]);
    }

    public function down(): void
    {
        // Backfilled assignments are intentionally retained.
    }
};
