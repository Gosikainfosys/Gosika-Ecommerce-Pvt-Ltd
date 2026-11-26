<?php

namespace App\Modules\Shipping\Presentation\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DeliveryAssignmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $safeMeta = (array) ($this->meta ?? []);
        unset($safeMeta['delivery_otp']);
        $originalCodAmount = round((float) $this->cod_amount, 2);
        $refundedAmount = round((float) ($this->refunded_amount ?? 0), 2);

        $order = $this->vendorOrder?->order;
        $shippingSnap = null;
        if ($order && $order->shipping_address_snapshot) {
            $shippingSnap = is_array($order->shipping_address_snapshot)
                ? $order->shipping_address_snapshot
                : json_decode((string) $order->shipping_address_snapshot, true);
        }
        $dropoffCoords = $this->coordinatePair(
            $shippingSnap['latitude'] ?? $order?->shippingAddress?->latitude,
            $shippingSnap['longitude'] ?? $order?->shippingAddress?->longitude,
        );

        $store = $this->vendorOrder?->store;
        $storeAddress = null;
        if ($store) {
            $storeAddresses = $store->addresses;
            $storeAddress = $storeAddresses->first(fn ($address) => $address->address_type === 'pickup') ?? $storeAddresses->first();
        }
        $pickupCoords = $this->coordinatePair($storeAddress?->latitude, $storeAddress?->longitude);
        $vendor = $this->vendorOrder?->vendor;
        if (! $pickupCoords && ! $storeAddress) {
            $pickupCoords = $this->coordinatePair($vendor?->kyc?->latitude, $vendor?->kyc?->longitude);
        }

        $pickupAddressFallback = $storeAddress
            ? implode(', ', array_filter([
                $store?->name,
                $storeAddress->address_line_1,
                $storeAddress->address_line_2,
                $storeAddress->landmark,
            ]))
            : implode(', ', array_filter([
                $store?->name,
                $vendor?->kyc?->address,
                $vendor?->kyc?->landmark,
                $vendor?->kyc?->municipality,
                $vendor?->kyc?->district,
                $vendor?->kyc?->province,
            ]));
        $pickupAddress = $pickupAddressFallback ?: $this->pickup_address;
        $dropoffAddress = $this->dropoff_address ?: implode(', ', array_filter([
            $shippingSnap['address_line_1'] ?? $order?->shippingAddress?->address_line_1,
            $shippingSnap['address_line_2'] ?? $order?->shippingAddress?->address_line_2,
            $shippingSnap['municipality'] ?? null,
            $shippingSnap['district'] ?? null,
            $shippingSnap['province'] ?? null,
        ]));

        $riderCoords = null;
        if ($this->deliveryPartner) {
            $riderCoords = $this->coordinatePair($this->deliveryPartner->latitude, $this->deliveryPartner->longitude);
        }

        return [
            'id' => $this->uuid,
            'vendor_order_id' => $this->vendorOrder?->uuid,
            'order_number' => $order?->order_number,
            'vendor_order_number' => $this->vendorOrder?->vendor_order_number,
            'delivery_partner_id' => $this->deliveryPartner?->uuid,
            'delivery_partner_name' => $this->deliveryPartner?->name,
            'delivery_partner' => new DeliveryPartnerResource($this->whenLoaded('deliveryPartner')),
            'status' => $this->status->value,
            'delivery_fee' => number_format((float) $this->delivery_fee, 2, '.', ''),
            'original_cod_amount' => number_format($originalCodAmount, 2, '.', ''),
            'refunded_amount' => number_format($refundedAmount, 2, '.', ''),
            'cod_amount' => number_format(max(0, $originalCodAmount - $refundedAmount), 2, '.', ''),
            'pickup_store_name' => $store?->name,
            'pickup_address' => $pickupAddress,
            'dropoff_address' => $dropoffAddress,
            'pickup_coordinates' => $pickupCoords,
            'dropoff_coordinates' => $dropoffCoords,
            'rider_coordinates' => $riderCoords,
            'recipient_name' => $this->recipient_name,
            'recipient_phone' => $this->recipient_phone,
            'assigned_at' => $this->assigned_at?->toISOString(),
            'accepted_at' => $this->accepted_at?->toISOString(),
            'picked_up_at' => $this->picked_up_at?->toISOString(),
            'out_for_delivery_at' => $this->out_for_delivery_at?->toISOString(),
            'delivered_at' => $this->delivered_at?->toISOString(),
            'failed_at' => $this->failed_at?->toISOString(),
            'failure_reason' => $this->failure_reason,
            'proof_photo' => $this->proof_photo,
            'assignment_method' => $this->meta['assignment_method'] ?? 'manual_admin',
            'assignment_method_label' => ($this->meta['assignment_method'] ?? '') === 'self_claim' ? 'Delivery-User Claim' : 'Super Admin Manual Assignment',
            'assigned_by' => $this->meta['assigned_by_name'] ?? null,
            'assigned_by_role' => $this->meta['assigned_by_role'] ?? null,
            'reassignment_reason' => $this->meta['reassignment_reason'] ?? null,
            'meta' => $safeMeta,
            'created_at' => $this->created_at?->toISOString(),
            'updated_at' => $this->updated_at?->toISOString(),
            'tracking' => DeliveryTrackingResource::collection($this->whenLoaded('tracking')),
            'vendor_order' => $this->whenLoaded('vendorOrder'),
        ];
    }

    private function coordinatePair($latitude, $longitude): ?array
    {
        if (! is_numeric($latitude) || ! is_numeric($longitude)) {
            return null;
        }

        $latitude = (float) $latitude;
        $longitude = (float) $longitude;
        if ($latitude < 25 || $latitude > 32 || $longitude < 79 || $longitude > 89.5) {
            return null;
        }

        return ['lat' => $latitude, 'lng' => $longitude];
    }
}
