<?php

namespace App\Modules\Platform\Presentation\Http\Controllers;

use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Presentation\Http\Requests\StoreCustomCoveragePolygonRequest;
use App\Modules\Platform\Presentation\Http\Requests\UpdateCustomCoveragePolygonRequest;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class AdminCustomCoveragePolygonController extends Controller
{
    public function __construct(private readonly CustomCoveragePolygonService $polygons)
    {
    }

    public function index(Request $request): JsonResponse
    {
        $polygons = CustomCoveragePolygon::query()
            ->when($request->input('search'), fn ($q, $search) => $q
                ->where('name', 'like', "%{$search}%")
                ->orWhere('reason', 'like', "%{$search}%"))
            ->when($request->filled('verification_status'), fn ($q) => $q
                ->where('verification_status', $request->string('verification_status')->toString()))
            ->latest()
            ->paginate($request->integer('per_page', 50));

        return Response::success(
            $polygons->through(fn (CustomCoveragePolygon $polygon) => $this->serialize($polygon)),
            'Custom coverage polygons retrieved.',
            ['pagination' => [
                'total' => $polygons->total(),
                'per_page' => $polygons->perPage(),
                'current_page' => $polygons->currentPage(),
                'last_page' => $polygons->lastPage(),
            ]]
        );
    }

    public function store(StoreCustomCoveragePolygonRequest $request): JsonResponse
    {
        $polygon = $this->polygons->create($request->validated());

        return Response::created($this->serialize($polygon->fresh(), true), 'Custom coverage polygon created and queued for verification.');
    }

    public function show(string $polygonId): JsonResponse
    {
        $polygon = CustomCoveragePolygon::where('uuid', $polygonId)->firstOrFail();

        return Response::success($this->serialize($polygon, true), 'Custom coverage polygon retrieved.');
    }

    public function update(UpdateCustomCoveragePolygonRequest $request, string $polygonId): JsonResponse
    {
        $polygon = CustomCoveragePolygon::where('uuid', $polygonId)->firstOrFail();
        $polygon = $this->polygons->update($polygon, $request->validated());

        return Response::success($this->serialize($polygon, true), 'Custom coverage polygon updated.');
    }

    public function destroy(string $polygonId): JsonResponse
    {
        CustomCoveragePolygon::where('uuid', $polygonId)->firstOrFail()->delete();

        return Response::success(null, 'Custom coverage polygon deleted.');
    }

    public function verify(Request $request, string $polygonId): JsonResponse
    {
        $polygon = CustomCoveragePolygon::where('uuid', $polygonId)->firstOrFail();
        $polygon = $this->polygons->verify($polygon, (int) $request->user()->id);

        return Response::success($this->serialize($polygon, true), 'Custom coverage polygon verified.');
    }

    public function reject(Request $request, string $polygonId): JsonResponse
    {
        $polygon = CustomCoveragePolygon::where('uuid', $polygonId)->firstOrFail();
        $polygon = $this->polygons->reject($polygon, (int) $request->user()->id);

        return Response::success($this->serialize($polygon, true), 'Custom coverage polygon rejected.');
    }

    private function serialize(CustomCoveragePolygon $polygon, bool $withGeometry = false): array
    {
        $data = [
            'id' => $polygon->id,
            'uuid' => $polygon->uuid,
            'name' => $polygon->name,
            'description' => $polygon->description,
            'reason' => $polygon->reason,
            'province_id' => $polygon->province_id,
            'district_id' => $polygon->district_id,
            'municipality_id' => $polygon->municipality_id,
            'ward_id' => $polygon->ward_id,
            'parent_label' => $polygon->parentLabel(),
            'source' => $polygon->source,
            'source_url' => $polygon->source_url,
            'verification_status' => $polygon->verification_status,
            'verified_at' => $polygon->verified_at?->toISOString(),
            'expires_at' => $polygon->expires_at?->toISOString(),
            'is_active' => $polygon->is_active,
            'bbox' => [
                'min_lng' => $polygon->bbox_min_lng,
                'min_lat' => $polygon->bbox_min_lat,
                'max_lng' => $polygon->bbox_max_lng,
                'max_lat' => $polygon->bbox_max_lat,
            ],
            'created_at' => $polygon->created_at?->toISOString(),
        ];

        if ($withGeometry) {
            $data['geometry'] = $polygon->geometry;
            $data['display_geometry'] = $polygon->display_geometry;
        }

        return $data;
    }
}
