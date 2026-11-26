<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasColumn('custom_coverage_polygons', 'is_coverage_area')) {
            Schema::table('custom_coverage_polygons', function (Blueprint $table) {
                $table->boolean('is_coverage_area')->default(false)->after('reason');
                $table->index(['is_coverage_area', 'verification_status', 'is_active'], 'custom_polygons_area_index');
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasColumn('custom_coverage_polygons', 'is_coverage_area')) {
            Schema::table('custom_coverage_polygons', function (Blueprint $table) {
                $table->dropIndex('custom_polygons_area_index');
                $table->dropColumn('is_coverage_area');
            });
        }
    }
};
