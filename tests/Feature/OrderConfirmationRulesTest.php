<?php

namespace Tests\Feature;

use App\Modules\Catalog\Infrastructure\Models\Product;
use App\Modules\Catalog\Infrastructure\Models\ProductImage;
use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Marketing\Application\Mail\OrderConfirmationMail;
use App\Modules\Marketing\Application\Mail\OrderStatusMail;
use App\Modules\Marketing\Application\Services\NotificationDispatcher;
use App\Modules\Marketing\Infrastructure\Models\CustomerNotification;
use App\Modules\Marketplace\Infrastructure\Models\ProductReview;
use App\Modules\Order\Application\Services\OrderConfirmationSchedulerService;
use App\Modules\Order\Infrastructure\Models\Order;
use App\Modules\Order\Infrastructure\Models\OrderItem;
use App\Modules\Order\Infrastructure\Models\ReturnRequest;
use App\Modules\Order\Infrastructure\Models\VendorOrder;
use App\Modules\Order\Presentation\Resources\OrderResource;
use App\Modules\Payment\Application\Services\RefundService;
use App\Modules\Payment\Application\Services\PaymentService;
use App\Modules\Payment\Domain\Contracts\PaymentProviderContract;
use App\Modules\Payment\Domain\Exceptions\PaymentProviderException;
use App\Modules\Payment\Infrastructure\Models\Payment;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Payment\Infrastructure\Services\EsewaProvider;
use App\Modules\Platform\Infrastructure\Models\Setting;
use App\Modules\Shared\Domain\Enums\DeliveryStatus;
use App\Modules\Shared\Domain\Enums\CommissionStatus;
use App\Modules\Shared\Domain\Enums\OrderPaymentStatus;
use App\Modules\Shared\Domain\Enums\OrderStatus;
use App\Modules\Shared\Domain\Enums\PaymentMethod;
use App\Modules\Shared\Domain\Enums\PaymentStatus;
use App\Modules\Shared\Domain\Enums\RefundStatus;
use App\Modules\Shared\Domain\Enums\SettlementStatus;
use App\Modules\Shared\Domain\Enums\ReturnStatus;
use App\Modules\Shared\Domain\Enums\StoreStatus;
use App\Modules\Shared\Domain\Enums\UserStatus;
use App\Modules\Shared\Domain\Enums\VendorStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shipping\Application\Services\DeliveryService;
use App\Modules\Shipping\Infrastructure\Models\DeliveryAssignment;
use App\Modules\Shipping\Infrastructure\Models\DeliveryPartner;
use App\Modules\Vendor\Infrastructure\Models\Store;
use App\Modules\Vendor\Infrastructure\Models\BankAccount;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use App\Modules\Wallet\Application\Services\PayoutSchedule;
use App\Modules\Wallet\Application\Services\WalletService;
use App\Modules\Wallet\Infrastructure\Models\Commission;
use App\Modules\Wallet\Infrastructure\Models\PayoutRecord;
use App\Modules\Wallet\Infrastructure\Models\Settlement;
use App\Modules\Wallet\Infrastructure\Models\VendorWallet;
use App\Modules\Wallet\Infrastructure\Models\WalletTransaction;
use App\Modules\Wallet\Presentation\Resources\SettlementResource;
use Carbon\Carbon;
use Database\Seeders\RolePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class OrderConfirmationRulesTest extends TestCase
{
    use RefreshDatabase;

    protected User $adminUser;

    protected User $vendorUser;

    protected Vendor $vendor;

    protected Store $store;

    protected Product $product;

    protected function setUp(): void
    {
        parent::setUp();

        $this->seed(RolePermissionSeeder::class);

        // Super Admin
        $this->adminUser = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Super',
            'last_name' => 'Admin',
            'email' => 'admin@gosika.com',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->adminUser->assignRole(Roles::SUPER_ADMIN);

        // Vendor Admin
        $this->vendorUser = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Vendor',
            'last_name' => 'Seller',
            'email' => 'vendor@gosika.com',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $this->vendorUser->assignRole(Roles::VENDOR_ADMIN);

        $this->vendor = Vendor::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $this->vendorUser->id,
            'company_name' => 'Himalayan Handicrafts',
            'business_email' => 'art@gosika.com',
            'business_phone' => '9800000010',
            'status' => VendorStatus::APPROVED,
        ]);

        $this->store = Store::create([
            'uuid' => (string) Str::uuid(),
            'vendor_id' => $this->vendor->id,
            'name' => 'Himalayan Store',
            'slug' => 'himalayan-store-'.Str::random(6),
            'status' => StoreStatus::ACTIVE,
        ]);

        $this->product = Product::create([
            'uuid' => (string) Str::uuid(),
            'vendor_id' => $this->vendor->id,
            'store_id' => $this->store->id,
            'name' => 'Singing Bowl',
            'slug' => 'singing-bowl-'.Str::random(6),
            'sku' => 'SKU-'.strtoupper(Str::random(8)),
            'price' => 1200.00,
            'quantity' => 10,
            'stock_status' => 'in_stock',
            'status' => 'published',
        ]);

        // Default admin settings
        Setting::set('order.cancellation_window_minutes', 15, 'orders', 'integer', true);
        Setting::set('order.vendor_confirmation_deadline_hours', 24, 'orders', 'integer', true);
        Setting::set('order.auto_confirmation_enabled', false, 'orders', 'boolean', true);
        Setting::set('order.auto_confirmation_minutes', 30, 'orders', 'integer', true);
    }

    protected function tearDown(): void
    {
        Carbon::setTestNow();
        parent::tearDown();
    }

    protected function createOrder(
        OrderStatus $status = OrderStatus::PENDING,
        bool $isCod = true,
        ?Carbon $placedAt = null,
        int $qty = 2
    ): array {
        $now = $placedAt ?? now();

        $customer = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Sital',
            'last_name' => 'Mahato',
            'email' => 'customer_'.Str::random(8).'@gosika.com',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $customer->assignRole(Roles::CUSTOMER);

        $order = Order::create([
            'uuid' => (string) Str::uuid(),
            'order_number' => 'ORD-'.strtoupper(Str::random(8)),
            'user_id' => $customer->id,
            'payment_method' => $isCod ? PaymentMethod::COD->value : 'esewa',
            'payment_status' => $isCod ? OrderPaymentStatus::PENDING : OrderPaymentStatus::PAID,
            'status' => $status,
            'subtotal' => 2400.00,
            'delivery_charge' => 100.00,
            'grand_total' => 2500.00,
            'currency' => 'NPR',
            'placed_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $vendorOrder = VendorOrder::create([
            'uuid' => (string) Str::uuid(),
            'vendor_order_number' => 'VO-'.strtoupper(Str::random(8)),
            'order_id' => $order->id,
            'vendor_id' => $this->vendor->id,
            'store_id' => $this->store->id,
            'status' => $status,
            'delivery_status' => 'pending',
            'items_subtotal' => 2400.00,
            'delivery_charge' => 100.00,
            'grand_total' => 2500.00,
            'created_at' => $now,
            'updated_at' => $now,
        ]);

        $item = OrderItem::create([
            'uuid' => (string) Str::uuid(),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'vendor_id' => $this->vendor->id,
            'product_id' => $this->product->id,
            'product_name' => $this->product->name,
            'quantity' => $qty,
            'unit_price' => 1200.00,
            'line_total' => 2400.00,
        ]);

        return [$order, $vendorOrder, $customer];
    }

    public function test_customer_review_photos_can_be_uploaded_and_published_by_admin(): void
    {
        [, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $vendorOrder->update(['delivery_status' => DeliveryStatus::DELIVERED]);
        $orderItem = $vendorOrder->items()->firstOrFail();
        Storage::fake('public');

        $response = $this->actingAs($customer)->post(
            "/api/v1/marketplace/products/{$this->product->uuid}/reviews",
            [
                'rating' => 5,
                'title' => 'Great quality',
                'body' => 'The product looks just like the listing.',
                'order_item_id' => $orderItem->uuid,
                'photos' => [UploadedFile::fake()->image('customer-review.png')],
            ]
        )
            ->assertCreated()
            ->assertJsonPath('data.status', 'pending')
            ->assertJsonCount(1, 'data.photos');

        $reviewId = $response->json('data.id');
        $review = ProductReview::query()->where('uuid', $reviewId)->firstOrFail();
        $this->assertCount(1, $review->photos);
        Storage::disk('public')->assertExists($review->photos[0]);

        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/reviews/product/{$reviewId}/approve")
            ->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonCount(1, 'data.photos');

        $this->getJson("/api/v1/marketplace/products/{$this->product->uuid}/reviews")
            ->assertOk()
            ->assertJsonPath('data.0.status', 'approved')
            ->assertJsonCount(1, 'data.0.photos');
    }

    // ── 1. Customer cancellation succeeds during allowed window ─────────

    public function test_customer_cancellation_succeeds_during_allowed_window(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder();

        // Cancel 5 minutes after placement (within 15-minute window)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(5));

        $response = $this->actingAs($customer)->postJson("/api/v1/orders/{$order->uuid}/cancel", [
            'reason' => 'Changed my mind',
        ]);

        $response->assertStatus(200);
        $this->assertEquals(OrderStatus::CANCELLED->value, $order->fresh()->status->value);
        $this->assertEquals(OrderStatus::CANCELLED->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals('Changed my mind', $order->fresh()->cancelled_reason);

        $this->assertSame(10, $this->product->fresh()->quantity);
    }

    public function test_cancelled_order_cannot_start_or_complete_payment(): void
    {
        [$order, , $customer] = $this->createOrder(OrderStatus::CANCELLED);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::FAILED,
            'initiated_at' => now(),
        ]);
        $paymentService = app(PaymentService::class);

        try {
            $paymentService->initiate($order, $customer, 'esewa');
            $this->fail('Cancelled order payment initiation should be rejected.');
        } catch (PaymentProviderException $exception) {
            $this->assertSame('This order has been cancelled and cannot be paid.', $exception->getMessage());
        }

        try {
            $paymentService->markPaid($payment);
            $this->fail('Cancelled order payment callback should be rejected.');
        } catch (PaymentProviderException $exception) {
            $this->assertSame('This order has been cancelled and cannot be paid.', $exception->getMessage());
        }

        $this->assertSame(PaymentStatus::FAILED, $payment->fresh()->status);
        $this->assertSame(OrderStatus::CANCELLED, $order->fresh()->status);
    }

    public function test_online_order_only_gets_delivery_otp_after_payment_is_confirmed(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::PAYMENT_PENDING, false);
        $order->update(['payment_status' => OrderPaymentStatus::PENDING]);
        $vendorOrder->update(['status' => OrderStatus::PENDING]);

        $resourceBeforePayment = OrderResource::make($order->fresh())->toArray(request());
        $this->assertNull($resourceBeforePayment['delivery_otp']);
        Mail::fake();

        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PROCESSING,
            'initiated_at' => now(),
        ]);

        app(PaymentService::class)->markPaid($payment);
        app(PaymentService::class)->markPaid($payment->fresh());

        $paidOrder = $order->fresh();
        $this->assertSame(OrderPaymentStatus::PAID, $paidOrder->payment_status);
        $this->assertSame(OrderStatus::CONFIRMED, $paidOrder->status);
        $this->assertMatchesRegularExpression('/^\d{6}$/', $paidOrder->meta['delivery_otp']);
        $this->assertSame($paidOrder->meta['delivery_otp'], $vendorOrder->fresh()->meta['delivery_otp']);
        $this->assertSame(1, CustomerNotification::query()->where('user_id', $customer->id)->count());
        $this->assertSame(
            OrderStatus::CONFIRMED->value,
            CustomerNotification::query()->where('user_id', $customer->id)->firstOrFail()->data['status']
        );
        Mail::assertSent(OrderConfirmationMail::class, function (OrderConfirmationMail $mail) use ($order): bool {
            $html = $mail->render();

            return str_contains($html, $order->order_number)
                && str_contains($html, 'Payment received')
                && str_contains($html, 'awaiting seller acceptance');
        });
        Mail::assertNotSent(OrderStatusMail::class);
    }

    public function test_pending_online_order_sends_accurate_payment_pending_notification_and_email(): void
    {
        [$order, , $customer] = $this->createOrder(OrderStatus::PAYMENT_PENDING, false);
        $order->update(['payment_status' => OrderPaymentStatus::PENDING]);
        Mail::fake();

        $dispatcher = app(NotificationDispatcher::class);
        $dispatcher->orderPlaced($order->fresh());
        $dispatcher->orderConfirmation($order->fresh());

        $notification = CustomerNotification::query()->where('user_id', $customer->id)->firstOrFail();
        $this->assertSame('payment', $notification->type);
        $this->assertSame('Payment pending for order '.$order->order_number, $notification->title);
        $this->assertSame('payment_pending', $notification->data['status']);
        $this->assertSame('pending', $notification->data['payment_status']);
        $this->assertSame('order_placed', $notification->data['event']);

        Mail::assertSent(OrderStatusMail::class);
        $statusMail = Mail::sent(OrderStatusMail::class)->first();
        $statusEmailHtml = $statusMail->render();
        $this->assertStringContainsString($order->order_number, $statusEmailHtml);
        $this->assertStringContainsString('Singing Bowl', $statusEmailHtml);
        $this->assertStringContainsString('pending', strtolower($statusEmailHtml));
        Mail::assertNotSent(OrderConfirmationMail::class);
    }

    public function test_vendor_acceptance_does_not_confirm_or_notify_an_unpaid_online_order(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::PAYMENT_PENDING, false);
        $order->update(['payment_status' => OrderPaymentStatus::PENDING]);
        $vendorOrder->update(['status' => OrderStatus::PENDING]);
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(20));
        Mail::fake();

        app(DeliveryService::class)->vendorAccept($vendorOrder, $this->vendorUser);

        $pendingOrder = $order->fresh();
        $this->assertSame(OrderStatus::PAYMENT_PENDING, $pendingOrder->status);
        $this->assertNull($pendingOrder->confirmed_at);
        $this->assertSame(0, CustomerNotification::query()->where('user_id', $customer->id)->count());
        Mail::assertNotSent(OrderConfirmationMail::class);
        Mail::assertNotSent(OrderStatusMail::class);
    }

    public function test_verified_esewa_cancellation_cancels_order_without_changing_stock(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::PAYMENT_PENDING, false);
        $order->update(['payment_status' => OrderPaymentStatus::PENDING]);
        $vendorOrder->update(['status' => OrderStatus::PENDING]);

        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PROCESSING,
            'initiated_at' => now(),
        ]);

        $paymentService = app(PaymentService::class);
        $paymentService->setProvider('esewa', new class implements PaymentProviderContract
        {
            public function name(): string
            {
                return 'esewa';
            }

            public function initiate(array $payload): array
            {
                return [];
            }

            public function lookup(string $reference, ?array $params = null): array
            {
                return ['status' => 'CANCELED'];
            }
        });

        $paymentService->verifyEsewaOrderStatus($payment);

        $this->assertSame(PaymentStatus::FAILED, $payment->fresh()->status);
        $this->assertSame(OrderStatus::CANCELLED, $order->fresh()->status);
        $this->assertSame(OrderStatus::CANCELLED, $vendorOrder->fresh()->status);
        $this->assertSame(10, $this->product->fresh()->quantity);
        $this->assertNull(OrderResource::make($order->fresh())->toArray(request())['delivery_otp']);
    }

    // ── 2. Cancellation with "Other" requires explanation ──────────────

    public function test_cancellation_with_other_requires_text_explanation(): void
    {
        [$order, , $customer] = $this->createOrder();

        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(5));

        // Missing explanation
        $res = $this->actingAs($customer)->postJson("/api/v1/orders/{$order->uuid}/cancel", [
            'reason' => 'Other',
        ]);
        $res->assertStatus(422);

        // With valid explanation
        $validRes = $this->actingAs($customer)->postJson("/api/v1/orders/{$order->uuid}/cancel", [
            'reason' => 'Other',
            'explanation' => 'Emergency travel plans came up suddenly.',
        ]);
        $validRes->assertStatus(200);
        $this->assertStringContainsString('Emergency travel plans', $order->fresh()->cancelled_reason);
    }

    // ── 3. Customer cancellation rejected after window expires ──────────

    public function test_customer_cancellation_rejected_after_cancellation_window(): void
    {
        [$order, , $customer] = $this->createOrder();

        // Advance 16 minutes (15 min window has expired)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(16));

        $res = $this->actingAs($customer)->postJson("/api/v1/orders/{$order->uuid}/cancel", [
            'reason' => 'Changed my mind',
        ]);

        $res->assertStatus(422);
        $this->assertStringContainsString('cancellation window', strtolower($res->json('message')));
        $this->assertEquals(OrderStatus::PENDING->value, $order->fresh()->status->value);
    }

    // ── 4. Vendor confirmation is blocked during cancellation window ────

    public function test_vendor_confirmation_blocked_during_cancellation_window(): void
    {
        [, $vendorOrder] = $this->createOrder();

        // 5 minutes after placement -> vendor tries to accept
        Carbon::setTestNow(Carbon::parse($vendorOrder->created_at)->addMinutes(5));

        $res = $this->actingAs($this->vendorUser)->postJson("/api/v1/vendor/orders/{$vendorOrder->uuid}/accept");

        $res->assertStatus(422);
        $this->assertStringContainsString('cancellation window', strtolower($res->json('message')));
        $this->assertEquals(OrderStatus::PENDING->value, $vendorOrder->fresh()->status->value);
    }

    public function test_paid_online_order_can_be_confirmed_during_cancellation_window(): void
    {
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::PENDING, false);

        $this->actingAs($this->vendorUser)
            ->getJson("/api/v1/vendor/orders/{$vendorOrder->uuid}")
            ->assertOk()
            ->assertJsonPath('data.can_confirm', true)
            ->assertJsonPath('data.cancellation_window_seconds_remaining', 0);

        $res = $this->postJson("/api/v1/vendor/orders/{$vendorOrder->uuid}/accept");

        $res->assertOk();
        $this->assertSame(OrderStatus::ACCEPTED, $vendorOrder->fresh()->status);
        $this->assertSame(OrderStatus::CONFIRMED, $order->fresh()->status);
    }

    // ── 5. Manual confirmation succeeds after window & before deadline ──

    public function test_manual_confirmation_succeeds_after_window_and_before_deadline(): void
    {
        [$order, $vendorOrder] = $this->createOrder();

        // 20 minutes after placement (cancellation window 15m expired, deadline 24h intact)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(20));

        $res = $this->actingAs($this->vendorUser)->postJson("/api/v1/vendor/orders/{$vendorOrder->uuid}/accept");

        $res->assertStatus(200);
        $this->assertEquals(OrderStatus::ACCEPTED->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::CONFIRMED->value, $order->fresh()->status->value);
        $this->assertEquals('manual', $vendorOrder->fresh()->meta['confirmation_method']);
    }

    public function test_admin_can_update_order_status_and_vendor_package_status_with_history(): void
    {
        [$order, $vendorOrder] = $this->createOrder();

        $this->actingAs($this->adminUser)
            ->patchJson("/api/v1/admin/orders/{$order->uuid}/status", [
                'status' => OrderStatus::REJECTED->value,
            ])
            ->assertUnprocessable();

        $res = $this->actingAs($this->adminUser)->patchJson("/api/v1/admin/orders/{$order->uuid}/status", [
            'status' => OrderStatus::OUT_FOR_DELIVERY->value,
            'reason' => 'Handed to delivery partner.',
        ]);

        $res->assertOk()
            ->assertJsonPath('data.status', OrderStatus::OUT_FOR_DELIVERY->value)
            ->assertJsonPath('data.status_history.0.to_status', OrderStatus::OUT_FOR_DELIVERY->value);
        $this->assertSame(OrderStatus::OUT_FOR_DELIVERY, $order->fresh()->status);
        $this->assertSame(OrderStatus::OUT_FOR_DELIVERY, $vendorOrder->fresh()->status);
    }

    public function test_admin_delivered_status_syncs_delivery_and_generates_matured_settlement(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 14]]);
        $deliveredAt = Carbon::now()->subDays(15);
        Carbon::setTestNow($deliveredAt);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::PENDING, false);
        $vendorOrder->update([
            'grand_total' => 2500,
            'commission_rate' => 10,
            'commission_amount' => 250,
            'vendor_payable' => 2250,
        ]);

        $this->actingAs($this->adminUser)
            ->patchJson("/api/v1/admin/orders/{$order->uuid}/status", [
                'status' => OrderStatus::DELIVERED->value,
                'reason' => 'Delivery verified by admin.',
            ])
            ->assertOk();

        $this->assertSame(DeliveryStatus::DELIVERED, $vendorOrder->fresh()->delivery_status);
        $this->assertSame(DeliveryStatus::DELIVERED, $vendorOrder->items()->firstOrFail()->fresh()->delivery_status);

        Carbon::setTestNow($deliveredAt->copy()->addDays(15));
        app(OrderConfirmationSchedulerService::class)->run();

        $settlement = Settlement::query()->firstOrFail();
        $this->assertSame('2250.00', $settlement->net_payable);
        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/settlements?group_by_vendor=1')
            ->assertOk()
            ->assertJsonPath('data.0.vendor_id', $this->vendor->uuid)
            ->assertJsonPath('data.0.status', 'released');
    }

    public function test_admin_settlement_summaries_include_all_vendors_stores_and_earned_balances(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::DELIVERED, false);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'grand_total' => 2500,
            'commission_rate' => 10,
            'commission_amount' => 250,
            'vendor_payable' => 2250,
        ]);
        Store::create([
            'uuid' => (string) Str::uuid(),
            'vendor_id' => $this->vendor->id,
            'name' => 'Himalayan Outlet',
            'slug' => 'himalayan-outlet-'.Str::random(6),
            'status' => StoreStatus::ACTIVE,
        ]);

        $secondVendorUser = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Second',
            'last_name' => 'Vendor',
            'email' => 'second_vendor_'.Str::random(8).'@gosika.com',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $secondVendorUser->assignRole(Roles::VENDOR_ADMIN);
        $secondVendor = Vendor::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $secondVendorUser->id,
            'company_name' => 'Unsettled Vendor',
            'business_email' => 'second_'.Str::random(8).'@gosika.com',
            'business_phone' => '9800000020',
            'status' => VendorStatus::APPROVED,
        ]);
        Store::create([
            'uuid' => (string) Str::uuid(),
            'vendor_id' => $secondVendor->id,
            'name' => 'New Vendor Shop',
            'slug' => 'new-vendor-shop-'.Str::random(6),
            'status' => StoreStatus::ACTIVE,
        ]);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/settlements?group_by_vendor=1')
            ->assertOk()
            ->assertJsonCount(2, 'data')
            ->assertJsonPath('data.0.vendor_id', $this->vendor->uuid)
            ->assertJsonPath('data.0.stores.0.name', 'Himalayan Outlet')
            ->assertJsonPath('data.0.stores.1.name', 'Himalayan Store')
            ->assertJsonPath('data.0.gross_sales', '2500.00')
            ->assertJsonPath('data.0.commission_total', '250.00')
            ->assertJsonPath('data.0.earned_total', '2250.00')
            ->assertJsonPath('data.0.unsettled_balance', '0.00')
            ->assertJsonPath('data.0.net_payable', '2250.00')
            ->assertJsonPath('data.0.available_balance', '2250.00')
            ->assertJsonPath('data.0.pending_balance', '0.00')
            ->assertJsonPath('data.1.vendor_id', $secondVendor->uuid)
            ->assertJsonPath('data.1.stores.0.name', 'New Vendor Shop')
            ->assertJsonPath('data.1.settlements_count', 0)
            ->assertJsonPath('data.1.earned_total', '0.00');
    }

    public function test_unmatured_earnings_are_visible_but_not_available_for_payout(): void
    {
        Setting::set('settlement.waiting_days', 7, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::DELIVERED, false);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'commission_rate' => 10,
            'commission_amount' => 250,
            'vendor_payable' => 2250,
        ]);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/settlements?group_by_vendor=1')
            ->assertOk()
            ->assertJsonPath('data.0.earned_total', '2250.00')
            ->assertJsonPath('data.0.unsettled_balance', '2250.00')
            ->assertJsonPath('data.0.net_payable', '0.00')
            ->assertJsonPath('data.0.available_balance', '0.00');

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/vendors/'.$this->vendor->uuid.'/ledger')
            ->assertOk()
            ->assertJsonPath('data.stats.unsettled_earnings', '2250.00')
            ->assertJsonPath('data.stats.settlement_holding_days', 7)
            ->assertJsonPath('data.stats.orders_count', 1)
            ->assertJsonPath('data.stats.total_commission', '250.00')
            ->assertJsonPath('data.stats.total_net_payable', '2250.00')
            ->assertJsonPath('data.wallet.balance', '0.00')
            ->assertJsonPath('data.wallet.available_balance', '0.00');
    }

    // ── 6. Customer cancellation blocked once order is confirmed ────────

    public function test_customer_cancellation_blocked_after_order_is_confirmed(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder();

        // Vendor confirms after window
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(20));
        $this->actingAs($this->vendorUser)->postJson("/api/v1/vendor/orders/{$vendorOrder->uuid}/accept");

        // Customer attempts to cancel confirmed order
        $res = $this->actingAs($customer)->postJson("/api/v1/orders/{$order->uuid}/cancel", [
            'reason' => 'Changed my mind',
        ]);

        $res->assertStatus(422);
        $this->assertEquals(
            'This order has been confirmed and can no longer be cancelled. Please contact support for assistance.',
            $res->json('message')
        );
        $this->assertEquals(OrderStatus::CONFIRMED->value, $order->fresh()->status->value);
    }

    // ── 7. Automatic confirmation occurs at configured duration ─────────

    public function test_automatic_confirmation_occurs_at_configured_duration_when_enabled(): void
    {
        Setting::set('order.auto_confirmation_enabled', true, 'orders', 'boolean', true);
        Setting::set('order.auto_confirmation_minutes', 30, 'orders', 'integer', true);

        [$order, $vendorOrder] = $this->createOrder(isCod: true);

        // Advance 32 minutes (past 15m cancellation window and past 30m auto-confirm duration)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(32));

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $results = $scheduler->run();

        $this->assertEquals(1, $results['auto_confirmed']);
        $this->assertEquals(OrderStatus::ACCEPTED->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::CONFIRMED->value, $order->fresh()->status->value);
        $this->assertEquals('automatic', $vendorOrder->fresh()->meta['confirmation_method']);
    }

    // ── 8. Automatic confirmation blocked when disabled ─────────────────

    public function test_automatic_confirmation_does_not_occur_when_disabled(): void
    {
        Setting::set('order.auto_confirmation_enabled', false, 'orders', 'boolean', true);

        [$order, $vendorOrder] = $this->createOrder(isCod: true);

        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(35));

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $results = $scheduler->run();

        $this->assertEquals(0, $results['auto_confirmed']);
        $this->assertEquals(OrderStatus::PENDING->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::PENDING->value, $order->fresh()->status->value);
    }

    // ── 9. Automatic confirmation blocked for unpaid online orders ──────

    public function test_automatic_confirmation_blocked_for_unpaid_online_orders(): void
    {
        Setting::set('order.auto_confirmation_enabled', true, 'orders', 'boolean', true);
        Setting::set('order.auto_confirmation_minutes', 30, 'orders', 'integer', true);

        // Create online order with PENDING payment
        [$order, $vendorOrder] = $this->createOrder(isCod: false);
        $order->payment_status = OrderPaymentStatus::PENDING;
        $order->save();

        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(35));

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $results = $scheduler->run();

        // Must not auto-confirm until paid
        $this->assertEquals(0, $results['auto_confirmed']);
        $this->assertEquals(OrderStatus::PENDING->value, $vendorOrder->fresh()->status->value);
    }

    // ── 10. Auto-cancel when maximum confirmation deadline expires ──────

    public function test_orders_cancelled_when_vendor_deadline_expires(): void
    {
        Setting::set('order.vendor_confirmation_deadline_hours', 24, 'orders', 'integer', true);

        [$order, $vendorOrder] = $this->createOrder();
        // Advance 25 hours (past 24h deadline)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addHours(25));

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $results = $scheduler->run();

        $this->assertEquals(1, $results['expired_cancelled']);
        $this->assertEquals(OrderStatus::CANCELLED->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::CANCELLED->value, $order->fresh()->status->value);
        $this->assertEquals('Vendor did not confirm within the allowed time', $order->fresh()->cancelled_reason);

        $this->assertSame(10, $this->product->fresh()->quantity);
    }

    public function test_delivered_order_becomes_completed_after_return_window_expires(): void
    {
        [$order] = $this->createOrder(OrderStatus::DELIVERED);
        $order->update(['completed_at' => now()->subDays(8)]);
        Setting::set('return.window_days', 7, 'return', 'integer', true);

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $this->assertSame(1, $scheduler->processExpiredReturnWindows());

        $this->assertSame(OrderStatus::COMPLETED, $order->fresh()->status);
        $this->assertDatabaseHas('order_status_history', [
            'trackable_type' => Order::class,
            'trackable_id' => $order->id,
            'from_status' => OrderStatus::DELIVERED->value,
            'to_status' => OrderStatus::COMPLETED->value,
            'reason' => 'The return and refund window has expired.',
        ]);
        $this->assertSame(0, $scheduler->processExpiredReturnWindows());
    }

    public function test_delivered_order_without_completed_at_completes_after_assignment_return_window_expires(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::DELIVERED);
        $order->update(['completed_at' => null]);
        $partner = DeliveryPartner::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $this->vendorUser->id,
            'name' => 'Delivery Partner',
            'phone' => '9800000098',
            'status' => 'approved',
        ]);
        DeliveryAssignment::create([
            'uuid' => (string) Str::uuid(),
            'vendor_order_id' => $vendorOrder->id,
            'delivery_partner_id' => $partner->id,
            'status' => DeliveryStatus::DELIVERED,
            'delivery_fee' => 100,
            'delivered_at' => now()->subDays(8),
        ]);

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $this->assertSame(1, $scheduler->processExpiredReturnWindows());
        $this->assertSame(OrderStatus::COMPLETED, $order->fresh()->status);
    }

    public function test_return_request_window_starts_at_delivery_and_expires_after_configured_days(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED);
        $deliveredAt = now()->subDays(2)->startOfSecond();
        $order->update(['completed_at' => $deliveredAt]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $item = $order->items()->firstOrFail();

        $this->actingAs($customer)
            ->getJson('/api/v1/orders/'.$order->uuid)
            ->assertOk()
            ->assertJsonPath('data.can_request_return', true)
            ->assertJsonPath('data.return_window_expires_at', $deliveredAt->copy()->addDays(7)->toISOString());

        $response = $this->actingAs($customer)
            ->postJson('/api/v1/customer/returns', [
                'order_id' => $order->uuid,
                'order_item_id' => $item->uuid,
                'request_type' => 'return_refund',
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 1,
                'preferred_resolution' => 'Refund to original payment method (eSewa / Khalti / Bank)',
                'return_method' => 'pickup',
            ])
            ->assertCreated();

        $this->assertMatchesRegularExpression('/^RTN-[A-F0-9]{8}$/', $response->json('data.return_number'));

        $this->assertDatabaseHas('return_requests', [
            'order_id' => $order->id,
            'order_item_id' => $item->id,
            'request_type' => 'return_refund',
            'preferred_resolution' => 'Refund to original payment method (eSewa / Khalti / Bank)',
            'return_method' => 'pickup',
            'window_expires_at' => $deliveredAt->copy()->addDays(7)->toDateTimeString(),
            'refund_amount' => 1200.00,
        ]);

        [$expiredOrder, $expiredVendorOrder, $expiredCustomer] = $this->createOrder(OrderStatus::DELIVERED);
        $expiredOrder->update(['completed_at' => now()->subDays(8)]);
        $expiredVendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $expiredItem = $expiredOrder->items()->firstOrFail();

        $this->actingAs($expiredCustomer)
            ->postJson('/api/v1/customer/returns', [
                'order_id' => $expiredOrder->uuid,
                'order_item_id' => $expiredItem->uuid,
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 1,
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'The return and refund window for this order has expired.');
    }

    public function test_order_items_use_product_primary_image_when_the_order_snapshot_is_empty(): void
    {
        [$order] = $this->createOrder(OrderStatus::DELIVERED);
        $item = $order->items()->firstOrFail();
        $item->update(['image' => null]);

        ProductImage::create([
            'product_id' => $item->product_id,
            'file_path' => 'products/primary-fallback.jpg',
            'is_primary' => true,
        ]);

        $this->actingAs($order->user)
            ->getJson('/api/v1/orders/'.$order->uuid)
            ->assertOk()
            ->assertJsonPath('data.items.0.image', url('/storage/products/primary-fallback.jpg'));
    }

    public function test_only_delivered_orders_are_eligible_for_return_requests(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::COMPLETED);
        $deliveredAt = now()->subDay();
        $order->update(['completed_at' => $deliveredAt]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $item = $order->items()->firstOrFail();

        $this->actingAs($customer)
            ->getJson('/api/v1/orders/'.$order->uuid)
            ->assertOk()
            ->assertJsonPath('data.can_request_return', false);

        $this->actingAs($customer)
            ->postJson('/api/v1/customer/returns', [
                'order_id' => $order->uuid,
                'order_item_id' => $item->uuid,
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 1,
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Returns can only be requested after the order has been delivered.');
    }

    public function test_return_quantity_cannot_exceed_the_quantity_ordered(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, qty: 2);
        $deliveredAt = now()->subDay();
        $order->update(['completed_at' => $deliveredAt]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $item = $order->items()->firstOrFail();

        $this->actingAs($customer)
            ->postJson('/api/v1/customer/returns', [
                'order_id' => $order->uuid,
                'order_item_id' => $item->uuid,
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 3,
            ])
            ->assertUnprocessable()
            ->assertJsonPath('message', 'Return quantity exceeds purchased quantity.');
    }

    public function test_successfully_resolved_items_cannot_be_requested_again(): void
    {
        foreach ([
            ReturnStatus::REFUNDED,
            ReturnStatus::COMPLETED,
            ReturnStatus::EXCHANGE_DISPATCHED,
            ReturnStatus::REPLACEMENT_DISPATCHED,
        ] as $status) {
            [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED);
            $deliveredAt = now()->subDay();
            $order->update(['completed_at' => $deliveredAt]);
            $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
            $item = $order->items()->firstOrFail();

            ReturnRequest::create([
                'return_number' => 'RTN-'.strtoupper(Str::random(8)),
                'user_id' => $customer->id,
                'order_id' => $order->id,
                'vendor_order_id' => $vendorOrder->id,
                'order_item_id' => $item->id,
                'store_id' => $this->store->id,
                'vendor_id' => $this->vendor->id,
                'request_type' => 'return_refund',
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 1,
                'refund_amount' => 1200,
                'status' => $status,
                'window_expires_at' => $deliveredAt->copy()->addDays(7),
            ]);

            $this->actingAs($customer)
                ->getJson('/api/v1/orders/'.$order->uuid)
                ->assertOk()
                ->assertJsonPath('data.can_request_return', false)
                ->assertJsonPath('data.items.0.can_request_return', false);

            $this->actingAs($customer)
                ->postJson('/api/v1/customer/returns', [
                    'order_id' => $order->uuid,
                    'order_item_id' => $item->uuid,
                    'reason_type' => 'damaged',
                    'reason' => 'Trying to request another return.',
                    'quantity' => 1,
                ])
                ->assertUnprocessable()
                ->assertJsonPath(
                    'message',
                    'This item has already been refunded, returned, exchanged, or replaced.'
                );
        }
    }

    public function test_delivered_orders_without_completed_at_use_delivery_assignment_date_for_return_window(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED);
        $deliveredAt = now()->subDays(2)->startOfSecond();
        $order->update(['completed_at' => null]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);

        $partner = DeliveryPartner::create([
            'uuid' => (string) Str::uuid(),
            'user_id' => $this->vendorUser->id,
            'name' => 'Delivery Partner',
            'phone' => '9800000099',
            'status' => 'approved',
        ]);
        DeliveryAssignment::create([
            'uuid' => (string) Str::uuid(),
            'vendor_order_id' => $vendorOrder->id,
            'delivery_partner_id' => $partner->id,
            'status' => DeliveryStatus::DELIVERED,
            'delivery_fee' => 100,
            'delivered_at' => $deliveredAt,
        ]);

        $this->actingAs($customer)
            ->getJson('/api/v1/orders')
            ->assertOk()
            ->assertJsonFragment([
                'can_request_return' => true,
                'return_window_expires_at' => $deliveredAt->copy()->addDays(7)->toISOString(),
            ]);

        $item = $order->items()->firstOrFail();
        $this->actingAs($customer)
            ->postJson('/api/v1/customer/returns', [
                'order_id' => $order->uuid,
                'order_item_id' => $item->uuid,
                'reason_type' => 'damaged',
                'reason' => 'The item arrived damaged.',
                'quantity' => 1,
            ])
            ->assertCreated();
    }

    // ── 11. Admin settings validation enforces precedence ───────────────

    public function test_admin_settings_validation_enforces_precedence_rules(): void
    {
        // 1. auto_confirmation_minutes cannot be less than cancellation_window
        $res = $this->actingAs($this->adminUser)->putJson('/api/v1/admin/settings/orders', [
            'cancellation_window_minutes' => 20,
            'vendor_confirmation_deadline_hours' => 24,
            'auto_confirmation_enabled' => true,
            'auto_confirmation_minutes' => 10, // Invalid: 10 < 20
        ]);
        $res->assertStatus(422);
        $this->assertStringContainsString('cannot be less than', $res->json('message'));

        // 2. auto_confirmation_minutes cannot exceed deadline
        $res2 = $this->actingAs($this->adminUser)->putJson('/api/v1/admin/settings/orders', [
            'cancellation_window_minutes' => 15,
            'vendor_confirmation_deadline_hours' => 2, // 120 minutes
            'auto_confirmation_enabled' => true,
            'auto_confirmation_minutes' => 150, // Invalid: 150 >= 120
        ]);
        $res2->assertStatus(422);
        $this->assertStringContainsString('strictly less than', $res2->json('message'));

        // 3. Valid settings save successfully
        $res3 = $this->actingAs($this->adminUser)->putJson('/api/v1/admin/settings/orders', [
            'cancellation_window_minutes' => 15,
            'vendor_confirmation_deadline_hours' => 24,
            'auto_confirmation_enabled' => true,
            'auto_confirmation_minutes' => 45,
        ]);
        $res3->assertStatus(200);

        // Verify retrieval via getOrders
        $getRes = $this->actingAs($this->adminUser)->getJson('/api/v1/admin/settings/orders');
        $getRes->assertStatus(200);
        $this->assertEquals(45, $getRes->json('data.auto_confirmation_minutes'));
    }

    // ── 12. Vendor can configure order confirmation settings in store ───

    public function test_vendor_can_configure_order_confirmation_settings_in_store(): void
    {
        $res = $this->actingAs($this->vendorUser)->putJson("/api/v1/vendor/stores/{$this->store->uuid}", [
            'name' => $this->store->name,
            'settings' => [
                'order_confirmation_mode' => 'automatic',
                'auto_confirmation_minutes' => 30,
                'auto_ready_for_pickup' => true,
                'estimated_prep_time' => '15 mins',
                'pickup_instructions' => 'Ring warehouse doorbell at rear entrance.',
            ],
        ]);

        $res->assertStatus(200);
        $freshStore = $this->store->fresh();
        $this->assertEquals('automatic', $freshStore->settings['order_confirmation_mode']);
        $this->assertEquals(30, $freshStore->settings['auto_confirmation_minutes']);
        $this->assertTrue($freshStore->settings['auto_ready_for_pickup']);
        $this->assertEquals('15 mins', $freshStore->settings['estimated_prep_time']);
        $this->assertEquals('Ring warehouse doorbell at rear entrance.', $freshStore->settings['pickup_instructions']);
    }

    // ── 13. Store automatic confirmation and auto ready for pickup ──────

    public function test_store_automatic_confirmation_and_auto_ready_for_pickup(): void
    {
        // Global platform auto-confirmation is FALSE
        Setting::set('order.auto_confirmation_enabled', false, 'orders', 'boolean', true);

        // Store enables automatic confirmation and auto_ready_for_pickup
        $this->store->update([
            'settings' => [
                'order_confirmation_mode' => 'automatic',
                'auto_confirmation_minutes' => 15,
                'auto_ready_for_pickup' => true,
            ],
        ]);

        [$order, $vendorOrder] = $this->createOrder(isCod: true);

        // 16 minutes after placement (cancellation window 15m passed, auto-confirm 15m passed)
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(16));

        $scheduler = app(OrderConfirmationSchedulerService::class);
        $results = $scheduler->run();

        $this->assertEquals(1, $results['auto_confirmed']);
        // Order directly transitions to READY_FOR_PICKUP because auto_ready_for_pickup is true
        $this->assertEquals(OrderStatus::READY_FOR_PICKUP->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::READY_FOR_PICKUP->value, $order->fresh()->status->value);
        $this->assertEquals('automatic', $vendorOrder->fresh()->meta['confirmation_method']);
    }

    // ── 14. Manual confirmation with auto ready for pickup ──────────────

    public function test_manual_vendor_confirmation_with_auto_ready_for_pickup(): void
    {
        $this->store->update([
            'settings' => [
                'order_confirmation_mode' => 'manual',
                'auto_ready_for_pickup' => true,
            ],
        ]);

        [$order, $vendorOrder] = $this->createOrder(isCod: true);

        // Accept after cancellation window
        Carbon::setTestNow(Carbon::parse($order->placed_at)->addMinutes(20));

        $res = $this->actingAs($this->vendorUser)->postJson("/api/v1/vendor/orders/{$vendorOrder->uuid}/accept");
        $res->assertStatus(200);

        // Vendor accepted, and auto_ready_for_pickup automatically advanced to READY_FOR_PICKUP
        $this->assertEquals(OrderStatus::READY_FOR_PICKUP->value, $vendorOrder->fresh()->status->value);
        $this->assertEquals(OrderStatus::READY_FOR_PICKUP->value, $order->fresh()->status->value);
    }

    public function test_refund_amount_is_linked_and_financial_status_updates_only_when_refunded(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $item = $order->items()->firstOrFail();
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(8)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'request_type' => 'return_refund',
            'reason_type' => 'damaged',
            'reason' => 'Item arrived damaged',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);

        $service = app(RefundService::class);
        $vendorOrder->update(['vendor_payable' => 2300]);
        $refund = $service->create($payment, $this->adminUser, 100, 'Approved return', null, $return);

        $this->assertSame($return->id, $refund->return_request_id);
        $this->assertSame($item->id, $refund->order_item_id);
        $this->assertSame('100.00', $return->fresh()->refund_amount);
        $this->assertSame(ReturnStatus::REFUND_PENDING, $return->fresh()->status);

        $service->approve($this->adminUser, $refund);
        $this->assertSame(PaymentStatus::PAID, $payment->fresh()->status);
        $this->assertSame(OrderPaymentStatus::PAID, $order->fresh()->payment_status);

        $service->updateStatus($this->adminUser, $refund, RefundStatus::REFUNDED);

        $this->assertSame(PaymentStatus::PARTIALLY_REFUNDED, $payment->fresh()->status);
        $this->assertSame(OrderPaymentStatus::PARTIALLY_REFUNDED, $order->fresh()->payment_status);
        $this->assertSame(ReturnStatus::REFUNDED, $return->fresh()->status);

        $this->actingAs($customer)
            ->getJson("/api/v1/orders/{$order->uuid}")
            ->assertOk()
            ->assertJsonPath('data.grand_total', '2500.00')
            ->assertJsonPath('data.refunded_amount', '100.00')
            ->assertJsonPath('data.net_total', '2400.00');

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/orders')
            ->assertOk()
            ->assertJsonPath('data.0.refunded_amount', '100.00')
            ->assertJsonPath('data.0.net_total', '2400.00')
            ->assertJsonPath('data.0.return_categories.0', 'Return & Refund');

        $this->actingAs($this->vendorUser)
            ->getJson('/api/v1/vendor/orders')
            ->assertOk()
            ->assertJsonPath('data.0.refunded_amount', '100.00')
            ->assertJsonPath('data.0.net_total', '2400.00')
            ->assertJsonPath('data.0.net_vendor_payable', '2200.00')
            ->assertJsonPath('data.0.return_categories.0', 'Return & Refund');
    }

    public function test_admin_return_approval_requires_notes_and_keeps_customer_requested_category(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED);
        $item = $order->items()->firstOrFail();
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(10)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'request_type' => 'exchange',
            'reason_type' => 'damaged',
            'reason' => 'Customer requested an exchange.',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::REQUESTED,
        ]);

        $endpoint = "/api/v1/admin/orders/returns/{$return->uuid}/approve";

        $this->actingAs($this->adminUser)
            ->postJson($endpoint)
            ->assertUnprocessable();

        $this->actingAs($this->adminUser)
            ->postJson($endpoint, ['notes' => 'Approved after reviewing the evidence.'])
            ->assertOk();

        $this->assertSame('exchange', $return->fresh()->request_type->value);
        $this->assertSame('Approved after reviewing the evidence.', $return->fresh()->review_notes);
    }

    public function test_admin_can_update_refund_status_from_its_return_only(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $item = $order->items()->firstOrFail();
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'khalti',
            'provider' => 'khalti',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(10)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'reason_type' => 'damaged',
            'reason' => 'Item arrived damaged.',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);
        $refund = app(RefundService::class)->create($payment, $this->adminUser, 100, 'Approved return', null, $return);
        $unrelatedReturn = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(10)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'reason_type' => 'damaged',
            'reason' => 'Another return request.',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);

        $this->actingAs($this->adminUser)
            ->patchJson("/api/v1/admin/orders/returns/{$return->uuid}/refunds/{$refund->uuid}/status", ['status' => 'processing'])
            ->assertOk()
            ->assertJsonPath('data.status', 'processing');

        $this->actingAs($this->adminUser)
            ->patchJson("/api/v1/admin/orders/returns/{$unrelatedReturn->uuid}/refunds/{$refund->uuid}/status", ['status' => 'refunded'])
            ->assertNotFound();
    }

    public function test_refund_cannot_exceed_the_returned_quantity_value(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $item = $order->items()->firstOrFail();
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(8)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'reason_type' => 'damaged',
            'reason' => 'Item arrived damaged',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);

        try {
            app(RefundService::class)->create($payment, $this->adminUser, 1200.01, 'Over limit', null, $return);
            $this->fail('A refund above the returned quantity value should be rejected.');
        } catch (DomainException $exception) {
            $this->assertSame(422, $exception->getStatusCode());
        }

        $this->assertSame(0, Refund::query()->count());
    }

    public function test_admin_can_create_refund_using_the_selected_return_amount(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: true);
        $item = $order->items()->firstOrFail();
        Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'cod',
            'provider' => 'manual',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(8)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'reason_type' => 'damaged',
            'reason' => 'Item arrived damaged',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);

        $response = $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/returns/{$return->uuid}/refund", [
                'method' => 'cod',
                'amount' => '321.50',
                'refund_type' => 'partial',
                'notes' => 'Refund verified by admin',
            ]);

        $response->assertOk()
            ->assertJsonPath('data.amount', '321.50')
            ->assertJsonPath('data.refund_type', 'partial');
        $this->assertDatabaseHas('refunds', [
            'return_request_id' => $return->id,
            'order_item_id' => $item->id,
            'amount' => 321.50,
        ]);
        $this->assertSame('321.50', $return->fresh()->refund_amount);
        $this->assertSame(ReturnStatus::REFUND_PENDING, $return->fresh()->status);

        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/returns/{$return->uuid}/refund", [
                'method' => 'cod',
                'amount' => '878.50',
                'refund_type' => 'full',
            ])
            ->assertOk()
            ->assertJsonPath('data.amount', '2178.50')
            ->assertJsonPath('data.refund_type', 'full');
        $this->assertSame('2500.00', $return->fresh()->refund_amount);

        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/orders/returns/{$return->uuid}")
            ->assertOk()
            ->assertJsonPath('data.refunds.0.refund_type', 'partial')
            ->assertJsonPath('data.refunds.1.refund_type', 'full')
            ->assertJsonPath('data.paid_amount', '2500.00')
            ->assertJsonPath('data.full_refund_amount', '0.00');
    }

    public function test_admin_can_select_prorated_tax_and_delivery_for_a_return_refund(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: true);
        $order->update([
            'tax' => 100,
            'grand_total' => 2600,
        ]);
        $item = $order->items()->firstOrFail();
        $return = ReturnRequest::create([
            'return_number' => 'RTN-'.strtoupper(Str::random(8)),
            'user_id' => $customer->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'order_item_id' => $item->id,
            'store_id' => $this->store->id,
            'vendor_id' => $this->vendor->id,
            'reason_type' => 'damaged',
            'reason' => 'Item arrived damaged',
            'quantity' => 1,
            'refund_amount' => 1200,
            'status' => ReturnStatus::APPROVED,
        ]);

        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/returns/{$return->uuid}/refund", [
                'method' => 'cod',
                'amount' => '1300.00',
                'refund_type' => 'partial',
                'include_tax' => true,
                'include_delivery' => true,
            ])
            ->assertOk()
            ->assertJsonPath('data.amount', '1300.00')
            ->assertJsonPath('data.refund_type', 'partial');

        $refund = Refund::query()->where('return_request_id', $return->id)->firstOrFail();
        $this->assertSame(1200.0, (float) data_get($refund->provider_response, 'return_refund_limits.item_amount'));
        $this->assertSame(50.0, (float) data_get($refund->provider_response, 'return_refund_limits.tax_amount'));
        $this->assertSame(50.0, (float) data_get($refund->provider_response, 'return_refund_limits.delivery_amount'));
    }

    public function test_admin_can_start_an_approved_exchange_from_order_detail(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED);
        $deliveredAt = now()->subDay();
        $order->update(['completed_at' => $deliveredAt]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $item = $order->items()->firstOrFail();

        $response = $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/{$order->uuid}/returns", [
                'order_item_id' => $item->uuid,
                'request_type' => 'exchange',
                'reason_type' => 'quality_issue',
                'reason' => 'Customer reported a quality issue.',
                'quantity' => 1,
            ]);

        $response->assertCreated()
            ->assertJsonPath('data.request_type', 'exchange')
            ->assertJsonPath('data.status', 'approved');

        $returnId = $response->json('data.uuid');
        $this->assertIsString($response->json('data.return_number'));
        $this->assertDatabaseHas('return_requests', [
            'uuid' => $returnId,
            'user_id' => $customer->id,
            'created_by' => $this->adminUser->id,
            'reviewed_by' => $this->adminUser->id,
            'order_item_id' => $item->id,
            'request_type' => 'exchange',
            'status' => 'approved',
        ]);

        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/orders/returns/{$returnId}")
            ->assertOk()
            ->assertJsonPath('data.request_type', 'exchange')
            ->assertJsonPath('data.status', 'approved');
    }

    public function test_admin_can_create_a_full_refund_for_an_order_without_a_customer_return_request(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: true);
        $deliveredAt = now()->subDay();
        $order->update(['completed_at' => $deliveredAt]);
        $vendorOrder->update(['status' => OrderStatus::DELIVERED]);
        $item = $order->items()->firstOrFail();

        $returnResponse = $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/{$order->uuid}/returns", [
                'order_item_id' => $item->uuid,
                'request_type' => 'return_refund',
                'reason_type' => 'damaged',
                'reason' => 'Customer reported that the item arrived damaged.',
                'quantity' => 1,
            ]);

        $returnResponse->assertCreated()
            ->assertJsonPath('data.request_type', 'return_refund')
            ->assertJsonPath('data.status', 'approved');

        $returnId = $returnResponse->json('data.uuid');
        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/orders/returns/{$returnId}")
            ->assertOk()
            ->assertJsonPath('data.paid_amount', '2500.00')
            ->assertJsonPath('data.full_refund_amount', '2500.00');

        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/orders/returns/{$returnId}/refund", [
                'method' => 'cod',
                'refund_type' => 'full',
                'notes' => 'Full order refund approved by admin.',
            ])
            ->assertOk()
            ->assertJsonPath('data.amount', '2500.00')
            ->assertJsonPath('data.refund_type', 'full');

        $return = ReturnRequest::where('uuid', $returnId)->firstOrFail();
        $this->assertDatabaseHas('refunds', [
            'return_request_id' => $return->id,
            'amount' => 2500.00,
        ]);
        $this->assertSame($customer->id, $return->user_id);
    }

    public function test_esewa_refund_initiation_is_reported_as_unsupported(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => $order->grand_total,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $service = (new PaymentService())->setProvider('esewa', new EsewaProvider(
            'test-secret',
            'EPAYTEST',
            'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
            'https://rc.esewa.com.np/api/epay/transaction/status/',
            'https://example.test/success',
            'https://example.test/failure',
        ));

        $result = $service->esewaRefund($payment, 100);

        $this->assertFalse($result['success']);
        $this->assertSame(501, $result['http_status']);
        $this->assertStringContainsString('does not document refund initiation through its API', $result['message']);
    }

    public function test_completed_refunds_reduce_vendor_settlement_and_pending_wallet_balance(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 7]]);
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $order->update(['completed_at' => now()->subDays(10)]);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'grand_total' => 2500,
            'commission_rate' => 8,
            'commission_amount' => 200,
            'vendor_payable' => 2300,
        ]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 100,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);

        $settlement = app(WalletService::class)->settleVendor(
            $this->vendor,
            now()->subDays(30),
            now()
        );

        $this->assertSame('100.00', $settlement->refunds_total);
        $this->assertSame('2200.00', $settlement->net_payable);
        $wallet = app(WalletService::class)->walletForVendor($this->vendor);
        $this->assertSame('2200.00', $wallet->balance);
        $this->assertSame('2200.00', $wallet->pending_balance);
        $this->assertDatabaseHas('wallet_transactions', [
            'wallet_id' => $wallet->id,
            'transaction_type' => 'debit_refund',
            'reference_type' => 'refund',
            'reference_id' => $refund->id,
            'balance_before' => 2300,
            'balance_after' => 2200,
        ]);
    }

    public function test_matured_paid_delivered_order_earnings_become_available_once_after_holding_period(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        Setting::set('settlement.waiting_days', 14, 'settlement', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 14]]);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDays(13)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'grand_total' => 980,
            'commission_rate' => 10,
            'commission_amount' => 90,
            'vendor_payable' => 810,
        ]);
        $scheduler = app(OrderConfirmationSchedulerService::class);

        $this->assertSame(0, $scheduler->run()['earnings_released']);

        $order->update(['completed_at' => now()->subDays(15)]);
        $this->assertSame(1, $scheduler->run()['earnings_released']);

        $walletService = app(WalletService::class);
        $wallet = $walletService->walletForVendor($this->vendor);
        $settlement = Settlement::query()->firstOrFail();
        $this->assertSame('810.00', $wallet->balance);
        $this->assertSame('810.00', $wallet->available_balance);
        $this->assertSame('0.00', $wallet->pending_balance);
        $this->assertSame('810.00', $settlement->net_payable);
        $this->assertSame(SettlementStatus::PAID, $settlement->status);
        $settlementData = SettlementResource::make($settlement->fresh()->load('payoutRequests'))->resolve();
        $this->assertSame('released', $settlementData['status']);
        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/ledger")
            ->assertOk()
            ->assertJsonPath('data.stats.total_released_to_wallet', '810.00')
            ->assertJsonPath('data.stats.total_withdrawn', '0.00')
            ->assertJsonPath('data.settlements.0.status', 'released');

        $this->assertSame(0, $scheduler->run()['earnings_released']);
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'credit_earnings')
            ->where('reference_type', 'vendor_order')
            ->where('reference_id', $vendorOrder->id)
            ->count());
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'credit_settlement')
            ->where('reference_id', $settlement->id)
            ->count());
    }

    public function test_holding_period_changes_reclassify_released_earnings_without_recrediting_them(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDays(3)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 810,
            'commission_rate' => 10,
            'commission_amount' => 90,
        ]);
        $walletService = app(WalletService::class);

        $this->assertSame(1, $walletService->releaseMaturedVendorEarnings());
        $wallet = $walletService->walletForVendor($this->vendor);
        $this->assertSame('810.00', $wallet->available_balance);
        $this->assertSame('0.00', $wallet->pending_balance);

        Setting::set('settlement.waiting_days', 7, 'settlement', 'integer', true);
        $this->assertSame(0, $walletService->releaseMaturedVendorEarnings());
        $wallet = $wallet->fresh();
        $this->assertSame('810.00', $wallet->balance);
        $this->assertSame('0.00', $wallet->available_balance);
        $this->assertSame('810.00', $wallet->pending_balance);
        Setting::set('settlement.payout_frequency', 'manual', 'settlement', 'string', true);
        Setting::set('settlement.min_payout_amount', 0, 'settlement', 'integer', true);

        try {
            $walletService->requestAvailableBalancePayout($this->vendor, 810, null, $this->vendorUser);
            $this->fail('A payout should not be requestable while earnings are below the current holding period.');
        } catch (DomainException $exception) {
            $this->assertSame('Payout amount exceeds the available wallet balance.', $exception->getMessage());
        }

        Setting::set('settlement.waiting_days', 2, 'settlement', 'integer', true);
        $this->assertSame(0, $walletService->releaseMaturedVendorEarnings());
        $wallet = $wallet->fresh();
        $this->assertSame('810.00', $wallet->balance);
        $this->assertSame('810.00', $wallet->available_balance);
        $this->assertSame('0.00', $wallet->pending_balance);
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'credit_earnings')
            ->where('reference_type', 'vendor_order')
            ->where('reference_id', $vendorOrder->id)
            ->count());

        $payout = $walletService->requestAvailableBalancePayout($this->vendor, 810, null, $this->vendorUser);
        $payout = $walletService->approvePayout($payout, $this->adminUser);
        Storage::fake('local');
        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/wallet/payouts/{$payout->uuid}/mark-paid")
            ->assertUnprocessable()
            ->assertJsonValidationErrors('proof_files');
        $this->assertSame('approved', $payout->fresh()->status->value);

        $proof = UploadedFile::fake()->image('transfer-proof.png');
        $this->actingAs($this->adminUser)
            ->post("/api/v1/admin/wallet/payouts/{$payout->uuid}/mark-paid", [
                'notes' => 'Transfer completed by bank wire.',
                'proof_files' => [$proof],
            ])
            ->assertOk()
            ->assertJsonPath('data.records.0.notes', 'Transfer completed by bank wire.')
            ->assertJsonPath('data.records.0.proofs.0.name', 'transfer-proof.png')
            ->assertJsonMissingPath('data.records.0.proofs.0.path');

        $record = $payout->fresh('records')->records->firstOrFail();
        Storage::disk('local')->assertExists($record->meta['proofs'][0]['path']);
        $this->actingAs($this->vendorUser)
            ->get("/api/v1/vendor/wallet/payouts/{$payout->uuid}/records/{$record->uuid}/proofs/0")
            ->assertOk();
        Setting::set('settlement.waiting_days', 7, 'settlement', 'integer', true);
        $walletService->releaseMaturedVendorEarnings();
        $wallet = $wallet->fresh();
        $this->assertSame('0.00', $wallet->balance);
        $this->assertSame('0.00', $wallet->available_balance);
        $this->assertSame('0.00', $wallet->pending_balance);
        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/ledger")
            ->assertOk()
            ->assertJsonPath('data.stats.total_released_to_wallet', '0.00')
            ->assertJsonPath('data.stats.total_withdrawn', '810.00')
            ->assertJsonPath('data.settlements.0.status', 'paid');
        $this->getJson('/api/v1/admin/wallet/settlements?group_by_vendor=1')
            ->assertOk()
            ->assertJsonPath('data.0.status', 'paid');
    }

    public function test_settlement_payout_request_rechecks_current_holding_period(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        Setting::set('settlement.payout_frequency', 'manual', 'settlement', 'string', true);
        Setting::set('settlement.min_payout_amount', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDays(3)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 810,
            'commission_rate' => 10,
            'commission_amount' => 90,
        ]);
        $walletService = app(WalletService::class);
        $settlement = $walletService->settleVendor(
            $this->vendor,
            now()->subDays(3)->startOfDay(),
            now()->subDays(3)->endOfDay()
        );

        Setting::set('settlement.waiting_days', 7, 'settlement', 'integer', true);

        $this->assertCount(0, $walletService->eligibleSettlementsFor($this->vendor));
        try {
            $walletService->requestPayout($settlement, null, $this->vendorUser);
            $this->fail('A settlement payout should not be requestable before the current hold expires.');
        } catch (DomainException $exception) {
            $this->assertSame(
                'Only eligible settlements with a completed cycle can be requested for payout.',
                $exception->getMessage()
            );
        }
    }

    public function test_admin_can_initiate_available_balance_payout_from_vendor_finance_profile(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 2300,
            'commission_rate' => 8,
            'commission_amount' => 200,
        ]);
        $walletService = app(WalletService::class);
        $this->assertSame(1, $walletService->releaseMaturedVendorEarnings());

        $unverifiedAccount = BankAccount::query()->create([
            'vendor_id' => $this->vendor->id,
            'bank_name' => 'Test Bank',
            'account_name' => 'Vendor Seller',
            'account_number' => '1111222233',
            'is_verified' => false,
        ]);
        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/payouts", [
                'amount' => 1500,
                'bank_account_id' => $unverifiedAccount->uuid,
                'provider_reference' => 'TEST-REF-UNVERIFIED',
            ])
            ->assertUnprocessable();

        $verifiedAccount = BankAccount::query()->create([
            'vendor_id' => $this->vendor->id,
            'bank_name' => 'Test Bank',
            'account_name' => 'Vendor Seller',
            'account_number' => '4444555566',
            'is_verified' => true,
            'is_default' => true,
        ]);
        $payoutResponse = $this->postJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/payouts", [
            'amount' => 1500,
            'bank_account_id' => $verifiedAccount->uuid,
            'provider_reference' => 'TEST-ADMIN-DISTRIBUTION',
            'notes' => 'Bank transfer completed.',
        ])
            ->assertCreated()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.funding_source', 'available_balance')
            ->assertJsonPath('data.bank_account.id', $verifiedAccount->uuid)
            ->assertJsonPath('data.records.0.provider_reference', 'TEST-ADMIN-DISTRIBUTION')
            ->assertJsonPath('data.records.0.notes', 'Bank transfer completed.');

        $payoutId = $payoutResponse->json('data.id');
        $payoutRecordId = $payoutResponse->json('data.ledger_reference_id');
        $this->assertDatabaseHas('payout_requests', [
            'uuid' => $payoutId,
            'vendor_id' => $this->vendor->id,
            'settlement_id' => null,
            'amount' => 1500,
            'status' => 'paid',
            'approved_by' => $this->adminUser->id,
            'created_by' => $this->adminUser->id,
        ]);
        $this->assertDatabaseHas('payout_records', [
            'payout_request_id' => $payoutRecordId,
            'amount' => 1500,
            'net_amount' => 1500,
            'status' => 'paid',
            'created_by' => $this->adminUser->id,
        ]);
        $wallet = $walletService->walletForVendor($this->vendor);
        $this->assertSame('800.00', $wallet->balance);
        $this->assertSame('800.00', $wallet->available_balance);

        Storage::fake('local');
        $proof = UploadedFile::fake()->image('after-distribution.png');
        $this->actingAs($this->adminUser)
            ->post("/api/v1/admin/wallet/payouts/{$payoutId}/transfer-details", [
                'provider_reference' => 'TEST-POST-DISTRIBUTION-REF',
                'notes' => 'Receipt uploaded after distribution.',
                'proof_files' => [$proof],
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.records.0.provider_reference', 'TEST-POST-DISTRIBUTION-REF')
            ->assertJsonPath('data.records.0.notes', "Bank transfer completed.\nReceipt uploaded after distribution.")
            ->assertJsonPath('data.records.0.proofs.0.name', 'after-distribution.png');

        $trackingToken = $payoutResponse->json('data.tracking_token');
        $trackingPath = "/api/v1/public/wallet/payouts/{$payoutId}/tracking?token={$trackingToken}";
        $this->getJson($trackingPath)
            ->assertOk()
            ->assertJsonPath('data.payout_number', $payoutResponse->json('data.payout_number'))
            ->assertJsonPath('data.vendor_name', 'Himalayan Handicrafts')
            ->assertJsonPath('data.amount', '1500.00')
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.provider_reference', 'TEST-POST-DISTRIBUTION-REF');
        $this->getJson("/api/v1/public/wallet/payouts/{$payoutId}/tracking?token=invalid")
            ->assertNotFound();

        $record = PayoutRecord::query()->where('payout_request_id', $payoutRecordId)->firstOrFail();
        Storage::disk('local')->assertExists($record->meta['proofs'][0]['path']);
        $this->actingAs($this->vendorUser)
            ->get("/api/v1/vendor/wallet/payouts/{$payoutId}/records/{$record->uuid}/proofs/0")
            ->assertOk();

        Storage::disk('local')->delete($record->meta['proofs'][0]['path']);
        $record->delete();
        $legacyProof = UploadedFile::fake()->image('legacy-payout-receipt.png');
        $this->actingAs($this->adminUser)
            ->post("/api/v1/admin/wallet/payouts/{$payoutId}/transfer-details", [
                'provider_reference' => 'TEST-LEGACY-PAYOUT-REF',
                'proof_files' => [$legacyProof],
            ])
            ->assertOk()
            ->assertJsonPath('data.status', 'paid')
            ->assertJsonPath('data.records.0.amount', '1500.00')
            ->assertJsonPath('data.records.0.provider_reference', 'TEST-LEGACY-PAYOUT-REF')
            ->assertJsonPath('data.records.0.proofs.0.name', 'legacy-payout-receipt.png');

        $legacyRecord = PayoutRecord::query()->where('payout_request_id', $payoutRecordId)->firstOrFail();
        $this->actingAs($this->vendorUser)
            ->getJson('/api/v1/vendor/wallet/payouts')
            ->assertOk()
            ->assertJsonPath('data.0.id', $payoutId)
            ->assertJsonPath('data.0.records.0.provider_reference', 'TEST-LEGACY-PAYOUT-REF')
            ->assertJsonPath('data.0.records.0.proofs.0.name', 'legacy-payout-receipt.png');
        $this->get("/api/v1/vendor/wallet/payouts/{$payoutId}/records/{$legacyRecord->uuid}/proofs/0")
            ->assertOk();

        $this->assertSame('800.00', $wallet->fresh()->balance);
        $this->assertSame('800.00', $wallet->fresh()->available_balance);
        $this->actingAs($this->adminUser)
            ->getJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/ledger")
            ->assertOk()
            ->assertJsonPath('data.stats.total_released_to_wallet', '800.00')
            ->assertJsonPath('data.stats.total_withdrawn', '1500.00');
    }

    public function test_zero_day_holding_period_overrides_return_window_and_vendor_cycle(): void
    {
        Setting::set('return.window_days', 21, 'return', 'integer', true);
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 14]]);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 2300,
            'grand_total' => 2500,
            'commission_rate' => 8,
            'commission_amount' => 200,
        ]);
        $walletService = app(WalletService::class);

        $this->assertSame(1, $walletService->releaseMaturedVendorEarnings());
        $this->assertSame('2300.00', $walletService->walletForVendor($this->vendor)->available_balance);
    }

    public function test_vendor_wallet_refresh_releases_matured_earnings_without_scheduler(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 810,
            'commission_rate' => 10,
            'commission_amount' => 90,
        ]);

        $this->actingAs($this->vendorUser)
            ->postJson('/api/v1/vendor/wallet/release-matured')
            ->assertOk()
            ->assertJsonPath('data.available_balance', '810.00')
            ->assertJsonPath('data.pending_balance', '0.00');
    }

    public function test_weekly_payout_requests_are_only_available_on_sunday_nepal_time(): void
    {
        Setting::set('settlement.payout_frequency', 'weekly', 'settlement', 'string', true);
        Carbon::setTestNow(Carbon::parse('2026-11-25 12:00:00', 'Asia/Kathmandu'));

        $this->actingAs($this->vendorUser)
            ->getJson('/api/v1/vendor/wallet')
            ->assertOk()
            ->assertJsonPath('data.payout_request_window_open', false)
            ->assertJsonPath('data.payout_request_window_label', 'Sunday');

        $this->expectException(DomainException::class);
        $this->expectExceptionMessage('Payout requests are only accepted on Sunday (Nepal time).');

        app(WalletService::class)->requestAvailableBalancePayout($this->vendor, 100, null, $this->vendorUser);
    }

    public function test_payout_schedule_windows_follow_nepal_calendar_dates(): void
    {
        $scheduleDates = [
            ['weekly', '2026-11-29 12:00:00', true],
            ['weekly', '2026-11-28 12:00:00', false],
            ['biweekly', '2026-12-15 12:00:00', true],
            ['biweekly', '2026-12-14 12:00:00', false],
            ['monthly', '2026-12-01 12:00:00', true],
            ['monthly', '2026-12-02 12:00:00', false],
            ['daily', '2026-12-02 12:00:00', true],
            ['manual', '2026-12-02 12:00:00', true],
        ];

        foreach ($scheduleDates as [$frequency, $date, $expected]) {
            $this->assertSame(
                $expected,
                PayoutSchedule::allowsRequest($frequency, Carbon::parse($date, 'Asia/Kathmandu')),
                "{$frequency} schedule on {$date}"
            );
        }
    }

    public function test_vendor_analytics_excludes_rejected_orders_from_projected_earnings(): void
    {
        [, $rejectedVendorOrder] = $this->createOrder(OrderStatus::REJECTED, isCod: false);
        $rejectedVendorOrder->update([
            'vendor_payable' => 2300,
            'commission_amount' => 200,
        ]);
        [, $acceptedVendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $acceptedVendorOrder->update([
            'vendor_payable' => 1800,
            'commission_amount' => 200,
        ]);

        $this->actingAs($this->vendorUser)
            ->getJson('/api/v1/vendor/analytics/summary?range=30d')
            ->assertOk()
            ->assertJsonPath('data.revenue', '2500.00')
            ->assertJsonPath('data.orders_count', 1)
            ->assertJsonPath('data.net_earnings', '1800.00');
    }

    public function test_admin_can_manually_create_a_product_for_an_approved_vendor_store(): void
    {
        $response = $this->actingAs($this->adminUser)
            ->postJson('/api/v1/admin/products', [
                'vendor_id' => $this->vendor->uuid,
                'store_id' => $this->store->uuid,
                'name' => 'Admin-created product',
                'price' => 750,
                'quantity' => 6,
                'status' => 'published',
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Admin-created product')
            ->assertJsonPath('data.status', 'published');

        $this->assertDatabaseHas('products', [
            'uuid' => $response->json('data.id'),
            'vendor_id' => $this->vendor->id,
            'store_id' => $this->store->id,
            'quantity' => 6,
            'price' => 750,
        ]);
    }

    public function test_admin_product_creation_accepts_full_details_variants_attributes_and_uploaded_images(): void
    {
        Storage::fake('public');

        $response = $this->actingAs($this->adminUser)
            ->post('/api/v1/admin/products', [
                'vendor_id' => $this->vendor->uuid,
                'store_id' => $this->store->uuid,
                'name' => 'Admin-created wool scarf',
                'slug' => 'admin-created-wool-scarf',
                'sku' => 'ADMIN-SCARF-001',
                'barcode' => '1234567890123',
                'price' => 1200,
                'compare_at_price' => 1500,
                'cost_price' => 600,
                'quantity' => 0,
                'low_stock_threshold' => 2,
                'weight_grams' => 350,
                'dimensions' => '25x15x8 cm',
                'hs_code' => '621420',
                'tax_rate' => 13,
                'manufacturer' => 'Himalayan Textiles',
                'short_description' => 'A handwoven wool scarf.',
                'description' => 'Made from locally sourced wool.',
                'is_featured' => true,
                'is_negotiable' => false,
                'meta' => json_encode(['origin' => 'Nepal']),
                'variants_present' => true,
                'variants' => [[
                    'sku' => 'ADMIN-SCARF-BLUE',
                    'name' => 'Blue / Medium',
                    'price' => 1200,
                    'quantity' => 4,
                    'options' => ['color' => 'Blue', 'size' => 'Medium'],
                ]],
                'attributes' => [[
                    'name' => 'Material',
                    'type' => 'select',
                    'values' => ['Wool', 'Cotton'],
                ]],
                'images' => [UploadedFile::fake()->image('scarf.png', 100, 100)],
                'primary_image_upload_index' => 0,
            ])
            ->assertCreated()
            ->assertJsonPath('data.name', 'Admin-created wool scarf')
            ->assertJsonPath('data.short_description', 'A handwoven wool scarf.')
            ->assertJsonPath('data.is_featured', true)
            ->assertJsonPath('data.variants.0.options.color', 'Blue')
            ->assertJsonPath('data.attributes.0.name', 'Material');

        $product = Product::query()->where('uuid', $response->json('data.id'))->firstOrFail();
        $this->assertSame(['origin' => 'Nepal'], $product->meta);
        $this->assertDatabaseHas('product_images', [
            'product_id' => $product->id,
            'is_primary' => true,
        ]);
        $this->assertCount(1, Storage::disk('public')->allFiles('products/'.$product->uuid));
    }

    public function test_admin_can_manually_create_an_order_for_a_customer(): void
    {
        $customer = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => 'Manual',
            'last_name' => 'Order Customer',
            'email' => 'manual_order_'.Str::random(8).'@gosika.com',
            'phone' => '9800000020',
            'password' => bcrypt('password'),
            'status' => UserStatus::ACTIVE,
        ]);
        $customer->assignRole(Roles::CUSTOMER);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/customers?status=active&search=Manual%20Order%20Customer')
            ->assertOk()
            ->assertJsonPath('data.0.id', $customer->uuid);

        $response = $this->actingAs($this->adminUser)
            ->postJson('/api/v1/admin/orders', [
                'customer_id' => $customer->uuid,
                'payment_method' => 'cod',
                'payment_status' => 'pending',
                'shipping_address' => [
                    'full_name' => 'Manual Order Customer',
                    'phone' => '9800000020',
                    'address_line_1' => '1 Market Road',
                    'latitude' => 27.7172,
                    'longitude' => 85.3240,
                ],
                'items' => [[
                    'product_id' => $this->product->uuid,
                    'quantity' => 1,
                    'unit_price' => 1200,
                ]],
                'delivery_charge' => 80,
            ])
            ->assertCreated()
            ->assertJsonPath('data.customer.id', $customer->uuid)
            ->assertJsonPath('data.shipping_address.latitude', 27.7172)
            ->assertJsonPath('data.shipping_address.longitude', 85.3240)
            ->assertJsonPath('data.grand_total', '1280.00');

        $this->assertDatabaseHas('orders', [
            'uuid' => $response->json('data.id'),
            'user_id' => $customer->id,
            'status' => OrderStatus::CONFIRMED->value,
            'grand_total' => 1280,
        ]);
    }

    public function test_admin_can_create_manual_order_for_a_new_walk_in_customer(): void
    {
        $response = $this->actingAs($this->adminUser)
            ->postJson('/api/v1/admin/orders', [
                'customer' => [
                    'full_name' => 'Walk In Customer',
                    'phone' => '9800000099',
                ],
                'payment_method' => 'cod',
                'payment_status' => 'pending',
                'shipping_address' => [
                    'full_name' => 'Walk In Customer',
                    'phone' => '9800000099',
                    'address_line_1' => '2 Market Road',
                    'latitude' => 27.7172,
                    'longitude' => 85.3240,
                ],
                'items' => [[
                    'product_id' => $this->product->uuid,
                    'quantity' => 2,
                    'unit_price' => 600,
                ]],
                'delivery_charge' => 80,
            ])
            ->assertCreated()
            ->assertJsonPath('data.customer.name', 'Walk In Customer')
            ->assertJsonPath('data.customer.phone', '9800000099')
            ->assertJsonPath('data.grand_total', '1280.00');

        $customer = User::where('phone', '9800000099')->firstOrFail();

        $this->assertTrue($customer->hasRole(Roles::CUSTOMER));
        $this->assertTrue((bool) data_get($customer->meta, 'manual_order_customer'));
        $this->assertDatabaseHas('orders', [
            'uuid' => $response->json('data.id'),
            'user_id' => $customer->id,
            'status' => OrderStatus::CONFIRMED->value,
        ]);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/customers?status=active&search=Walk%20In')
            ->assertOk()
            ->assertJsonPath('data.0.id', $customer->uuid);
    }

    public function test_matured_earnings_require_paid_and_delivered_order_status(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 7]]);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: true);
        $order->update(['completed_at' => now()->subDays(20)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::PENDING,
            'vendor_payable' => 810,
            'commission_rate' => 10,
            'commission_amount' => 90,
        ]);
        $walletService = app(WalletService::class);

        $this->assertSame(0, $walletService->releaseMaturedVendorEarnings());

        $order->update(['payment_status' => OrderPaymentStatus::PAID]);
        $this->assertSame(0, $walletService->releaseMaturedVendorEarnings());

        $vendorOrder->update(['delivery_status' => DeliveryStatus::DELIVERED]);
        $this->assertSame(1, $walletService->releaseMaturedVendorEarnings());
        $this->assertSame('810.00', $walletService->walletForVendor($this->vendor)->available_balance);
    }

    public function test_admin_available_balance_distribution_requires_and_records_transfer_evidence(): void
    {
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDays(3)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 810,
            'commission_rate' => 10,
            'commission_amount' => 90,
        ]);
        app(WalletService::class)->releaseMaturedVendorEarnings();

        $this->actingAs($this->adminUser)
            ->postJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/payouts", [
                'amount' => 100,
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('proof_files');

        $this->postJson("/api/v1/admin/wallet/vendors/{$this->vendor->uuid}/payouts", [
            'amount' => 100,
            'provider_reference' => 'BANK-TRANSFER-100',
            'notes' => 'Transfer confirmed.',
        ])
            ->assertCreated()
            ->assertJsonPath('data.records.0.provider_reference', 'BANK-TRANSFER-100')
            ->assertJsonPath('data.records.0.notes', 'Transfer confirmed.')
            ->assertJsonPath('data.bank_account', null);

        $this->assertSame('710.00', app(WalletService::class)->walletForVendor($this->vendor)->fresh()->available_balance);
    }

    public function test_matured_existing_settlement_is_distributed_to_available_balance(): void
    {
        Setting::set('return.window_days', 7, 'return', 'integer', true);
        $this->vendor->update(['meta' => ['settlement_cycle_days' => 14]]);
        [$order, $vendorOrder] = $this->createOrder(OrderStatus::COMPLETED, isCod: false);
        $order->update(['completed_at' => now()->subDays(15)]);
        $vendorOrder->update([
            'status' => OrderStatus::COMPLETED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'grand_total' => 980,
            'commission_rate' => 10,
            'commission_amount' => 90,
            'vendor_payable' => 810,
        ]);
        $walletService = app(WalletService::class);
        $settlement = $walletService->settleVendor(
            $this->vendor,
            now()->subDays(15)->startOfDay(),
            now()->subDays(15)->endOfDay()
        );
        $this->assertSame('810.00', $walletService->walletForVendor($this->vendor)->pending_balance);

        $results = app(OrderConfirmationSchedulerService::class)->run();

        $this->assertSame(1, $results['earnings_released']);
        $this->assertSame(SettlementStatus::PAID, $settlement->fresh()->status);
        $this->assertSame('810.00', $walletService->walletForVendor($this->vendor)->available_balance);
        $this->assertSame('0.00', $walletService->walletForVendor($this->vendor)->pending_balance);
    }

    public function test_completed_refund_is_deducted_once_from_pending_then_available_wallet_balance(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 1200,
        ]);
        Commission::query()->create([
            'vendor_order_id' => $vendorOrder->id,
            'order_id' => $order->id,
            'vendor_id' => $this->vendor->id,
            'status' => CommissionStatus::EARNED,
        ]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 1200,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);
        $wallet = VendorWallet::create([
            'vendor_id' => $this->vendor->id,
            'balance' => 1500,
            'pending_balance' => 500,
            'available_balance' => 1000,
            'currency' => 'NPR',
            'version' => 1,
        ]);
        WalletTransaction::create([
            'wallet_id' => $wallet->id,
            'transaction_type' => 'credit_earnings',
            'reference_type' => 'vendor_order',
            'reference_id' => $vendorOrder->id,
            'amount' => 1200,
            'balance_before' => 300,
            'balance_after' => 1500,
            'description' => 'Existing order earnings',
        ]);

        $walletService = app(WalletService::class);
        $walletService->debitRefund($refund);
        $walletService->debitRefund($refund);

        $this->assertSame('300.00', $wallet->fresh()->balance);
        $this->assertSame('0.00', $wallet->fresh()->pending_balance);
        $this->assertSame('300.00', $wallet->fresh()->available_balance);
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('reference_type', 'refund')
            ->where('reference_id', $refund->id)
            ->count());
    }

    public function test_vendor_finance_ledger_repairs_refund_debit_without_earning_transaction(): void
    {
        Setting::set('settlement.waiting_days', 7, 'settlement', 'integer', true);
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'vendor_payable' => 1200,
        ]);
        $order->update(['payment_status' => OrderPaymentStatus::PARTIALLY_REFUNDED]);
        Commission::query()->create([
            'vendor_order_id' => $vendorOrder->id,
            'order_id' => $order->id,
            'vendor_id' => $this->vendor->id,
            'status' => CommissionStatus::EARNED,
        ]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PARTIALLY_REFUNDED,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 1200,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);
        $wallet = VendorWallet::create([
            'vendor_id' => $this->vendor->id,
            'balance' => -1200,
            'pending_balance' => -1200,
            'available_balance' => 0,
            'currency' => 'NPR',
            'version' => 1,
        ]);
        WalletTransaction::create([
            'wallet_id' => $wallet->id,
            'transaction_type' => 'debit_refund',
            'reference_type' => 'refund',
            'reference_id' => $refund->id,
            'amount' => 1200,
            'balance_before' => 0,
            'balance_after' => -1200,
            'description' => 'Customer return refund '.$refund->refund_number,
        ]);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/vendors/'.$this->vendor->uuid.'/ledger')
            ->assertOk()
            ->assertJsonPath('data.wallet.balance', '0.00');

        $this->assertSame('0.00', $wallet->fresh()->balance);
        $this->assertSame('0.00', $wallet->fresh()->pending_balance);
        $this->assertSame('0.00', $wallet->fresh()->available_balance);
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'credit_earnings')
            ->where('reference_type', 'vendor_order')
            ->where('reference_id', $vendorOrder->id)
            ->count());
        $this->assertSame(1, WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'debit_refund')
            ->where('reference_id', $refund->id)
            ->count());
    }

    public function test_payout_page_releases_the_non_refunded_balance_after_a_completed_refund(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        Setting::set('settlement.waiting_days', 0, 'settlement', 'integer', true);
        $order->update(['completed_at' => now()->subDay()]);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'grand_total' => 2114,
            'commission_rate' => 6,
            'commission_amount' => 126.84,
            'vendor_payable' => 1987.16,
        ]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 1800,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);

        app(WalletService::class)->debitRefund($refund);

        $wallet = app(WalletService::class)->walletForVendor($this->vendor);
        $transactions = WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->orderBy('id')
            ->get();

        $this->assertSame('187.16', $wallet->fresh()->balance);
        $this->assertSame('187.16', $wallet->fresh()->pending_balance);
        $this->assertSame('0.00', $wallet->fresh()->available_balance);
        $this->assertCount(2, $transactions);
        $this->assertSame('credit_earnings', $transactions[0]->transaction_type->value);
        $this->assertSame('0.00', $transactions[0]->balance_before);
        $this->assertSame('1987.16', $transactions[0]->balance_after);
        $this->assertSame('debit_refund', $transactions[1]->transaction_type->value);
        $this->assertSame('1800.00', $transactions[1]->amount);
        $this->assertSame('187.16', $transactions[1]->balance_after);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/payout-profiles?per_page=100')
            ->assertOk()
            ->assertJsonPath('data.0.wallet.balance', '187.16')
            ->assertJsonPath('data.0.wallet.available_balance', '187.16')
            ->assertJsonPath('data.0.wallet.pending_balance', '0.00')
            ->assertJsonPath('data.0.earnings_maturity_days', 0);

        $this->actingAs($this->adminUser)
            ->getJson('/api/v1/admin/wallet/settlements?group_by_vendor=1')
            ->assertOk()
            ->assertJsonPath('data.0.earned_total', '187.16')
            ->assertJsonPath('data.0.net_payable', '187.16');
    }

    public function test_refund_debit_records_the_exact_refund_above_vendor_payable(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::DELIVERED, isCod: false);
        $vendorOrder->update([
            'status' => OrderStatus::DELIVERED,
            'delivery_status' => DeliveryStatus::DELIVERED,
            'commission_rate' => 10,
            'vendor_payable' => 1000,
        ]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 1800,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);

        app(WalletService::class)->debitRefund($refund);

        $wallet = app(WalletService::class)->walletForVendor($this->vendor);
        $refundDebit = WalletTransaction::query()
            ->where('wallet_id', $wallet->id)
            ->where('transaction_type', 'debit_refund')
            ->firstOrFail();

        $this->assertSame('-800.00', $wallet->fresh()->balance);
        $this->assertSame('-800.00', $wallet->fresh()->pending_balance);
        $this->assertSame('1800.00', $refundDebit->amount);
    }

    public function test_refund_for_undelivered_order_does_not_debit_vendor_earnings(): void
    {
        [$order, $vendorOrder, $customer] = $this->createOrder(OrderStatus::CANCELLED, isCod: false);
        $vendorOrder->update(['vendor_payable' => 2000]);
        $payment = Payment::create([
            'payment_number' => 'PAY-'.strtoupper(Str::random(10)),
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'user_id' => $customer->id,
            'amount' => 2500,
            'currency' => 'NPR',
            'method' => 'esewa',
            'provider' => 'esewa',
            'status' => PaymentStatus::PAID,
            'initiated_at' => now(),
            'verified_at' => now(),
        ]);
        $refund = Refund::create([
            'refund_number' => 'REF-'.strtoupper(Str::random(8)),
            'payment_id' => $payment->id,
            'order_id' => $order->id,
            'vendor_order_id' => $vendorOrder->id,
            'amount' => 1800,
            'status' => RefundStatus::REFUNDED,
            'completed_at' => now(),
        ]);

        app(WalletService::class)->debitRefund($refund);

        $wallet = app(WalletService::class)->walletForVendor($this->vendor);
        $this->assertSame('0.00', $wallet->fresh()->balance);
        $this->assertDatabaseCount('wallet_transactions', 0);
    }
}
