<?php

namespace App\Modules\Platform\Presentation\Http\Controllers;

use App\Modules\Platform\Application\Services\CoverageAreaService;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Presentation\Http\Requests\StoreCoverageAreaRequest;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Routing\Controller;

class AdminCoverageAreaController extends Controller
{
    public function __construct(private readonly CoverageAreaService $areas)
    {
    }

    public function index(): JsonResponse
    {
        $areas = $this->areas->mapAreas()
            ->map(fn (CustomCoveragePolygon $area) => $this->serialize($area))
            ->values();

        return Response::success($areas, 'Coverage areas retrieved.');
    }

    public function store(StoreCoverageAreaRequest $request): JsonResponse
    {
        $area = $this->areas->create($request->validated(), (int) $request->user()->id);

        return Response::created($this->serialize($area), 'Coverage area created and activated.');
    }

    public function destroy(string $areaId): JsonResponse
    {
        $area = CustomCoveragePolygon::query()
            ->where('uuid', $areaId)
            ->where('is_coverage_area', true)
            ->firstOrFail();

        $this->areas->destroy($area);

        return Response::success(null, 'Coverage area deleted.');
    }

    private function serialize(CustomCoveragePolygon $area): array
    {
        return [
            'id' => $area->id,
            'uuid' => $area->uuid,
            'name' => $area->name,
            'description' => $area->description,
            'reason' => $area->reason,
            'is_coverage_area' => (bool) $area->is_coverage_area,
            'province_id' => $area->province_id,
            'district_id' => $area->district_id,
            'municipality_id' => $area->municipality_id,
            'ward_id' => $area->ward_id,
            'ward_number' => $area->ward?->ward_number,
            'parent_label' => $area->parentLabel(),
            'label' => $area->ward
                ? "{$area->municipality?->name} — Ward {$area->ward->ward_number}"
                : $area->parentLabel(),
            'verification_status' => $area->verification_status,
            'is_active' => (bool) $area->is_active,
            'source' => $area->source,
            'source_url' => $area->source_url,
            'bbox' => [
                'min_lng' => $area->bbox_min_lng,
                'min_lat' => $area->bbox_min_lat,
                'max_lng' => $area->bbox_max_lng,
                'max_lat' => $area->bbox_max_lat,
            ],
            'geometry' => $area->display_geometry ?: $area->geometry,
            'created_at' => $area->created_at?->toISOString(),
        ];
    }
}
