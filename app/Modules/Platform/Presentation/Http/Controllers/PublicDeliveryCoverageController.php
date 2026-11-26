<?php

namespace App\Modules\Platform\Presentation\Http\Controllers;

use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Application\Services\DeliveryLocationResolver;
use App\Modules\Shared\Presentation\Http\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Routing\Controller;

class PublicDeliveryCoverageController extends Controller
{
    public function __construct(
        private readonly DeliveryCoverageService $coverage,
        private readonly DeliveryLocationResolver $locations,
    ) {
    }

    public function check(Request $request): JsonResponse
    {
        $data = $request->validate([
            'province_id' => ['required', 'string'],
            'district_id' => ['nullable', 'string'],
            'municipality_id' => ['nullable', 'string'],
            'ward_id' => ['nullable', 'string'],
            'ward_number' => ['nullable', 'integer', 'between:1,99'],
            'lat' => ['nullable', 'numeric', 'between:-90,90'],
            'lng' => ['nullable', 'numeric', 'between:-180,180'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'service_mode' => ['nullable', 'string', 'in:standard,express'],
        ]);

        $location = $this->locations->resolve($data);

        $assessment = $this->coverage->validateAddress(
            $location->toArray(),
            $data['service_mode'] ?? 'standard'
        );

        return Response::success(
            $assessment->toArray(),
            $assessment->serviceable ? 'Delivery is available for this location.' : 'Delivery is not available for this location.'
        );
    }
}
