<?php

namespace App\Modules\Platform\Presentation\Http\Controllers;

use App\Modules\Platform\Application\Services\GeoBoundaryService;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class AdminGeoBoundaryController extends Controller
{
    private const MODELS = [
        'province' => Province::class,
        'district' => District::class,
        'municipality' => Municipality::class,
    ];

    public function __construct(private readonly GeoBoundaryService $boundaries)
    {
    }

    public function show(Request $request, string $type, string $geo): JsonResponse
    {
        if ($type === 'ward') {
            return Response::error(
                'No verified ward boundary dataset is available. Ward polygons are not fabricated.',
                [],
                422,
                [
                    'geo_type' => 'ward',
                    'available' => false,
                    'reason' => 'no_verified_dataset',
                ]
            );
        }

        if (! isset(self::MODELS[$type])) {
            return Response::error('Unknown geographic level.', [], 404);
        }

        $record = $this->findMasterRecord($type, $geo);
        if (! $record) {
            return Response::error('The selected geographic unit was not found.', [], 404, [
                'geo_type' => $type,
                'available' => false,
                'reason' => 'master_record_missing',
            ]);
        }

        $boundary = $this->boundaries->findBoundary($type, (int) $record->id);
        if (! $boundary) {
            return Response::error(
                'No verified boundary is available for the selected geographic unit.',
                [],
                404,
                [
                    'geo_type' => $type,
                    'geo_uuid' => $record->uuid,
                    'name' => $record->name,
                    'available' => false,
                    'reason' => 'boundary_missing',
                ]
            );
        }

        $display = $request->boolean('display', true);
        $useDisplay = $display && ! empty($boundary->display_geometry);
        $geometry = $useDisplay ? $boundary->display_geometry : $boundary->geometry;

        return Response::success([
            'geo_type' => $type,
            'geo_uuid' => $record->uuid,
            'name' => $record->name,
            'available' => true,
            'geometry' => $geometry,
            'geometry_mode' => $useDisplay ? 'display' : 'full',
            'bbox' => [
                'min_lng' => $boundary->bbox_min_lng,
                'min_lat' => $boundary->bbox_min_lat,
                'max_lng' => $boundary->bbox_max_lng,
                'max_lat' => $boundary->bbox_max_lat,
            ],
            'dataset_version' => $boundary->dataset_version,
            'source' => $boundary->source,
            'source_url' => $boundary->source_url,
            'license' => $boundary->license,
            'source_name' => $boundary->source_name,
            'is_verified' => $boundary->is_verified,
            'validation_status' => $boundary->validation_status,
            'validation_errors' => $boundary->validation_errors ?? [],
        ], 'Verified boundary retrieved.');
    }

    private function findMasterRecord(string $type, string $geo): mixed
    {
        $query = self::MODELS[$type]::query();

        if (ctype_digit($geo)) {
            return $query->where('uuid', $geo)->orWhere('id', (int) $geo)->first();
        }

        return $query->where('uuid', $geo)->first();
    }
}
