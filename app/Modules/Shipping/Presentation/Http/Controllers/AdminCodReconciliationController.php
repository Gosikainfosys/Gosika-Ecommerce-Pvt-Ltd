<?php

namespace App\Modules\Shipping\Presentation\Http\Controllers;

use App\Modules\Identity\Domain\Permissions;
use App\Modules\Payment\Infrastructure\Models\Refund;
use App\Modules\Shared\Domain\Enums\DeliveryStatus;
use App\Modules\Shared\Domain\Enums\PaymentMethod;
use App\Modules\Shared\Domain\Exceptions\DomainException;
use App\Modules\Shared\Presentation\Http\Filters\ListingDateRange;
use App\Modules\Shared\Presentation\Http\Response;
use App\Modules\Shipping\Infrastructure\Models\DeliveryAssignment;
use App\Modules\Shipping\Infrastructure\Models\DeliveryPartner;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;
use Illuminate\Support\Facades\DB;

class AdminCodReconciliationController extends Controller
{
    public function __construct()
    {
        $this->middleware('auth:sanctum');
        $this->middleware('ensure:admin');
        $this->middleware('permission:'.Permissions::PAYMENTS_VIEW.'|'.Permissions::RECONCILIATION_MANAGE);
    }

    public function index(Request $request): JsonResponse
    {
        $query = $this->baseCodQuery()->with(['deliveryPartner', 'vendorOrder.order.user', 'codReconciledBy']);
        $this->applyIndexStatus($query, (string) $request->input('status', 'pending'));
        $this->applySearch($query, (string) $request->input('search', ''));

        $assignments = $query
            ->orderByDesc('delivered_at')
            ->paginate(min(max($request->integer('per_page', 15), 1), 100));

        $rows = $assignments->getCollection()->map(fn (DeliveryAssignment $assignment) => $this->row($assignment));

        return Response::success($rows, 'COD reconciliation records retrieved.', [
            'summary' => $this->summary(),
            'pagination' => $this->paginationMeta($assignments),
        ]);
    }

    /**
     * Partner-first reconciliation overview. One row per delivery partner
     * instead of one row per COD order.
     */
    public function partners(Request $request): JsonResponse
    {
        $netCodAmountSql = $this->netCodAmountSql();
        $refundedAmountSql = $this->refundedAmountSql();

        $query = $this->baseCodQuery(false)
            ->selectRaw('delivery_assignments.delivery_partner_id')
            ->selectRaw('COUNT(*) as order_count')
            ->selectRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NULL AND '.$netCodAmountSql.' > 0 THEN 1 ELSE 0 END) as pending_orders')
            ->selectRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NOT NULL THEN 1 ELSE 0 END) as collected_orders')
            ->selectRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NULL THEN '.$netCodAmountSql.' ELSE 0 END) as pending_amount')
            ->selectRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NOT NULL THEN '.$netCodAmountSql.' ELSE 0 END) as collected_amount')
            ->selectRaw('SUM('.$refundedAmountSql.') as refunded_amount')
            ->selectRaw('MAX(delivery_assignments.delivered_at) as last_delivered_at')
            ->groupBy('delivery_assignments.delivery_partner_id');

        $status = (string) $request->input('status', 'pending');
        if ($status === 'pending') {
            $query->havingRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NULL AND '.$netCodAmountSql.' > 0 THEN 1 ELSE 0 END) > 0');
        } elseif ($status === 'collected') {
            $query->havingRaw('SUM(CASE WHEN delivery_assignments.cod_reconciled_at IS NOT NULL THEN 1 ELSE 0 END) > 0');
        } elseif ($status !== 'all') {
            throw new DomainException('Choose pending, collected, or all COD partners.', 422);
        }

        $this->applyPartnerSearch($query, (string) $request->input('search', ''));
        ListingDateRange::apply($query, $request, 'delivery_assignments.delivered_at');

        $partners = $query
            ->orderByDesc('pending_amount')
            ->paginate(min(max($request->integer('per_page', 15), 1), 100))
            ->withQueryString();

        $ids = $partners->getCollection()->pluck('delivery_partner_id')->filter()->all();
        $partnerModels = DeliveryPartner::query()->whereIn('id', $ids)->get()->keyBy('id');

        $rows = $partners->getCollection()->map(function ($row) use ($partnerModels) {
            $partner = $partnerModels->get((int) $row->delivery_partner_id);

            return [
                'id' => $partner?->uuid,
                'name' => $partner?->name ?? 'Unknown partner',
                'phone' => $partner?->phone,
                'email' => $partner?->email,
                'status' => $partner?->status?->value,
                'service_areas' => $partner?->service_areas ?? [],
                'shipping_zone_ids' => $partner?->shipping_zone_ids ?? [],
                'order_count' => (int) $row->order_count,
                'pending_orders' => (int) $row->pending_orders,
                'collected_orders' => (int) $row->collected_orders,
                'pending_amount' => round((float) $row->pending_amount, 2),
                'collected_amount' => round((float) $row->collected_amount, 2),
                'refunded_amount' => round((float) $row->refunded_amount, 2),
                'last_delivered_at' => $row->last_delivered_at ? (string) $row->last_delivered_at : null,
            ];
        });

        return Response::success($rows, 'COD reconciliation partners retrieved.', [
            'summary' => $this->summary(),
            'pagination' => $this->paginationMeta($partners),
        ]);
    }

    /**
     * Full partner profile plus filtered COD order history.
     */
    public function partnerDetail(Request $request, string $partnerId): JsonResponse
    {
        $partner = $this->findCodPartner($partnerId);
        $netCodAmountSql = $this->netCodAmountSql();

        $query = $this->baseCodQuery()
            ->with(['deliveryPartner', 'vendorOrder.order.user', 'codReconciledBy'])
            ->where('delivery_assignments.delivery_partner_id', $partner->id);

        $status = (string) $request->input('status', 'pending');
        if ($status === 'pending') {
            $query->whereNull('cod_reconciled_at')->whereRaw($netCodAmountSql.' > 0');
        } elseif ($status === 'collected') {
            $query->whereNotNull('cod_reconciled_at');
        } elseif ($status === 'refunded') {
            $query->whereNull('cod_reconciled_at')->whereRaw($netCodAmountSql.' <= 0');
        } elseif ($status !== 'all') {
            throw new DomainException('Choose pending, collected, refunded, or all COD records.', 422);
        }

        $this->applySearch($query, (string) $request->input('search', ''));
        ListingDateRange::apply($query, $request, 'delivery_assignments.delivered_at');

        $assignments = $query
            ->orderByDesc('delivered_at')
            ->paginate(min(max($request->integer('per_page', 15), 1), 100))
            ->withQueryString();

        return Response::success(
            $assignments->getCollection()->map(fn (DeliveryAssignment $assignment) => $this->row($assignment)),
            'Delivery partner COD history retrieved.',
            [
                'profile' => $this->partnerProfile($partner),
                'partner_summary' => $this->partnerSummary($partner),
                'pagination' => $this->paginationMeta($assignments),
            ]
        );
    }

    public function collect(Request $request, DeliveryAssignment $assignment): JsonResponse
    {
        $assignment = DB::transaction(function () use ($request, $assignment): array {
            $locked = DeliveryAssignment::query()->whereKey($assignment->getKey())->lockForUpdate()->firstOrFail();
            $refundedAmount = $this->assertReconcilable($locked);
            $this->markReconciled($locked, (int) $request->user()->id, $refundedAmount);

            return [$locked->fresh(['deliveryPartner', 'vendorOrder.order.user', 'codReconciledBy']), $refundedAmount];
        });

        return Response::success($this->rowWithRefund($assignment[0], $assignment[1]), 'COD cash receipt recorded.');
    }

    /**
     * Collect every pending COD amount for one delivery partner in one action.
     */
    public function collectPartner(Request $request, string $partnerId): JsonResponse
    {
        $partner = $this->findCodPartner($partnerId);
        $netCodAmountSql = $this->netCodAmountSql();

        $result = DB::transaction(function () use ($request, $partner, $netCodAmountSql): array {
            $assignments = $this->baseCodQuery()
                ->where('delivery_assignments.delivery_partner_id', $partner->id)
                ->whereNull('cod_reconciled_at')
                ->whereRaw($netCodAmountSql.' > 0')
                ->lockForUpdate()
                ->get();

            if ($assignments->isEmpty()) {
                throw new DomainException('This delivery partner has no pending COD to collect.', 422);
            }

            $collectedAmount = 0.0;
            foreach ($assignments as $assignment) {
                $refundedAmount = $this->assertReconcilable($assignment);
                $this->markReconciled($assignment, (int) $request->user()->id, $refundedAmount);
                $collectedAmount += max(0, round((float) $assignment->cod_amount - $refundedAmount, 2));
            }

            return [
                'collected_count' => $assignments->count(),
                'collected_amount' => round($collectedAmount, 2),
            ];
        });

        return Response::success(array_merge($result, [
            'profile' => $this->partnerProfile($partner),
            'partner_summary' => $this->partnerSummary($partner->fresh()),
        ]), 'COD cash collected from delivery partner.');
    }

    protected function baseCodQuery(bool $withRows = true): Builder
    {
        $query = DeliveryAssignment::query()
            ->where('delivery_assignments.status', DeliveryStatus::DELIVERED)
            ->where('delivery_assignments.cod_amount', '>', 0)
            ->whereHas('vendorOrder.order', fn ($query) => $query->where('payment_method', PaymentMethod::COD->value));

        if ($withRows) {
            $query->select('delivery_assignments.*')->selectSub(
                Refund::query()
                    ->selectRaw('COALESCE(SUM(amount), 0)')
                    ->whereColumn('vendor_order_id', 'delivery_assignments.vendor_order_id')
                    ->where('status', 'refunded'),
                'refunded_amount'
            );
        }

        return $query;
    }

    protected function refundedAmountSql(): string
    {
        return "(SELECT COALESCE(SUM(refunds.amount), 0) FROM refunds WHERE refunds.vendor_order_id = delivery_assignments.vendor_order_id AND refunds.status = 'refunded')";
    }

    protected function netCodAmountSql(): string
    {
        $refunded = $this->refundedAmountSql();

        return "CASE WHEN delivery_assignments.cod_amount > {$refunded} THEN delivery_assignments.cod_amount - {$refunded} ELSE 0 END";
    }

    protected function applyIndexStatus(Builder $query, string $status): void
    {
        if ($status === 'pending') {
            $query->whereNull('cod_reconciled_at');
        } elseif ($status === 'collected') {
            $query->whereNotNull('cod_reconciled_at');
        } elseif ($status !== 'all') {
            throw new DomainException('Choose pending, collected, or all COD records.', 422);
        }
    }

    protected function applySearch(Builder $query, string $search): void
    {
        $search = trim($search);
        if ($search === '') {
            return;
        }

        $query->where(function ($builder) use ($search) {
            $builder->whereHas('deliveryPartner', fn ($partnerQuery) => $partnerQuery
                ->where('name', 'like', '%'.$search.'%')
                ->orWhere('phone', 'like', '%'.$search.'%'))
                ->orWhereHas('vendorOrder.order', fn ($orderQuery) => $orderQuery
                    ->where('order_number', 'like', '%'.$search.'%'))
                ->orWhereHas('vendorOrder', fn ($vendorOrderQuery) => $vendorOrderQuery
                    ->where('vendor_order_number', 'like', '%'.$search.'%'));
        });
    }

    protected function applyPartnerSearch(Builder $query, string $search): void
    {
        $search = trim($search);
        if ($search === '') {
            return;
        }

        $query->whereHas('deliveryPartner', fn ($partnerQuery) => $partnerQuery
            ->where('name', 'like', '%'.$search.'%')
            ->orWhere('phone', 'like', '%'.$search.'%')
            ->orWhere('email', 'like', '%'.$search.'%'));
    }

    protected function summary(): array
    {
        $netCodAmountSql = $this->netCodAmountSql();

        return [
            'pending_amount' => round((float) (clone $this->baseCodQuery())->whereNull('cod_reconciled_at')->sum(DB::raw($netCodAmountSql)), 2),
            'pending_count' => (clone $this->baseCodQuery())->whereNull('cod_reconciled_at')->whereRaw($netCodAmountSql.' > 0')->count(),
            'collected_amount' => round((float) (clone $this->baseCodQuery())->whereNotNull('cod_reconciled_at')->sum(DB::raw($netCodAmountSql)), 2),
            'collected_count' => (clone $this->baseCodQuery())->whereNotNull('cod_reconciled_at')->count(),
        ];
    }

    protected function partnerSummary(DeliveryPartner $partner): array
    {
        $netCodAmountSql = $this->netCodAmountSql();
        $query = $this->baseCodQuery()->where('delivery_assignments.delivery_partner_id', $partner->id);

        return [
            'pending_amount' => round((float) (clone $query)->whereNull('cod_reconciled_at')->sum(DB::raw($netCodAmountSql)), 2),
            'collected_amount' => round((float) (clone $query)->whereNotNull('cod_reconciled_at')->sum(DB::raw($netCodAmountSql)), 2),
            'refunded_amount' => round((float) (clone $query)->sum(DB::raw($this->refundedAmountSql())), 2),
            'pending_count' => (clone $query)->whereNull('cod_reconciled_at')->whereRaw($netCodAmountSql.' > 0')->count(),
            'collected_count' => (clone $query)->whereNotNull('cod_reconciled_at')->count(),
            'order_count' => (clone $query)->count(),
        ];
    }

    protected function assertReconcilable(DeliveryAssignment $assignment): float
    {
        $assignment->load('vendorOrder.order');

        if ($assignment->status !== DeliveryStatus::DELIVERED
            || (float) $assignment->cod_amount <= 0
            || $assignment->vendorOrder?->order?->payment_method !== PaymentMethod::COD->value) {
            throw new DomainException('Only successfully delivered COD orders can be reconciled.', 422);
        }

        if ($assignment->cod_reconciled_at) {
            throw new DomainException('This COD amount has already been recorded as received.', 422);
        }

        $refundedAmount = (float) $assignment->vendorOrder->refunds()
            ->where('status', 'refunded')
            ->sum('amount');

        if (round((float) $assignment->cod_amount - $refundedAmount, 2) <= 0) {
            throw new DomainException('The COD amount has been fully offset by refunds.', 422);
        }

        return $refundedAmount;
    }

    protected function markReconciled(DeliveryAssignment $assignment, int $userId, float $refundedAmount): void
    {
        $assignment->update([
            'cod_reconciled_at' => now(),
            'cod_reconciled_by' => $userId,
        ]);
        $assignment->setAttribute('refunded_amount', $refundedAmount);
    }

    protected function findCodPartner(string $partnerId): DeliveryPartner
    {
        return DeliveryPartner::query()
            ->where('uuid', $partnerId)
            ->when(ctype_digit($partnerId), fn ($query) => $query->orWhere('id', (int) $partnerId))
            ->firstOrFail();
    }

    protected function partnerProfile(DeliveryPartner $partner): array
    {
        return [
            'id' => $partner->uuid,
            'name' => $partner->name,
            'phone' => $partner->phone,
            'email' => $partner->email,
            'status' => $partner->status?->value,
            'vehicle_type' => $partner->vehicle_type,
            'vehicle_number' => $partner->vehicle_number,
            'rating_avg' => (float) $partner->rating_avg,
            'rating_count' => (int) $partner->rating_count,
            'service_areas' => $partner->service_areas ?? [],
            'shipping_zone_ids' => $partner->shipping_zone_ids ?? [],
            'created_at' => $partner->created_at?->toISOString(),
        ];
    }

    protected function paginationMeta($paginator): array
    {
        return [
            'current_page' => $paginator->currentPage(),
            'per_page' => $paginator->perPage(),
            'total' => $paginator->total(),
            'last_page' => $paginator->lastPage(),
        ];
    }

    protected function row(DeliveryAssignment $assignment): array
    {
        return $this->rowWithRefund($assignment, (float) ($assignment->refunded_amount ?? 0));
    }

    protected function rowWithRefund(DeliveryAssignment $assignment, float $refundedAmount): array
    {
        $order = $assignment->vendorOrder?->order;
        $originalCodAmount = round((float) $assignment->cod_amount, 2);
        $refundedAmount = round($refundedAmount, 2);

        return [
            'id' => $assignment->uuid,
            'order_number' => $order?->order_number,
            'vendor_order_number' => $assignment->vendorOrder?->vendor_order_number,
            'customer_name' => $order?->user?->full_name ?? $order?->user?->name,
            'delivery_partner_name' => $assignment->deliveryPartner?->name,
            'delivery_partner_phone' => $assignment->deliveryPartner?->phone,
            'original_cod_amount' => $originalCodAmount,
            'refunded_amount' => $refundedAmount,
            'cod_amount' => max(0, round($originalCodAmount - $refundedAmount, 2)),
            'delivered_at' => $assignment->delivered_at?->toISOString(),
            'cod_reconciled_at' => $assignment->cod_reconciled_at?->toISOString(),
            'cod_reconciled_by' => $assignment->codReconciledBy?->full_name ?? $assignment->codReconciledBy?->name,
            'status' => $assignment->cod_reconciled_at ? 'collected' : ($originalCodAmount <= $refundedAmount ? 'refunded' : 'pending'),
        ];
    }
}
