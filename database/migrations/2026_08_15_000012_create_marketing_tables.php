<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('coupons', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->nullable()->constrained()->nullOnDelete();
            $table->uuid()->unique();
            $table->string('code', 60)->unique();
            $table->string('name', 180)->nullable();
            $table->text('description')->nullable();
            $table->string('discount_type', 20)->default('percentage');
            $table->decimal('discount_value', 12, 2)->default(0);
            $table->decimal('min_order_amount', 12, 2)->default(0);
            $table->decimal('max_discount', 12, 2)->nullable();
            $table->unsignedBigInteger('usage_limit')->default(0)->comment('0 = unlimited');
            $table->unsignedBigInteger('per_user_limit')->default(1);
            $table->unsignedBigInteger('used_count')->default(0);
            $table->date('valid_from')->nullable();
            $table->date('valid_until')->nullable();
            $table->boolean('is_active')->default(true);
            $table->string('applies_to', 30)->default('all')->comment('all|store|product');
            $table->json('applies_to_ids')->nullable();
            $table->boolean('is_first_order_only')->default(false);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['is_active', 'valid_from', 'valid_until']);
            $table->index('vendor_id');
        });

        Schema::create('coupon_redemptions', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('coupon_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('order_id')->constrained()->cascadeOnDelete();
            $table->decimal('discount_amount', 12, 2)->default(0);
            $table->timestamp('redeemed_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->index(['coupon_id', 'user_id']);
            $table->unique(['coupon_id', 'order_id']);
        });

        Schema::create('campaigns', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('title', 200);
            $table->string('tagline', 300)->nullable();
            $table->text('description')->nullable();
            $table->string('image', 600)->nullable();
            $table->string('type', 30)->default('promo')->index();
            $table->string('target_type', 20)->default('all');
            $table->json('target_ids')->nullable();
            $table->string('discount_type', 20)->nullable();
            $table->decimal('discount_value', 12, 2)->nullable();
            $table->decimal('min_order_amount', 12, 2)->nullable();
            $table->string('status', 20)->default('draft')->index();
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamp('start_date')->nullable();
            $table->timestamp('end_date')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['status', 'start_date', 'end_date']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('campaigns');
        Schema::dropIfExists('coupon_redemptions');
        Schema::dropIfExists('coupons');
    }
};
