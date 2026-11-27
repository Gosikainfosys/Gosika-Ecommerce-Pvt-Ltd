<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('return_requests', function (Blueprint $table) {
            $table->foreignId('delivery_partner_id')
                ->nullable()
                ->after('cash_refund_handed_by')
                ->constrained('delivery_partners')
                ->nullOnDelete();
            $table->timestamp('delivery_partner_assigned_at')->nullable();
            $table->foreignId('delivery_partner_assigned_by')
                ->nullable()
                ->constrained('users')
                ->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('return_requests', function (Blueprint $table) {
            $table->dropColumn([
                'delivery_partner_id',
                'delivery_partner_assigned_at',
                'delivery_partner_assigned_by',
            ]);
        });
    }
};
