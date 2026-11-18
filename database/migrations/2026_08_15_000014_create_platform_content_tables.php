<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('notification_templates', function (Blueprint $table) {
            $table->id();
            $table->string('name', 150)->unique();
            $table->string('channel', 20)->default('email')->comment('email|sms|push|in_app');
            $table->string('subject', 300)->nullable();
            $table->text('body');
            $table->json('variables')->nullable();
            $table->boolean('is_active')->default(true);
            $table->timestamps();
        });

        Schema::create('banners', function (Blueprint $table) {
            $table->id();
            $table->string('title', 200)->nullable();
            $table->text('description')->nullable();
            $table->string('image');
            $table->string('link', 500)->nullable();
            $table->string('position', 30)->default('home_hero')->index();
            $table->unsignedInteger('sort_order')->default(0);
            $table->boolean('is_active')->default(true);
            $table->date('starts_at')->nullable();
            $table->date('ends_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamps();
            $table->softDeletes();
        });

        Schema::create('broadcasts', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('title', 200);
            $table->text('message');
            $table->string('channel', 20)->default('in_app')->comment('email|sms|push|in_app');
            $table->string('target_type', 30)->default('all')->comment('all|customers|vendors|delivery');
            $table->json('target_ids')->nullable();
            $table->string('status', 20)->default('sent');
            $table->unsignedBigInteger('reach')->default(0);
            $table->timestamp('sent_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['target_type', 'status']);
        });

        Schema::create('cms_pages', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('title', 180);
            $table->string('slug', 200)->unique();
            $table->string('excerpt', 400)->nullable();
            $table->longText('body')->nullable();
            $table->string('type', 20)->default('policy')->index();
            $table->string('status', 20)->default('draft')->index();
            $table->json('meta')->nullable();
            $table->unsignedInteger('sort_order')->default(0);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->unsignedBigInteger('deleted_by')->nullable();
            $table->timestamps();
            $table->softDeletes();

            $table->index(['type', 'status']);
        });

        Schema::create('seo_meta', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('entity_type', 50);
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('meta_title', 200)->nullable();
            $table->string('meta_description', 500)->nullable();
            $table->string('meta_keywords', 500)->nullable();
            $table->string('canonical_url', 500)->nullable();
            $table->string('robots', 100)->default('index,follow');
            $table->string('og_title', 200)->nullable();
            $table->string('og_description', 500)->nullable();
            $table->string('og_image', 500)->nullable();
            $table->string('twitter_card', 20)->default('summary_large_image');
            $table->string('twitter_title', 200)->nullable();
            $table->string('twitter_description', 500)->nullable();
            $table->boolean('is_noindex')->default(false);
            $table->boolean('is_nofollow')->default(false);
            $table->json('structured_data')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->unique(['entity_type', 'entity_id']);
        });

        Schema::create('seo_templates', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('entity_type', 50);
            $table->string('name', 100);
            $table->string('title_template', 300);
            $table->string('description_template', 600)->nullable();
            $table->boolean('is_default')->default(false);
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();
        });

        Schema::create('seo_keywords', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('keyword', 200);
            $table->string('language', 10)->default('en');
            $table->string('search_intent', 30)->nullable();
            $table->string('entity_type', 50)->nullable();
            $table->tinyInteger('priority')->default(5);
            $table->text('notes')->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->index('keyword');
        });

        Schema::create('seo_redirects', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('source_path', 500);
            $table->string('target_path', 500);
            $table->smallInteger('redirect_type')->default(301);
            $table->boolean('is_active')->default(true);
            $table->unsignedBigInteger('hit_count')->default(0);
            $table->timestamp('last_hit_at')->nullable();
            $table->string('notes', 255)->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->unique('source_path');
        });

        Schema::create('seo_audit_results', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->string('entity_type', 50);
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('entity_url', 500)->nullable();
            $table->string('issue_type', 80);
            $table->string('severity', 20);
            $table->text('description');
            $table->text('recommendation')->nullable();
            $table->boolean('is_resolved')->default(false);
            $table->timestamp('resolved_at')->nullable();
            $table->unsignedBigInteger('resolved_by')->nullable();
            $table->unsignedBigInteger('created_by')->nullable();
            $table->unsignedBigInteger('updated_by')->nullable();
            $table->timestamps();

            $table->index(['entity_type', 'entity_id']);
            $table->index(['severity', 'is_resolved']);
        });

        Schema::create('vendor_notifications', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('vendor_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 60)->default('general');
            $table->string('title', 250);
            $table->text('body')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable()->index();
            $table->unsignedBigInteger('updated_by')->nullable()->index();
            $table->timestamps();

            $table->index(['vendor_id', 'read_at']);
        });

        Schema::create('customer_notifications', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->string('type', 60)->default('general');
            $table->string('title', 250);
            $table->text('body')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable()->index();
            $table->unsignedBigInteger('updated_by')->nullable()->index();
            $table->timestamps();

            $table->index(['user_id', 'read_at']);
        });

        Schema::create('admin_notifications', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 60)->default('general');
            $table->string('title', 250);
            $table->text('body')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable()->index();
            $table->unsignedBigInteger('updated_by')->nullable()->index();
            $table->timestamps();

            $table->index(['user_id', 'read_at']);
        });

        Schema::create('delivery_notifications', function (Blueprint $table) {
            $table->id();
            $table->uuid()->unique();
            $table->foreignId('delivery_partner_id')->nullable()->constrained()->nullOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->string('type', 60)->default('general');
            $table->string('title', 250);
            $table->text('body')->nullable();
            $table->json('data')->nullable();
            $table->timestamp('read_at')->nullable();
            $table->unsignedBigInteger('created_by')->nullable()->index();
            $table->unsignedBigInteger('updated_by')->nullable()->index();
            $table->timestamps();

            $table->index(['delivery_partner_id', 'read_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('delivery_notifications');
        Schema::dropIfExists('admin_notifications');
        Schema::dropIfExists('customer_notifications');
        Schema::dropIfExists('vendor_notifications');
        Schema::dropIfExists('seo_audit_results');
        Schema::dropIfExists('seo_redirects');
        Schema::dropIfExists('seo_keywords');
        Schema::dropIfExists('seo_templates');
        Schema::dropIfExists('seo_meta');
        Schema::dropIfExists('cms_pages');
        Schema::dropIfExists('broadcasts');
        Schema::dropIfExists('banners');
        Schema::dropIfExists('notification_templates');
    }
};
