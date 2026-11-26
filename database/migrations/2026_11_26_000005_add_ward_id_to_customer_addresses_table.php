<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('customer_addresses') && ! Schema::hasColumn('customer_addresses', 'ward_id')) {
            Schema::table('customer_addresses', function (Blueprint $table) {
                $table->foreignId('ward_id')->nullable()->after('municipality_id')->constrained('wards')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('customer_addresses') && Schema::hasColumn('customer_addresses', 'ward_id')) {
            Schema::table('customer_addresses', function (Blueprint $table) {
                $table->dropConstrainedForeignId('ward_id');
            });
        }
    }
};
