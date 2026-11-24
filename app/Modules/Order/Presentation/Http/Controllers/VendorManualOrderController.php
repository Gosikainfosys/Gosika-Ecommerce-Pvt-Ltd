<?php

namespace App\Modules\Order\Presentation\Http\Controllers;

use App\Modules\Order\Infrastructure\Models\Order;
use App\Modules\Order\Infrastructure\Models\OrderItem;
use App\Modules\Order\Infrastructure\Models\OrderStatusHistory;
use App\Modules\Order\Infrastructure\Models\VendorOrder;
use App\Modules\Order\Presentation\Resources\OrderResource;
use App\Modules\Shared\Domain\Enums\OrderPaymentStatus;
use App\Modules\Shared\Domain\Enums\OrderStatus;
use App\Modules\Shared\Infrastructure\Services\ReferenceNumber;
use App\Modules\Shared\Presentation\Http\Response;
use App\Modules\Vendor\Infrastructure\Models\Vendor;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class VendorManualOrderController extends Controller
{
    public function __construct()
    {
        $this->middleware(['auth:sanctum', 'ensure:vendor']);
    }

    public function store(Request $request): JsonResponse
    {
        $vendor = $request->user()->vendor;

        abort_unless($vendor, 403, 'Vendor account required.');

        $data = $request->validate([
            'customer_name'       => ['required', 'string', 'max:180'],
            'customer_phone'      => ['required', 'string', 'max:20'],
            'customer_email'      => ['nullable', 'email', 'max:255'],
            'payment_method'      => ['required', Rule::in(['cod', 'khalti', 'esewa'])],
            'payment_status'      => ['required', Rule::enum(OrderPaymentStatus::class)],
            'customer_notes'      => ['nullable', 'string', 'max:1000'],
            'shipping_address'    => ['required', 'array'],
            'shipping_address.full_name'      => ['required', 'string', 'max:180'],
            'shipping_address.phone'          => ['required', 'string', 'max:20'],
            'shipping_address.address_line_1' => ['required', 'string', 'max:255'],
            'shipping_address.address_line_2' => ['nullable', 'string', 'max:255'],
            'shipping_address.district'       => ['nullable', 'string', 'max:100'],
            'shipping_address.province'       => ['nullable', 'string', 'max:100'],
            'shipping_address.municipality'   => ['nullable', 'string', 'max:100'],
            'shipping_address.postal_code'    => ['nullable', 'string', 'max:20'],
            'shipping_address.landmark'       => ['nullable', 'string', 'max:255'],
            'items'               => ['required', 'array', 'min:1'],
            'items.*.product_id'  => ['required', 'string', 'exists:products,uuid'],
            'items.*.variant_id'  => ['nullable', 'string', 'exists:product_variants,uuid'],
            'items.*.quantity'    => ['required', 'integer', 'min:1'],
            'items.*.unit_price'  => ['required', 'numeric', 'min:0'],
            'delivery_charge'     => ['nullable', 'numeric', 'min:0'],
            'discount'            => ['nullable', 'numeric', 'min:0'],
            'tax'                 => ['nullable', 'numeric', 'min:0'],
        ]);

        // Ensure all products belong to this vendor
        foreach ($data['items'] as $item) {
            $product = \App\Modules\Catalog\Infrastructure\Models\Product::where('uuid', $item['product_id'])->firstOrFail();
            abort_unless(
                (int) $product->vendor_id === (int) $vendor->id,
                403,
                "Product {$item['product_id']} does not belong to your store."
            );
        }

        $order = DB::transaction(function () use ($data, $vendor, $request) {
            $subtotal = collect($data['items'])->sum(fn ($i) => $i['unit_price'] * $i['quantity']);
            $discount = (float) ($data['discount'] ?? 0);
            $deliveryCharge = (float) ($data['delivery_charge'] ?? 0);
            $tax = (float) ($data['tax'] ?? 0);
            $grandTotal = round($subtotal - $discount + $deliveryCharge + $tax, 2);

            // Find or create a guest user record for the customer
            $customer = \App\Modules\Identity\Infrastructure\Models\User::where('phone', $data['customer_phone'])
                ->orWhere('email', $data['customer_email'] ?? 'noemail@example.com')
                ->first();

            if (! $customer && $data['customer_email']) {
                $customer = \App\Modules\Identity\Infrastructure\Models\User::where('email', $data['customer_email'])->first();
            }

            // If no existing customer found, use the vendor's own user as placeholder
            // (walk-in / phone order — customer may not have an account)
            $userId = $customer?->id ?? $request->user()->id;

            $order = new Order();
            $order->order_number = ReferenceNumber::unique('ORD');
            $order->user_id = $userId;
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

            $meta = ['manual_order' => true, 'vendor_created' => true, 'created_by_vendor' => $vendor->uuid];
            if ($data['payment_method'] === 'cod') {
                $meta['delivery_otp'] = sprintf('%06d', random_int(100000, 999999));
            }
            $order->meta = $meta;
            $order->save();

            $commissionRate = (float) \App\Modules\Platform\Infrastructure\Models\Setting::get('commission.default_rate', 10);
            $commissionAmount = round($subtotal * $commissionRate / 100, 2);
            $store = $vendor->stores()->first();

            $vendorOrder = new VendorOrder();
            $vendorOrder->vendor_order_number = ReferenceNumber::unique('VO');
            $vendorOrder->order_id = $order->id;
            $vendorOrder->vendor_id = $vendor->id;
            $vendorOrder->store_id = $store?->id;
            $vendorOrder->status = OrderStatus::CONFIRMED;
            $vendorOrder->delivery_status = 'pending';
            $vendorOrder->items_subtotal = $subtotal;
            $vendorOrder->discount = $discount;
            $vendorOrder->delivery_charge = $deliveryCharge;
            $vendorOrder->tax = $tax;
            $vendorOrder->grand_total = $grandTotal;
            $vendorOrder->commission_rate = $commissionRate;
            $vendorOrder->commission_amount = $commissionAmount;
            $vendorOrder->vendor_payable = round($grandTotal - $commissionAmount, 2);
            if (! empty($meta['delivery_otp'])) {
                $vendorOrder->meta = ['delivery_otp' => $meta['delivery_otp']];
            }
            $vendorOrder->save();

            foreach ($data['items'] as $item) {
                $product = \App\Modules\Catalog\Infrastructure\Models\Product::where('uuid', $item['product_id'])->firstOrFail();
                $variant = isset($item['variant_id'])
                    ? \App\Modules\Catalog\Infrastructure\Models\ProductVariant::where('uuid', $item['variant_id'])->first()
                    : null;

                $orderItem = new OrderItem();
                $orderItem->order_id = $order->id;
                $orderItem->vendor_order_id = $vendorOrder->id;
                $orderItem->vendor_id = $vendor->id;
                $orderItem->product_id = $product->id;
                $orderItem->variant_id = $variant?->id;
                $orderItem->product_name = $product->name;
                $orderItem->sku = $variant?->sku ?? $product->sku;
                $orderItem->variant_name = $variant?->name;
                $orderItem->image = $product->primaryImage?->file_path;
                $orderItem->quantity = $item['quantity'];
                $orderItem->unit_price = $item['unit_price'];
                $orderItem->unit_discount = 0;
                $orderItem->line_total = $item['unit_price'] * $item['quantity'];
                $orderItem->delivery_status = 'pending';
                $orderItem->save();
            }

            OrderStatusHistory::create([
                'trackable_type' => Order::class,
                'trackable_id'   => $order->id,
                'from_status'    => null,
                'to_status'      => OrderStatus::CONFIRMED->value,
                'reason'         => 'Manual order created by vendor: '.($store?->name ?? $vendor->company_name),
                'actor_user_id'  => $request->user()->id,
            ]);

            return $order->fresh(['items.product.primaryImage', 'vendorOrders']);
        });

        return Response::created(new OrderResource($order), 'Manual order created.');
    }
}
