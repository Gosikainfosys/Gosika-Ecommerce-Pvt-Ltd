<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('wards', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('municipality_id')->constrained()->cascadeOnDelete();
            $table->unsignedTinyInteger('ward_number');
            $table->string('name', 120)->nullable();
            $table->string('code', 40)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->unique(['municipality_id', 'ward_number']);
            $table->index(['municipality_id', 'is_active']);
        });

        Schema::create('geo_boundary_imports', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('provider', 80);
            $table->string('dataset_version', 150);
            $table->string('level', 40);
            $table->string('source', 180)->nullable();
            $table->string('source_url', 500)->nullable();
            $table->string('license', 120)->nullable();
            $table->string('file', 255)->nullable();
            $table->string('checksum', 64)->nullable();
            $table->string('status', 20)->default('running');
            $table->json('summary')->nullable();
            $table->text('error')->nullable();
            $table->timestamp('imported_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->index(['level', 'status']);
        });

        Schema::create('geo_boundaries', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('geo_type', 24);
            $table->unsignedBigInteger('geo_id');
            $table->foreignId('province_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('district_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('municipality_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('ward_id')->nullable()->constrained('wards')->cascadeOnDelete();
            $table->foreignId('import_id')->nullable()->constrained('geo_boundary_imports')->nullOnDelete();
            $table->string('source_feature_id', 100)->nullable();
            $table->string('source_name', 180)->nullable();
            $table->longText('geometry');
            $table->longText('display_geometry')->nullable();
            $table->decimal('bbox_min_lng', 10, 7)->nullable();
            $table->decimal('bbox_min_lat', 10, 7)->nullable();
            $table->decimal('bbox_max_lng', 10, 7)->nullable();
            $table->decimal('bbox_max_lat', 10, 7)->nullable();
            $table->string('dataset_version', 150);
            $table->string('source', 180)->nullable();
            $table->string('source_url', 500)->nullable();
            $table->string('license', 120)->nullable();
            $table->boolean('is_verified')->default(false);
            $table->string('validation_status', 20)->default('pending');
            $table->json('validation_errors')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamp('imported_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->unique(['geo_type', 'geo_id', 'dataset_version'], 'geo_boundaries_type_id_version_unique');
            $table->index(['geo_type', 'geo_id', 'is_active'], 'geo_boundaries_lookup_index');
            $table->index(['bbox_min_lng', 'bbox_min_lat', 'bbox_max_lng', 'bbox_max_lat'], 'geo_boundaries_bbox_index');
            $table->index(['import_id', 'validation_status']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('geo_boundaries');
        Schema::dropIfExists('geo_boundary_imports');
        Schema::dropIfExists('wards');
    }
};
