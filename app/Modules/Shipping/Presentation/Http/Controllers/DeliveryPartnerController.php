<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Identity\Infrastructure\Models\User;
use App\Modules\Order\Infrastructure\Models\ReturnRequest;
use App\Modules\Order\Infrastructure\Models\VendorOrder;
use App\Modules\Payment\Application\Services\RefundService;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Shared\Domain\Enums\DeliveryStatus;
use App\Modules\Shared\Domain\Enums\RefundStatus;
use App\Modules\Shared\Domain\Enums\ReturnStatus;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Presentation\Http\Filters\ListingDateRange;
use App\Modules\Shared\Presentation\Http\Response;
use App\Modules\Shipping\Application\DataTransferObjects\ApplyDeliveryPartnerDTO;
use App\Modules\Shipping\Application\DataTransferObjects\UpdateDeliveryPartnerProfileDTO;
use App\Modules\Shipping\Application\Services\DeliveryService;
use App\Modules\Shipping\Infrastructure\Models\DeliveryAssignment;
use App\Modules\Shipping\Infrastructure\Models\DeliveryPartner;
use App\Modules\Shipping\Infrastructure\Models\DeliveryPartnerDocument;
use App\Modules\Shipping\Presentation\Http\Requests\ApplyDeliveryPartnerRequest;
use App\Modules\Shipping\Presentation\Http\Requests\DeliveryConfirmationRequest;
use App\Modules\Shipping\Presentation\Http\Requests\DeliveryFailureRequest;
use App\Modules\Shipping\Presentation\Http\Requests\UpdateDeliveryPartnerProfileRequest;
use App\Modules\Shipping\Presentation\Resources\AvailableJobResource;
use App\Modules\Shipping\Presentation\Resources\DeliveryAssignmentResource;
use App\Modules\Shipping\Presentation\Resources\DeliveryPartnerDocumentResource;
use App\Modules\Shipping\Presentation\Resources\DeliveryPartnerResource;
use App\Modules\Shipping\Presentation\Resources\DeliveryReturnResource;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DeliveryPartnerController extends Controller
{
    public function __construct(
        protected DeliveryService $service,
        protected RefundService $refundService,
    )
    {
        $this->middleware('auth:sanctum');
        $this->middleware('ensure:delivery')->except(['apply']);
    }

    public function apply(ApplyDeliveryPartnerRequest $request): JsonResponse
    {
        $partner = $this->service->apply(
            $request->user(),
            ApplyDeliveryPartnerDTO::fromArray($request->validated())
        );

        return Response::created(new DeliveryPartnerResource($partner), 'Delivery partner application submitted for approval.');
    }

    public function me(Request $request): JsonResponse
    {
        $partner = $this->partnerFor($request->user());

        return Response::success(new DeliveryPartnerResource($partner->load('documents')), 'Delivery partner profile retrieved.');
    }

    public function updateProfile(UpdateDeliveryPartnerProfileRequest $request): JsonResponse
    {
        $partner = $this->service->updateProfile(
            $request->user(),
            UpdateDeliveryPartnerProfileDTO::fromArray($request->validated())
        );

        return Response::success(new DeliveryPartnerResource($partner->load('documents')), 'Delivery partner profile updated.');
    }

    public function uploadDocument(Request $request): JsonResponse
    {
        $request->validate([
            'document_type' => ['required', 'string', 'max:40'],
            'file' => ['required', 'file', 'max:5120', 'mimes:jpg,jpeg,png,pdf'],
        ]);

        $partner = $this->partnerFor($request->user());
        $document = $this->service->addDocument(
            $partner,
            $request->input('document_type'),
            $request->file('file')
        );

        return Response::created(
            new DeliveryPartnerDocumentResource($document),
            'Document uploaded for review.'
        );
    }

    public function deleteDocument(Request $request, DeliveryPartnerDocument $document): JsonResponse
    {
        $partner = $this->partnerFor($request->user());
        $this->service->deleteDocument($partner, $document);

        return Response::success(null, 'Document removed.');
    }

    public function setOnline(Request $request): JsonResponse
    {
        $request->validate([
            'is_online' => ['required', 'boolean'],
        ]);

        $partner = $this->service->setOnline($request->user(), (bool) $request->boolean('is_online'));

        return Response::success(new DeliveryPartnerResource($partner), 'Availability updated.');
    }

    public function assignments(Request $request): JsonResponse
    {
        $partner = $this->partnerFor($request->user());
        $filters = $request->validate([
            'status' => ['nullable', Rule::enum(DeliveryStatus::class)],
            'statuses' => ['nullable', 'array'],
            'statuses.*' => [Rule::enum(DeliveryStatus::class)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);

        $assignments = $partner->assignments()
            ->with([
                'tracking',
                'vendorOrder.order.shippingAddress',
                'vendorOrder.store.addresses',
                'vendorOrder.vendor.kyc',
            ])
            ->when($filters['statuses'] ?? null, fn ($query, $statuses) => $query->whereIn('status', $statuses))
            ->when(
                ! ($filters['statuses'] ?? null) && ($filters['status'] ?? null),
                fn ($query) => $query->where('status', $filters['status'])
            )
            ->latest()
            ->paginate($request->integer('per_page', 15));

        return Response::success(
            DeliveryAssignmentResource::collection($assignments),
            'Assignments retrieved.',
            ['pagination' => [
                'total' => $assignments->total(),
                'per_page' => $assignments->perPage(),
                'current_page' => $assignments->currentPage(),
                'last_page' => $assignments->lastPage(),
            ]]
        );
    }

    public function returns(Request $request): JsonResponse
    {
        $partner = $this->partnerFor($request->user());
        $assignments = $partner->assignments()
            ->whereNotNull('delivered_at')
            ->orderByDesc('delivered_at')
            ->get(['id', 'vendor_order_id', 'pickup_address', 'dropoff_address', 'recipient_name', 'recipient_phone']);
        $assignmentByVendorOrder = $assignments
            ->groupBy('vendor_order_id')
            ->map(fn ($vendorAssignments) => $vendorAssignments->first());

        $returns = ReturnRequest::query()
            ->with(['order', 'orderItem', 'vendorOrder', 'assignedDeliveryPartner'])
            ->withCount('refunds')
            ->withSum([
                'refunds as cod_refund_due' => fn ($query) => $query
                    ->where('status', RefundStatus::APPROVED->value),
            ], 'amount')
            ->withSum([
                'refunds as cod_refund_completed' => fn ($query) => $query
                    ->where('status', RefundStatus::REFUNDED->value),
            ], 'amount')
            ->where(function ($query) use ($partner, $assignmentByVendorOrder) {
                $query->where('delivery_partner_id', $partner->id)
                    ->orWhereIn('vendor_order_id', $assignmentByVendorOrder->keys());
            })
            ->whereIn('status', [
                ReturnStatus::APPROVED->value,
                ReturnStatus::PICKUP_ARRANGED->value,
                ReturnStatus::COLLECTED->value,
                ReturnStatus::REFUND_PENDING->value,
                ReturnStatus::REFUNDED->value,
                ReturnStatus::COMPLETED->value,
            ])
            ->latest()
            ->paginate(min(max($request->integer('per_page', 100), 1), 100));

        $returns->getCollection()->each(function (ReturnRequest $return) use ($assignmentByVendorOrder) {
            $assignment = $assignmentByVendorOrder->get($return->vendor_order_id)
                ?: DeliveryAssignment::query()
                    ->where('vendor_order_id', $return->vendor_order_id)
                    ->whereNotNull('delivered_at')
                    ->latest('id')
                    ->first();
            $return->setRelation('pickup_assignment', $assignment);
        });

        return Response::success(
            DeliveryReturnResource::collection($returns),
            'Customer return pickups retrieved.',
            ['pagination' => [
                'total' => $returns->total(),
                'per_page' => $returns->perPage(),
                'current_page' => $returns->currentPage(),
                'last_page' => $returns->lastPage(),
            ]]
        );
    }

    public function collectReturn(Request $request, string $returnId): JsonResponse
    {
        $request->validate([
            'cash_refund_amount' => ['nullable', 'numeric', 'min:0.01'],
        ]);
        $partner = $this->partnerFor($request->user());

        try {
            $return = DB::transaction(function () use ($partner, $request, $returnId) {
                $return = ReturnRequest::query()
                    ->with(['order', 'orderItem', 'vendorOrder', 'refunds.payment'])
                    ->where('uuid', $returnId)
                    ->when(ctype_digit($returnId), fn ($query) => $query->orWhere('id', (int) $returnId))
                    ->lockForUpdate()
                    ->firstOrFail();

                $assignment = $partner->assignments()
                    ->where('vendor_order_id', $return->vendor_order_id)
                    ->whereNotNull('delivered_at')
                    ->orderByDesc('delivered_at')
                    ->first();
                $isAssignedPickup = (int) ($return->delivery_partner_id ?? 0) === (int) $partner->id;

                if (! $assignment && ! $isAssignedPickup) {
                    throw new DomainException('You are not assigned to this return pickup.', 403);
                }

                if (! $assignment) {
                    $assignment = DeliveryAssignment::query()
                        ->where('vendor_order_id', $return->vendor_order_id)
                        ->whereNotNull('delivered_at')
                        ->latest('id')
                        ->first();
                }

                $statusVal = $return->status instanceof ReturnStatus ? $return->status->value : (string) $return->status;
                $allowed = [
                    'approved',
                    'pickup_arranged',
                    'collected',
                    'refund_pending',
                    'refunded',
                    'completed',
                ];

                if (! in_array($statusVal, $allowed, true)) {
                    throw new DomainException('This customer return is not approved for pickup.', 422);
                }

                $isCod = $return->order?->payment_method === 'cod';
                $approvedRefunds = $return->refunds
                    ->filter(fn (Refund $refund) => $refund->status === RefundStatus::APPROVED)
                    ->values();
                $completedCashRefunds = (float) $return->refunds
                    ->filter(fn (Refund $refund) => $refund->status === RefundStatus::REFUNDED)
                    ->sum('amount');
                $cashRefundDue = max(0, round(
                    (float) $approvedRefunds->sum('amount')
                    + $completedCashRefunds
                    - (float) $return->cash_refund_amount,
                    2
                ));
                $hasCashRefundAmount = $request->filled('cash_refund_amount');
                $alreadyPickedUp = ! empty($return->pickup_collected_at);

                if ($alreadyPickedUp && ($cashRefundDue <= 0 || ! $isCod)) {
                    throw new DomainException('This return pickup has already been confirmed.', 422);
                }
                if (! $isCod && $hasCashRefundAmount) {
                    throw new DomainException('Cash refund handoff is only available for COD orders.', 422);
                }
                if ($hasCashRefundAmount && $cashRefundDue <= 0) {
                    throw new DomainException('There is no approved COD refund to hand to the customer.', 422);
                }
                if ($isCod && $cashRefundDue > 0) {
                    if (! $hasCashRefundAmount) {
                        throw new DomainException('Confirm the exact approved cash refund amount before completing this COD return.', 422);
                    }
                    if (round((float) $request->input('cash_refund_amount'), 2) !== $cashRefundDue) {
                        throw new DomainException(
                            'Cash handed to the customer must match the exact approved refund amount of NPR '.number_format($cashRefundDue, 2).'.',
                            422
                        );
                    }
                }

                $now = now();
                if (! $alreadyPickedUp) {
                    $return->pickup_collected_at = $now;
                    $return->pickup_collected_by = $request->user()->id;
                }
                if ($isCod && $cashRefundDue > 0) {
                    $return->cash_refund_amount = round((float) $return->cash_refund_amount + $cashRefundDue, 2);
                    $return->cash_refund_handed_at = $now;
                    $return->cash_refund_handed_by = $request->user()->id;
                }

                $currentNotes = (string) ($return->review_notes ?? '');
                if (! $alreadyPickedUp && ! str_contains($currentNotes, '[PICKUP_COLLECTED:')) {
                    $return->review_notes = trim($currentNotes . ' [PICKUP_COLLECTED:' . $now->toISOString() . ':by:' . $request->user()->id . ']');
                }
                if ($isCod && $cashRefundDue > 0) {
                    $return->review_notes = trim(
                        (string) ($return->review_notes ?? $currentNotes)
                        .' [COD_CASH_REFUND:'.number_format($cashRefundDue, 2, '.', '').':'.$now->toISOString().':by:'.$request->user()->id.']'
                    );
                }

                if (in_array($statusVal, ['approved', 'pickup_arranged'], true)) {
                    $return->status = ReturnStatus::COLLECTED;
                }
                $return->save();

                foreach ($approvedRefunds as $refund) {
                    $this->refundService->updateStatus(
                        $request->user(),
                        $refund,
                        RefundStatus::REFUNDED,
                        null,
                        ['cod_cash_handoff' => [
                            'amount' => number_format($cashRefundDue, 2, '.', ''),
                            'handed_at' => $now->toISOString(),
                            'delivery_partner_user_id' => $request->user()->id,
                        ]]
                    );
                }

                $return->load(['order', 'orderItem', 'vendorOrder', 'assignedDeliveryPartner', 'refunds.payment']);
                $return->setRelation('pickup_assignment', $assignment);
                $return->setAttribute('cod_refund_due', 0);

                return $return;
            });
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }

        return Response::success(new DeliveryReturnResource($return), 'Customer return pickup confirmed.');
    }

    public function assignment(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        $partner = $this->partnerFor($request->user());

        if ($assignment->delivery_partner_id !== $partner->id) {
            throw new DomainException('You do not have access to this delivery.', 403);
        }

        return Response::success(
            new DeliveryAssignmentResource($assignment->load([
                'tracking',
                'vendorOrder.order.shippingAddress',
                'vendorOrder.store.addresses',
                'vendorOrder.vendor.kyc',
            ])),
            'Delivery assignment retrieved.'
        );
    }

    public function accept(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = $this->service->accept($request->user(), $assignment);

        return Response::success(new DeliveryAssignmentResource($assignment->load([
            'tracking',
            'vendorOrder.order.shippingAddress',
            'vendorOrder.store.addresses',
            'vendorOrder.vendor.kyc',
        ])), 'Delivery accepted.');
    }

    public function pickup(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = $this->service->pickup($request->user(), $assignment);

        return Response::success(new DeliveryAssignmentResource($assignment->load([
            'tracking',
            'vendorOrder.order.shippingAddress',
            'vendorOrder.store.addresses',
            'vendorOrder.vendor.kyc',
        ])), 'Order picked up.');
    }

    public function outForDelivery(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        [$assignment] = $this->service->outForDelivery($request->user(), $assignment);

        return Response::success(
            new DeliveryAssignmentResource($assignment->load([
                'tracking',
                'vendorOrder.order.shippingAddress',
                'vendorOrder.store.addresses',
                'vendorOrder.vendor.kyc',
            ])),
            'Order is out for delivery. Request the 6-digit confirmation OTP from the customer upon arrival.'
        );
    }

    public function deliver(DeliveryConfirmationRequest $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = $this->service->deliver($request->user(), $assignment, $request->input('otp'));

        return Response::success(new DeliveryAssignmentResource($assignment->load([
            'tracking',
            'vendorOrder.order.shippingAddress',
            'vendorOrder.store.addresses',
            'vendorOrder.vendor.kyc',
        ])), 'Delivery confirmed.');
    }

    public function fail(DeliveryFailureRequest $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = $this->service->fail($request->user(), $assignment, $request->input('reason'));

        return Response::success(new DeliveryAssignmentResource($assignment->load([
            'tracking',
            'vendorOrder.order.shippingAddress',
            'vendorOrder.store.addresses',
            'vendorOrder.vendor.kyc',
        ])), 'Delivery marked as failed.');
    }

    public function returnToVendor(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = $this->service->returnToVendor($request->user(), $assignment, $request->input('reason'));

        return Response::success(new DeliveryAssignmentResource($assignment->load([
            'tracking',
            'vendorOrder.order.shippingAddress',
            'vendorOrder.store.addresses',
            'vendorOrder.vendor.kyc',
        ])), 'Order returned to vendor.');
    }

    public function availableJobs(Request $request): JsonResponse
    {
        $list = $this->service->availableJobsForPartner($request->user(), [
            'search' => (string) $request->input('search', ''),
            'scope' => (string) $request->input('scope', 'my_area'),
            'page' => $request->integer('page', 1),
            'per_page' => $request->integer('per_page', 15),
        ]);

        return Response::success(
            AvailableJobResource::collection($list),
            'Available delivery jobs retrieved.',
            ['pagination' => [
                'total' => $list->total(),
                'per_page' => $list->perPage(),
                'current_page' => $list->currentPage(),
                'last_page' => $list->lastPage(),
            ]]
        );
    }

    public function availableJobDetail(VendorOrder $vendorOrder): JsonResponse
    {
        $vendorOrder->load(['store.addresses', 'order', 'items']);

        return Response::success(
            new AvailableJobResource($vendorOrder),
            'Available job detail retrieved.'
        );
    }

    public function claim(Request $request, VendorOrder $vendorOrder): JsonResponse
    {
        try {
            $assignment = $this->service->claim($request->user(), $vendorOrder);

            return Response::success(
                new DeliveryAssignmentResource($assignment->load([
                    'tracking',
                    'vendorOrder.order.shippingAddress',
                    'vendorOrder.store.addresses',
                    'vendorOrder.vendor.kyc',
                    'deliveryPartner',
                ])),
                'Shipment claimed successfully.'
            );
        } catch (DomainException $e) {
            return Response::error($e->getMessage(), $e->getErrors(), $e->getStatusCode());
        }
    }

    public function dashboardStats(Request $request): JsonResponse
    {
        $stats = $this->service->partnerDashboardStats($request->user());

        return Response::success($stats, 'Delivery partner dashboard stats retrieved.');
    }

    public function history(Request $request): JsonResponse
    {
        $partner = $this->partnerFor($request->user());
        $filters = $request->validate([
            'status' => ['nullable', 'in:delivered,failed,returned_to_vendor'],
            'search' => ['nullable', 'string', 'max:100'],
        ]);

        $query = $partner->assignments()
            ->with([
                'tracking',
                'vendorOrder.order.shippingAddress',
                'vendorOrder.store.addresses',
                'vendorOrder.vendor.kyc',
            ])
            ->addSelect([
                'refunded_amount' => Refund::query()
                    ->selectRaw('COALESCE(SUM(amount), 0)')
                    ->whereColumn('refunds.vendor_order_id', 'delivery_assignments.vendor_order_id')
                    ->where('status', 'refunded'),
            ])
            ->whereIn('status', ['delivered', 'failed', 'returned_to_vendor'])
            ->when($filters['status'] ?? null, fn ($query, $status) => $query->where('status', $status))
            ->when($filters['search'] ?? null, function ($query, $search) {
                $term = '%'.$search.'%';
                $query->where(function ($inner) use ($term) {
                    $inner->where('recipient_name', 'like', $term)
                        ->orWhere('recipient_phone', 'like', $term)
                        ->orWhereHas('vendorOrder', fn ($order) => $order->where('vendor_order_number', 'like', $term));
                });
            })
            ->orderByDesc('delivered_at');

        ListingDateRange::apply($query->getQuery(), $request, 'delivered_at');
        $history = $query->paginate(min(max($request->integer('per_page', 15), 1), 100))->withQueryString();

        return Response::success(
            DeliveryAssignmentResource::collection($history),
            'Delivery history retrieved.',
            ['pagination' => [
                'total' => $history->total(),
                'per_page' => $history->perPage(),
                'current_page' => $history->currentPage(),
                'last_page' => $history->lastPage(),
            ]]
        );
    }

    protected function partnerFor(User $user): DeliveryPartner
    {
        $partner = $user->deliveryPartner;

        if (! $partner) {
            throw new DomainException('No delivery partner profile found for this account.', 404);
        }

        return $partner;
    }
}
