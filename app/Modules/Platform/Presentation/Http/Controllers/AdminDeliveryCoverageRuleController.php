<?php

namespace App\Modules\Platform\Presentation\Http\Controllers;

use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Application\Services\DeliveryLocationResolver;
use App\Modules\Platform\Application\Services\WardLookupService;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Presentation\Http\Requests\StoreDeliveryCoverageRuleRequest;
use App\Modules\Platform\Presentation\Http\Requests\UpdateDeliveryCoverageRuleRequest;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class AdminDeliveryCoverageRuleController extends Controller
{
    public function __construct(
        private readonly DeliveryCoverageService $coverage,
        private readonly WardLookupService $wards,
        private readonly DeliveryLocationResolver $locations,
    ) {
    }

    public function index(Request $request): JsonResponse
    {
        $rules = DeliveryCoverageRule::query()
            ->with(['province', 'district', 'municipality', 'ward'])
            ->when($request->input('search'), fn ($q, $search) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('description', 'like', "%{$search}%"))
            ->when($request->filled('scope_type'), fn ($q) => $q->where('scope_type', $request->string('scope_type')->toString()))
            ->when($request->filled('decision'), fn ($q) => $q->where('decision', $request->string('decision')->toString()))
            ->latest('priority')
            ->latest()
            ->paginate($request->integer('per_page', 50));

        return Response::success(
            $rules->through(fn (DeliveryCoverageRule $rule) => $this->serializeRule($rule)),
            'Delivery coverage rules retrieved.',
            ['pagination' => [
                'total' => $rules->total(),
                'per_page' => $rules->perPage(),
                'current_page' => $rules->currentPage(),
                'last_page' => $rules->lastPage(),
            ]]
        );
    }

    public function store(StoreDeliveryCoverageRuleRequest $request): JsonResponse
    {
        $rule = DeliveryCoverageRule::create($this->hydrateWard($request->validated()));

        return Response::created($this->serializeRule($rule->fresh()), 'Delivery coverage rule created.');
    }

    public function show(string $ruleId): JsonResponse
    {
        $rule = DeliveryCoverageRule::where('uuid', $ruleId)->firstOrFail();

        return Response::success($this->serializeRule($rule), 'Delivery coverage rule retrieved.');
    }

    public function update(UpdateDeliveryCoverageRuleRequest $request, string $ruleId): JsonResponse
    {
        $rule = DeliveryCoverageRule::where('uuid', $ruleId)->firstOrFail();
        $rule->update($this->hydrateWard($request->validated()));

        return Response::success($this->serializeRule($rule->fresh()), 'Delivery coverage rule updated.');
    }

    public function destroy(string $ruleId): JsonResponse
    {
        DeliveryCoverageRule::where('uuid', $ruleId)->firstOrFail()->delete();

        return Response::success(null, 'Delivery coverage rule deleted.');
    }

    public function evaluate(Request $request): JsonResponse
    {
        $data = $request->validate([
            'province_id' => ['required', 'exists:provinces,id'],
            'district_id' => ['nullable', 'exists:districts,id'],
            'municipality_id' => ['nullable', 'exists:municipalities,id'],
            'ward_id' => ['nullable', 'exists:wards,id'],
            'ward_number' => ['nullable', 'integer', 'between:1,99'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'service_mode' => ['nullable', 'in:standard,express'],
        ]);

        $assessment = $this->coverage->assess(
            $this->locations->resolve($data),
            $data['service_mode'] ?? 'standard'
        );

        $payload = $assessment->toArray();
        if ($payload['rule']) {
            $payload['rule'] = $this->serializeRule(
                DeliveryCoverageRule::where('uuid', $payload['rule']['uuid'])->firstOrFail()
            );
        }

        return Response::success($payload, 'Delivery coverage evaluated.');
    }

    private function hydrateWard(array $validated): array
    {
        $scope = $validated['scope_type'] ?? null;

        if ($scope !== DeliveryCoverageRule::SCOPE_WARD) {
            $validated['ward_id'] = null;
            unset($validated['ward_number']);

            return $validated;
        }

        if (array_key_exists('ward_number', $validated) && $validated['ward_number'] !== null) {
            $validated['ward_id'] = $this->wards->findOrCreate(
                (int) ($validated['municipality_id'] ?? 0),
                (int) $validated['ward_number']
            )->id;
        }

        unset($validated['ward_number']);

        return $validated;
    }

    private function serializeRule(DeliveryCoverageRule $rule): array
    {
        return [
            'id' => $rule->id,
            'uuid' => $rule->uuid,
            'name' => $rule->name,
            'description' => $rule->description,
            'scope_type' => $rule->scope_type,
            'scope_label' => $rule->scopeLabel(),
            'province_id' => $rule->province_id,
            'district_id' => $rule->district_id,
            'municipality_id' => $rule->municipality_id,
            'ward_id' => $rule->ward_id,
            'ward_number' => $rule->ward?->ward_number,
            'ward' => $rule->ward ? [
                'id' => $rule->ward->id,
                'uuid' => $rule->ward->uuid,
                'ward_number' => $rule->ward->ward_number,
                'label' => $rule->ward->label,
            ] : null,
            'decision' => $rule->decision,
            'service_mode' => $rule->service_mode,
            'priority' => $rule->priority,
            'effective_from' => $rule->effective_from?->toISOString(),
            'effective_to' => $rule->effective_to?->toISOString(),
            'is_active' => $rule->is_active,
            'created_at' => $rule->created_at?->toISOString(),
            'updated_at' => $rule->updated_at?->toISOString(),
        ];
    }
}
