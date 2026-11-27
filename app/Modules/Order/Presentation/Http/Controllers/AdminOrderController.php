<?php

namespace App\Modules\Order\Presentation\Http\Controllers;

use App\Modules\Administration\Application\Services\AuditLogService;
use App\Modules\Identity\Domain\Permissions;
use App\Modules\Identity\Domain\Roles;
use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Order\Application\Services\OrderService;
use App\Modules\Order\Application\Services\ReturnService;
use App\Modules\Order\Infrastructure\Models\Order;
use App\Modules\Order\Infrastructure\Models\ReturnRequest;
use App\Modules\Order\Presentation\Resources\AdminOrderResource;
use App\Modules\Payment\Application\Services\PaymentService;
use App\Modules\Payment\Application\Services\RefundService;
use App\Modules\Payment\Infrastructure\Models\Payment;
use App\Modules\Payment\Presentation\Resources\AdminRefundResource;
use App\Modules\Shared\Domain\Enums\OrderPaymentStatus;
use App\Modules\Shared\Domain\Enums\OrderStatus;
use App\Modules\Shared\Domain\Enums\PaymentMethod;
use App\Modules\Shared\Domain\Enums\ReturnStatus;
use App\Modules\Shared\Domain\Enums\UserStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Infrastructure\Services\ReferenceNumber;
use App\Modules\Shared\Presentation\Http\Filters\ListingDateRange;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class AdminOrderController extends Controller
{
    public function __construct(
        protected OrderService $orderService,
        protected RefundService $refundService,
        protected PaymentService $paymentService,
        protected ReturnService $returnService,
    ) {
        $this->middleware('auth:sanctum');
        $this->middleware('admin');
        $this->middleware('permission:'.Permissions::ORDERS_VIEW.'|'.Permissions::ORDERS_MANAGE);
    }

    public function index(Request $request): JsonResponse
    {
        $filters = $request->validate([
            'status' => ['nullable', Rule::enum(OrderStatus::class)],
            'payment_status' => ['nullable', Rule::enum(OrderPaymentStatus::class)],
            'payment_method' => ['nullable', Rule::enum(PaymentMethod::class)],
            'search' => ['nullable', 'string', 'max:120'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $query = Order::query()
            ->withSum(['refunds as refunded_amount' => fn ($query) => $query->where('status', 'refunded')], 'amount')
            ->with([
                'user',
                'items.product.primaryImage',
                'vendorOrders' => fn ($query) => $query
                    ->withSum(['refunds as refunded_amount' => fn ($refunds) => $refunds->where('status', 'refunded')], 'amount')
                    ->with('returnRequests'),
            ])
            ->when($filters['status'] ?? null, fn ($q, $s) => $q->where('status', $s))
            ->when($filters['payment_status'] ?? null, fn ($q, $s) => $q->where('payment_status', $s))
            ->when($filters['payment_method'] ?? null, fn ($q, $s) => $q->where('payment_method', $s))
            ->when($filters['search'] ?? null, function ($q, $search) {
                $q->where(function ($inner) use ($search) {
                    $inner->where('order_number', 'like', "%{$search}%")
                        ->orWhereHas('user', fn ($user) => $user
                            ->where('first_name', 'like', "%{$search}%")
                            ->orWhere('last_name', 'like', "%{$search}%")
                            ->orWhere('email', 'like', "%{$search}%")
                            ->orWhere('phone', 'like', "%{$search}%"));
                });
            })
            ->orderByDesc('placed_at')
            ->orderByDesc('id');

        ListingDateRange::apply($query, $request, 'placed_at');

        $orders = $query->paginate((int) ($filters['per_page'] ?? 15))->withQueryString();

        return Response::success(
            AdminOrderResource::collection($orders),
            'Orders retrieved.',
            ['pagination' => [
                'total' => $orders->total(),
                'per_page' => $orders->perPage(),
                'current_page' => $orders->currentPage(),
                'last_page' => $orders->lastPage(),
            ]]
        );
    }

    public function show(string $orderId): JsonResponse
    {
        $order = Order::query()
            ->withSum(['refunds as refunded_amount' => fn ($query) => $query->where('status', 'refunded')], 'amount')
            ->with([
                'user',
                'items',
                'vendorOrders' => fn ($query) => $query
                    ->withSum(['refunds as refunded_amount' => fn ($refunds) => $refunds->where('status', 'refunded')], 'amount')
                    ->with(['items.product.primaryImage', 'store', 'assignments.deliveryPartner', 'returnRequests']),
                'payments',
                'shippingAddress',
                'statusHistory',
            ])
            ->where(function ($q) use ($orderId) {
                $q->where('uuid', $orderId)
                    ->orWhere('order_number', $orderId);
                if (ctype_digit($orderId)) {
                    $q->orWhere('id', (int) $orderId);
                }
            })
            ->firstOrFail();

        return Response::success(new AdminOrderResource($order), 'Order retrieved.');
    }

    public function createReturnRequest(Request $request, string $orderId): JsonResponse
    {
        abort_unless($request->user()->hasPermissionTo(Permissions::ORDERS_MANAGE), 403, 'Insufficient permissions.');

        $validated = $request->validate([
            'order_item_id' => ['required', 'string', 'max:100'],
            'request_type' => ['required', Rule::in(['return_refund', 'exchange'])],
            'reason_type' => ['required', Rule::in([
                'damaged',
                'wrong_item',
                'not_as_described',
                'quality_issue',
                'size_fit',
                'changed_mind',
                'other',
            ])],
            'reason' => ['required', 'string', 'max:2000'],
            'quantity' => ['required', 'integer', 'min:1'],
        ]);

        $order = Order::query()
            ->where(function ($query) use ($orderId) {
                $query->where('uuid', $orderId)->orWhere('order_number', $orderId);
                if (ctype_digit($orderId)) {
                    $query->orWhere('id', (int) $orderId);
                }
            })
            ->firstOrFail();

        try {
            $return = $this->returnService->createAdminRequest($request->user(), [
                ...$validated,
                'order_id' => $order->uuid,
            ]);
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }

        return Response::created([
            'id' => $return->uuid,
            'uuid' => $return->uuid,
            'return_number' => $return->return_number,
            'request_type' => $return->request_type->value,
            'status' => $return->status->value,
        ], 'Return or exchange request created and approved.');
    }

    public function returns(Request $request): JsonResponse
    {
        $query = ReturnRequest::query()
            ->with([
                'user',
                'order.items.product.primaryImage',
                'order.payments',
                'order.shippingAddress.municipality',
                'order.shippingAddress.district',
                'order.shippingAddress.province',
                'order.vendorOrders.store',
                'order.vendorOrders.assignments.deliveryPartner.user',
                'vendorOrder.store',
                'vendorOrder.assignments.deliveryPartner.user',
                'assignedDeliveryPartner.user',
                'deliveryPartnerAssignedBy',
                'orderItem.product.primaryImage',
                'store',
                'refunds',
            ])
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->status))
            ->when($request->filled('search'), function ($q) use ($request) {
                $term = '%'.$request->string('search')->trim().'%';
                $q->where(function ($inner) use ($term) {
                    $inner->where('return_number', 'like', $term)
                        ->orWhere('reason', 'like', $term)
                        ->orWhereHas('order', fn ($order) => $order->where('order_number', 'like', $term))
                        ->orWhereHas('user', fn ($user) => $user
                            ->where('first_name', 'like', $term)
                            ->orWhere('last_name', 'like', $term)
                            ->orWhere('email', 'like', $term))
                        ->orWhereHas('store', fn ($store) => $store->where('name', 'like', $term));
                });
            })
            ->orderByDesc('created_at');

        if (Schema::hasTable('return_request_media')) {
            $query->with('media');
        }

        ListingDateRange::apply($query, $request, 'created_at');

        $returns = $query->paginate(min(max($request->integer('per_page', 20), 1), 100))->withQueryString();
        $returnData = $returns->getCollection()->map(function (ReturnRequest $return): array {
            $data = $return->toArray();
            $data['media'] = $return->relationLoaded('media')
                ? $return->media->map(fn ($media) => [
                    'id' => $media->uuid,
                    'type' => $media->type,
                    'url' => $media->url,
                    'mime_type' => $media->mime_type,
                    'original_name' => $media->original_name,
                    'size' => $media->size,
                ])->values()->all()
                : [];

            return $data;
        })->all();

        return Response::success(
            $returnData,
            'Return requests retrieved.',
            ['pagination' => [
                'total' => $returns->total(),
                'per_page' => $returns->perPage(),
                'current_page' => $returns->currentPage(),
                'last_page' => $returns->lastPage(),
            ]]
        );
    }

    public function showReturn(string $returnId): JsonResponse
    {
        $return = ReturnRequest::query()
            ->with([
                'user',
                'order.items.product.primaryImage',
                'order.payments',
                'order.shippingAddress.municipality',
                'order.shippingAddress.district',
                'order.shippingAddress.province',
                'order.vendorOrders.store',
                'order.vendorOrders.assignments.deliveryPartner.user',
                'vendorOrder.store',
                'vendorOrder.assignments.deliveryPartner.user',
                'assignedDeliveryPartner.user',
                'deliveryPartnerAssignedBy',
                'orderItem.product.primaryImage',
                'store',
                'refunds.payment',
                'refunds.order',
                'refunds.orderItem',
                'media',
            ])
            ->where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        $data = $return->toArray();
        $payment = $this->paidPaymentForReturn($return);
        $paidAmount = $payment
            ? (float) $payment->amount
            : ($return->order?->payment_method === PaymentMethod::COD->value
                ? (float) $return->order->grand_total
                : 0.0);
        $data['paid_amount'] = number_format($paidAmount, 2, '.', '');
        $data['full_refund_amount'] = number_format(
            $payment
                ? $this->refundService->remainingRefundableAmount($payment)
                : $paidAmount,
            2,
            '.',
            ''
        );
        $originalAssignment = collect($return->vendorOrder?->assignments ?? [])
            ->first(fn ($assignment) => $assignment->delivered_at);
        $data['original_delivery_partner_id'] = $originalAssignment?->delivery_partner_id;
        $data['delivery_partner_id'] = $return->delivery_partner_id;
        $data['assigned_delivery_partner'] = $return->assignedDeliveryPartner ? [
            'id' => $return->assignedDeliveryPartner->uuid,
            'name' => $return->assignedDeliveryPartner->name,
            'phone' => $return->assignedDeliveryPartner->phone,
        ] : null;
        $data['refunds'] = $return->refunds
            ->map(fn ($refund) => (new AdminRefundResource($refund))->resolve())
            ->all();
        $data['media'] = $return->relationLoaded('media')
            ? $return->media->map(fn ($media) => [
                'id'            => $media->uuid,
                'type'          => $media->type,
                'url'           => $media->url,
                'mime_type'     => $media->mime_type,
                'original_name' => $media->original_name,
                'size'          => $media->size,
            ])->values()->all()
            : [];

        return Response::success($data, 'Return request retrieved.');
    }

    public function assignReturnDeliveryPartner(Request $request, string $returnId): JsonResponse
    {
        $validated = $request->validate([
            'delivery_partner_id' => ['nullable', 'string'],
        ]);

        $return = ReturnRequest::query()
            ->where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        $return = $this->returnService->assignDeliveryPartner(
            $return,
            $request->user(),
            $validated['delivery_partner_id'] ?? null
        );

        $data = $return->toArray();
        $data['assigned_delivery_partner'] = $return->assignedDeliveryPartner ? [
            'id' => $return->assignedDeliveryPartner->uuid,
            'name' => $return->assignedDeliveryPartner->name,
            'phone' => $return->assignedDeliveryPartner->phone,
        ] : null;

        return Response::success($data, 'Return delivery partner assigned.');
    }

    public function approveReturn(Request $request, string $returnId): JsonResponse
    {
        $validated = $request->validate([
            'notes' => ['required', 'string', 'max:1000'],
        ]);

        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();
        $return->status = ReturnStatus::APPROVED;
        $return->reviewed_by = $request->user()->id;
        $return->reviewed_at = now();
        $return->review_notes = trim($validated['notes']);
        $return->save();

        return Response::success($return, 'Return request approved.');
    }

    public function rejectReturn(Request $request, string $returnId): JsonResponse
    {
        $validated = $request->validate([
            'notes' => ['required', 'string', 'max:1000'],
        ]);

        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();
        $return->status = ReturnStatus::REJECTED;
        $return->reviewed_by = $request->user()->id;
        $return->reviewed_at = now();
        $return->review_notes = trim($validated['notes']);
        $return->save();

        return Response::success($return, 'Return request rejected.');
    }

    public function processReturnRefund(Request $request, string $returnId): JsonResponse
    {
        $request->validate([
            'method' => ['required', Rule::in(['esewa', 'khalti', 'fonepay', 'cod'])],
            'amount' => ['nullable', 'numeric', 'min:0.01'],
            'refund_type' => ['nullable', Rule::in(['full', 'partial'])],
            'include_tax' => ['sometimes', 'boolean'],
            'include_delivery' => ['sometimes', 'boolean'],
            'notes' => ['nullable', 'string', 'max:1000'],
        ]);

        $return = ReturnRequest::query()
            ->with(['order.payments', 'orderItem', 'vendorOrder'])
            ->where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        $refundable = [
            ReturnStatus::APPROVED->value,
            ReturnStatus::COLLECTED->value,
            ReturnStatus::INSPECTED->value,
            ReturnStatus::REFUND_PENDING->value,
        ];

        if (! in_array($return->status->value, $refundable, true)) {
            return Response::error(
                'This return cannot be refunded in its current state.',
                ['status' => $return->status->value],
                422
            );
        }

        $payment = $this->paidPaymentForReturn($return);

        if (! $payment) {
            if ($return->order->payments->isNotEmpty()
                || $return->order->payment_method !== PaymentMethod::COD->value) {
                return Response::error('No paid payment is available to refund for this order.', ['payment' => 'unavailable'], 422);
            }

            $method = $request->input('method');
            $payment = Payment::query()->create([
                'payment_number' => ReferenceNumber::unique('PAY'),
                'order_id' => $return->order_id,
                'vendor_order_id' => $return->vendor_order_id,
                'user_id' => $return->user_id,
                'amount' => (float) $return->order->grand_total,
                'currency' => $return->order->currency ?? 'NPR',
                'method' => $method,
                'provider' => $method === 'cod' ? 'manual' : $method,
                'status' => 'paid',
                'initiated_at' => now(),
                'verified_at' => now(),
            ]);
        }

        $refundType = $request->input('refund_type');
        $refundComponents = $this->returnRefundComponents(
            $return,
            $request->boolean('include_tax'),
            $request->boolean('include_delivery')
        );
        $amount = $refundType === 'full'
            ? $this->refundService->remainingRefundableAmount($payment)
            : round((float) ($request->input('amount') ?? $return->refund_amount), 2);
        if ($amount < 0.01) {
            return Response::error('No paid amount remains available to refund.', ['amount' => 'unavailable'], 422);
        }

        $gateway = null;
        if ($payment->method === 'esewa') {
            $check = $this->paymentService->esewaRefundCheck($payment);

            if (($check['available'] ?? false) && in_array($check['status'], ['FULL_REFUND', 'PARTIAL_REFUND'], true)) {
                return Response::error(
                    'This payment has already been refunded at eSewa (status: '.$check['status'].').',
                    ['gateway_status' => $check['status']],
                    422
                );
            }

            $gateway = ['provider_response' => ['esewa_check' => $check['raw'] ?? $check]];

            if (($check['available'] ?? false) && $check['ref_id'] !== '') {
                $gateway['provider_refund_id'] = $check['ref_id'];
            }
        }

        try {
            $refund = $this->refundService->create(
                $payment,
                $request->user(),
                $amount,
                $request->input('notes') ?? "Refund for return {$return->return_number}",
                $gateway,
                $return,
                $refundType,
                $refundComponents
            );
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }

        $message = ($payment->method === 'esewa' && ! ($gateway['provider_response']['esewa_check']['available'] ?? true))
            ? 'Refund created. eSewa verification was unavailable — finalize the payout from the eSewa merchant dashboard.'
            : 'Refund created for return request.';

        return Response::success(
            new AdminRefundResource($refund->load('payment', 'order', 'orderItem')),
            $message
        );
    }

    private function paidPaymentForReturn(ReturnRequest $return): ?Payment
    {
        $payments = $return->order?->payments ?? collect();

        return $payments->first(fn (Payment $payment) =>
            (int) $payment->vendor_order_id === (int) $return->vendor_order_id
            && $payment->isPaid()
        ) ?? $payments->first(fn (Payment $payment) => $payment->isPaid());
    }

    private function returnRefundComponents(ReturnRequest $return, bool $includeTax, bool $includeDelivery): array
    {
        $item = $return->orderItem;
        $quantity = max(1, (int) $item?->quantity);
        $returnedQuantity = min($quantity, max(1, (int) $return->quantity));
        $itemAmount = round(((float) ($item?->line_total ?? 0) / $quantity) * $returnedQuantity, 2);
        $subtotal = (float) ($return->order?->subtotal ?? 0);
        $share = $subtotal > 0 ? min(1, $itemAmount / $subtotal) : 0;

        return [
            'item_amount' => $itemAmount,
            'tax_amount' => $includeTax ? round((float) ($return->order?->tax ?? 0) * $share, 2) : 0,
            'delivery_amount' => $includeDelivery ? round((float) ($return->order?->delivery_charge ?? 0) * $share, 2) : 0,
        ];
    }

    // ─── Admin: Dispatch exchange ──────────────────────────────────────────

    public function dispatchExchange(Request $request, string $returnId): JsonResponse
    {
        $request->validate([
            'exchange_order_id' => ['nullable', 'integer', 'exists:orders,id'],
            'notes'             => ['nullable', 'string', 'max:1000'],
        ]);

        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        try {
            $return = $this->returnService->dispatchExchange(
                $return,
                $request->user(),
                $request->input('exchange_order_id'),
                $request->input('notes', '')
            );

            return Response::success($return->load(['user', 'order', 'orderItem', 'statusHistory']), 'Exchange dispatched.');
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }

    // ─── Admin: Close / complete a return request ─────────────────────────

    public function closeReturn(Request $request, string $returnId): JsonResponse
    {
        $request->validate(['notes' => ['nullable', 'string', 'max:500']]);

        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        try {
            $return = $this->returnService->close($return, $request->user(), $request->input('notes', ''));

            return Response::success($return->load(['user', 'order', 'orderItem', 'statusHistory']), 'Request closed.');
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }

    // ─── Admin: Update return status (generic) ────────────────────────────

    public function updateReturnStatus(Request $request, string $returnId): JsonResponse
    {
        $request->validate([
            'status' => ['required', Rule::enum(ReturnStatus::class)],
            'notes'  => ['nullable', 'string', 'max:1000'],
        ]);

        $return = ReturnRequest::where('uuid', $returnId)
            ->when(ctype_digit($returnId), fn ($q) => $q->orWhere('id', (int) $returnId))
            ->firstOrFail();

        try {
            $return = $this->returnService->updateStatus(
                $return,
                $request->user(),
                ReturnStatus::from($request->input('status')),
                $request->input('notes', '')
            );

            return Response::success(
                $return->load(['user', 'order', 'vendorOrder', 'orderItem', 'store', 'statusHistory']),
                'Return request status updated.'
            );
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }

    // ─── Admin: Delete (soft) an order ───────────────────────────────────────

    public function destroy(Request $request, string $orderId): JsonResponse
    {
        abort_unless($request->user()->hasPermissionTo(Permissions::ORDERS_MANAGE), 403, 'Insufficient permissions.');

        $order = Order::where('uuid', $orderId)->firstOrFail();

        if (in_array($order->status->value, [
            OrderStatus::OUT_FOR_DELIVERY->value,
            OrderStatus::DELIVERED->value,
            OrderStatus::COMPLETED->value,
        ], true)) {
            return Response::error(
                'Orders that are out for delivery, delivered, or completed cannot be deleted.',
                [],
                422
            );
        }

        $order->forceFill(['deleted_by' => $request->user()->id])->save();
        $order->delete(); // soft delete

        app(AuditLogService::class)->record(
            $request->user(),
            'order.deleted',
            'order',
            $order->uuid,
            ['status' => $order->status->value],
            ['deleted' => true]
        );

        return Response::noContent('Order deleted.');
    }

    // ─── Admin: Create manual order ───────────────────────────────────────────

    private function resolveManualOrderCustomer(array $data, Request $request): User
    {
        if (! empty($data['customer_id'])) {
            return User::where('uuid', $data['customer_id'])->firstOrFail();
        }

        $customerInput = $data['customer'] ?? [];
        $email = ! empty($customerInput['email']) ? $customerInput['email'] : null;
        $phone = ! empty($customerInput['phone']) ? $customerInput['phone'] : null;

        if ($email && $existing = User::where('email', $email)->first()) {
            return $existing;
        }

        if ($phone && $existing = User::where('phone', $phone)->first()) {
            return $existing;
        }

        $fullName = trim($customerInput['full_name'] ?? '');
        $nameParts = preg_split('/\s+/', $fullName, 2) ?: [];
        $firstName = $nameParts[0] ?? 'Walk-in';
        $lastName = $nameParts[1] ?? '';

        $generatedEmail = $this->manualCustomerEmail($phone);

        $customer = User::create([
            'uuid' => (string) Str::uuid(),
            'first_name' => $firstName,
            'last_name' => $lastName,
            'email' => $generatedEmail,
            'phone' => $phone,
            'password' => Str::random(32),
            'status' => UserStatus::ACTIVE,
            'meta' => [
                'manual_order_customer' => true,
                'created_by' => $request->user()->uuid,
            ],
        ]);
        $customer->assignRole(Roles::CUSTOMER);

        return $customer;
    }

    private function manualCustomerEmail(?string $phone): string
    {
        $digits = $phone ? preg_replace('/\D/', '', $phone) : '';
        $base = is_string($digits) && $digits !== ''
            ? 'manual-'.$digits
            : 'manual-customer-'.Str::lower(Str::random(10));

        $email = $base.'@customers.gosika.local';
        while (User::where('email', $email)->exists()) {
            $email = $base.'-'.Str::lower(Str::random(4)).'@customers.gosika.local';
        }

        return $email;
    }

    public function manualCreate(Request $request): JsonResponse
    {
        abort_unless($request->user()->hasPermissionTo(Permissions::ORDERS_MANAGE), 403, 'Insufficient permissions.');

        $data = $request->validate([
            'customer_id'         => ['nullable', 'string', 'exists:users,uuid'],
            'customer'            => ['required_without:customer_id', 'array'],
            'customer.full_name'  => ['required_without:customer_id', 'string', 'max:180'],
            'customer.phone'      => ['nullable', 'string', 'max:20'],
            'customer.email'      => ['nullable', 'email', 'max:255'],
            'payment_method'      => ['required', Rule::in(['cod', 'khalti', 'esewa'])],
            'payment_status'      => ['required', Rule::enum(OrderPaymentStatus::class)],
            'customer_notes'      => ['nullable', 'string', 'max:1000'],
            'shipping_address'    => ['required', 'array'],
            'shipping_address.full_name'    => ['required', 'string', 'max:180'],
            'shipping_address.phone'        => ['required', 'string', 'max:20'],
            'shipping_address.address_line_1' => ['required', 'string', 'max:255'],
            'shipping_address.address_line_2' => ['nullable', 'string', 'max:255'],
            'shipping_address.district'     => ['nullable', 'string', 'max:100'],
            'shipping_address.province'     => ['nullable', 'string', 'max:100'],
            'shipping_address.municipality' => ['nullable', 'string', 'max:100'],
            'shipping_address.postal_code'  => ['nullable', 'string', 'max:20'],
            'shipping_address.landmark'     => ['nullable', 'string', 'max:255'],
            'shipping_address.latitude'     => ['nullable', 'numeric', 'between:-90,90'],
            'shipping_address.longitude'    => ['nullable', 'numeric', 'between:-180,180'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['required', 'string', 'exists:products,uuid'],
            'items.*.variant_id'  => ['nullable', 'string', 'exists:product_variants,uuid'],
            'items.*.quantity'    => ['required', 'integer', 'min:1'],
            'items.*.unit_price'  => ['required', 'numeric', 'min:0'],
            'delivery_charge'     => ['nullable', 'numeric', 'min:0'],
            'discount'            => ['nullable', 'numeric', 'min:0'],
            'tax'                 => ['nullable', 'numeric', 'min:0'],
        ]);

        $order = \Illuminate\Support\Facades\DB::transaction(function () use ($data, $request) {
            $customer = $this->resolveManualOrderCustomer($data, $request);

            $subtotal = collect($data['items'])->sum(fn ($i) => $i['unit_price'] * $i['quantity']);
            $discount = (float) ($data['discount'] ?? 0);
            $deliveryCharge = (float) ($data['delivery_charge'] ?? 0);
            $tax = (float) ($data['tax'] ?? 0);
            $grandTotal = round($subtotal - $discount + $deliveryCharge + $tax, 2);

            $order = new Order();
            $order->order_number = \App\Modules\Shared\Infrastructure\Services\ReferenceNumber::unique('ORD');
            $order->user_id = $customer->id;
            $order->payment_method = $data['payment_method'];
            $order->payment_status = OrderPaymentStatus::from($data['payment_status']);
            $order->status = OrderStatus::CONFIRMED;
            $order->subtotal = $subtotal;
            $order->discount = $discount;
            $order->delivery_charge = $deliveryCharge;
            $order->tax = $tax;
            $order->grand_total = $grandTotal;
            $order->currency = 'NPR';
            $order->customer_notes = $data['customer_notes'] ?? null;
            $order->shipping_address_snapshot = json_encode($data['shipping_address'], JSON_UNESCAPED_UNICODE);
            $order->placed_at = now();
            $order->confirmed_at = now();

            $meta = [];
            if ($data['payment_method'] === 'cod') {
                $meta['delivery_otp'] = sprintf('%06d', random_int(100000, 999999));
            }
            $meta['manual_order'] = true;
            $meta['created_by'] = $request->user()->uuid;
            $order->meta = $meta;
            $order->save();

            // Group items by vendor
            $vendorGroups = [];
            foreach ($data['items'] as $item) {
                $product = \App\Modules\Catalog\Infrastructure\Models\Product::where('uuid', $item['product_id'])->firstOrFail();
                $variant = isset($item['variant_id'])
                    ? \App\Modules\Catalog\Infrastructure\Models\ProductVariant::where('uuid', $item['variant_id'])->first()
                    : null;

                $vendorId = $product->vendor_id;
                $vendorGroups[$vendorId][] = compact('product', 'variant', 'item');
            }

            foreach ($vendorGroups as $vendorId => $group) {
                $vendor = \App\Modules\Vendor\Infrastructure\Models\Vendor::findOrFail($vendorId);
                $groupSubtotal = collect($group)->sum(fn ($g) => $g['item']['unit_price'] * $g['item']['quantity']);
                $commissionRate = (float) \App\Modules\Platform\Infrastructure\Models\Setting::get('commission.default_rate', 10);
                $commissionAmount = round($groupSubtotal * $commissionRate / 100, 2);

                $vendorOrder = new \App\Modules\Order\Infrastructure\Models\VendorOrder();
                $vendorOrder->vendor_order_number = \App\Modules\Shared\Infrastructure\Services\ReferenceNumber::unique('VO');
                $vendorOrder->order_id = $order->id;
                $vendorOrder->vendor_id = $vendor->id;
                $vendorOrder->store_id = $vendor->stores()->first()?->id;
                $vendorOrder->status = OrderStatus::CONFIRMED;
                $vendorOrder->delivery_status = 'pending';
                $vendorOrder->items_subtotal = $groupSubtotal;
                $vendorOrder->discount = 0;
                $vendorOrder->delivery_charge = 0;
                $vendorOrder->tax = 0;
                $vendorOrder->grand_total = $groupSubtotal;
                $vendorOrder->commission_rate = $commissionRate;
                $vendorOrder->commission_amount = $commissionAmount;
                $vendorOrder->vendor_payable = round($groupSubtotal - $commissionAmount, 2);
                if (! empty($meta['delivery_otp'])) {
                    $vendorOrder->meta = ['delivery_otp' => $meta['delivery_otp']];
                }
                $vendorOrder->save();

                foreach ($group as $g) {
                    $orderItem = new \App\Modules\Order\Infrastructure\Models\OrderItem();
                    $orderItem->order_id = $order->id;
                    $orderItem->vendor_order_id = $vendorOrder->id;
                    $orderItem->vendor_id = $vendor->id;
                    $orderItem->product_id = $g['product']->id;
                    $orderItem->variant_id = $g['variant']?->id;
                    $orderItem->product_name = $g['product']->name;
                    $orderItem->sku = $g['variant']?->sku ?? $g['product']->sku;
                    $orderItem->variant_name = $g['variant']?->name;
                    $orderItem->image = $g['product']->primaryImage?->file_path;
                    $orderItem->quantity = $g['item']['quantity'];
                    $orderItem->unit_price = $g['item']['unit_price'];
                    $orderItem->unit_discount = 0;
                    $orderItem->line_total = $g['item']['unit_price'] * $g['item']['quantity'];
                    $orderItem->delivery_status = 'pending';
                    $orderItem->save();
                }
            }

            \App\Modules\Order\Infrastructure\Models\OrderStatusHistory::create([
                'trackable_type' => Order::class,
                'trackable_id'   => $order->id,
                'from_status'    => null,
                'to_status'      => OrderStatus::CONFIRMED->value,
                'reason'         => 'Manual order created by admin: '.$request->user()->full_name,
                'actor_user_id'  => $request->user()->id,
            ]);

            app(\App\Modules\Marketing\Application\Services\NotificationDispatcher::class)->orderPlaced($order);

            return $order->fresh(['user', 'items.product.primaryImage', 'vendorOrders']);
        });

        $customer = $order->user;

        app(AuditLogService::class)->record(
            $request->user(),
            'order.manual_created',
            'order',
            $order->uuid,
            [],
            ['order_number' => $order->order_number, 'customer' => $customer->email]
        );

        return Response::created(new AdminOrderResource($order), 'Manual order created.');
    }

    public function cancel(Request $request, string $orderId): JsonResponse
    {
        $order = Order::where('uuid', $orderId)->firstOrFail();

        $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        try {
            $oldStatus = $order->status->value;
            $order = $this->orderService->cancel($request->user(), $order, $request->input('reason'));
            app(AuditLogService::class)->record(
                $request->user(),
                'order.cancelled',
                'order',
                $order->uuid,
                ['status' => $oldStatus],
                ['status' => 'cancelled', 'reason' => $request->input('reason')]
            );

            return Response::success(new AdminOrderResource($order), 'Order cancelled.');
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }

    public function updateStatus(Request $request, string $orderId): JsonResponse
    {
        $validated = $request->validate([
            'status' => ['required', Rule::in([
                OrderStatus::PENDING->value,
                OrderStatus::CONFIRMED->value,
                OrderStatus::ACCEPTED->value,
                OrderStatus::REJECTED->value,
                OrderStatus::PROCESSING->value,
                OrderStatus::PREPARING->value,
                OrderStatus::READY_FOR_PICKUP->value,
                OrderStatus::PICKED_UP->value,
                OrderStatus::OUT_FOR_DELIVERY->value,
                OrderStatus::DELIVERED->value,
                OrderStatus::COMPLETED->value,
            ])],
            'reason' => ['nullable', 'required_if:status,rejected', 'string', 'max:500'],
        ]);

        $order = Order::query()
            ->where(function ($query) use ($orderId) {
                $query->where('uuid', $orderId)->orWhere('order_number', $orderId);
                if (ctype_digit($orderId)) {
                    $query->orWhere('id', (int) $orderId);
                }
            })
            ->firstOrFail();
        $oldStatus = $order->status->value;

        try {
            $order = $this->orderService->updateAdminStatus(
                $order,
                $request->user(),
                OrderStatus::from($validated['status']),
                $validated['reason'] ?? null,
            );
            app(AuditLogService::class)->record(
                $request->user(),
                'order.status_updated',
                'order',
                $order->getKey(),
                ['status' => $oldStatus],
                ['status' => $validated['status'], 'reason' => $validated['reason'] ?? null],
            );

            return Response::success(new AdminOrderResource($order->load('statusHistory')), 'Order status updated.');
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }
}
