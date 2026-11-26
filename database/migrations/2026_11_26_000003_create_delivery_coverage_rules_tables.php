<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('delivery_coverage_rules', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('name', 180);
            $table->string('description', 1000)->nullable();
            $table->string('scope_type', 24);
            $table->foreignId('province_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('district_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('municipality_id')->nullable()->constrained()->cascadeOnDelete();
            $table->foreignId('ward_id')->nullable()->constrained('wards')->cascadeOnDelete();
            $table->string('decision', 12)->default('allow');
            $table->string('service_mode', 12)->default('all');
            $table->unsignedSmallInteger('priority')->default(0);
            $table->timestamp('effective_from')->nullable();
            $table->timestamp('effective_to')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['is_active', 'scope_type'], 'coverage_rules_active_scope_index');
            $table->index(['province_id', 'district_id', 'municipality_id', 'ward_id'], 'coverage_rules_scope_index');
            $table->index(['decision', 'service_mode', 'priority'], 'coverage_rules_decision_index');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_coverage_rules');
    }
};
