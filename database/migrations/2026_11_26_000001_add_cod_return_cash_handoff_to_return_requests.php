<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('return_requests', function (Blueprint $table) {
            $table->decimal('cash_refund_amount', 12, 2)->nullable();
            $table->timestamp('cash_refund_handed_at')->nullable();
            $table->foreignId('cash_refund_handed_by')->nullable()->constrained('users')->nullOnDelete();
        });
    }

    public function down(): void
    {
        Schema::table('return_requests', function (Blueprint $table) {
            $table->dropForeign(['cash_refund_handed_by']);
            $table->dropColumn(['cash_refund_amount', 'cash_refund_handed_at', 'cash_refund_handed_by']);
        });
    }
};
