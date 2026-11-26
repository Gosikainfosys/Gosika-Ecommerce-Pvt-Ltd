<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('custom_coverage_polygons', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('name', 180);
            $table->string('description', 1000)->nullable();
            $table->text('reason');
            $table->foreignId('province_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('district_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('municipality_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('ward_id')->nullable()->constrained('wards')->cascadeOnDelete();
            $table->longText('geometry');
            $table->longText('display_geometry')->nullable();
            $table->decimal('bbox_min_lng', 10, 7)->nullable();
            $table->decimal('bbox_min_lat', 10, 7)->nullable();
            $table->decimal('bbox_max_lng', 10, 7)->nullable();
            $table->decimal('bbox_max_lat', 10, 7)->nullable();
            $table->string('source', 180)->nullable();
            $table->string('source_url', 500)->nullable();
            $table->string('verification_status', 20)->default('pending');
            $table->timestamp('verified_at')->nullable();
            $table->unsignedBigInteger('verified_by')->nullable();
            $table->timestamp('expires_at')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['is_active', 'verification_status'], 'custom_polygons_status_index');
            $table->index(['province_id', 'district_id', 'municipality_id', 'ward_id'], 'custom_polygons_scope_index');
            $table->index(['bbox_min_lng', 'bbox_min_lat', 'bbox_max_lng', 'bbox_max_lat'], 'custom_polygons_bbox_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('custom_coverage_polygons');
    }
};
