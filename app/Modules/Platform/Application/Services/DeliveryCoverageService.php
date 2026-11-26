<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Application\DataTransferObjects\CoverageAssessment;
use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Infrastructure\Models\CustomCoveragePolygon;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\GeoBoundary;

class DeliveryCoverageService
{
    public function __construct(
        private readonly DeliveryCoverageRuleResolver $resolver,
        private readonly GeoBoundaryService $boundaries,
        private readonly CustomCoveragePolygonService $customPolygons,
    ) {
    }

    /**
     * Single coverage decision used by admin checks, customer addresses, and checkout.
     *
     * Options:
     * - require_coordinates: deny when lat/lng are absent (default false).
     * - require_most_specific_boundary: require a verified polygon at the lowest available geo level (default true).
     */
    public function assess(
        DeliveryLocation $location,
        string $serviceMode = 'standard',
        array $options = []
    ): CoverageAssessment {
        $serviceMode = in_array($serviceMode, ['standard', 'express'], true) ? $serviceMode : 'standard';
        $requireCoordinates = (bool) ($options['require_coordinates'] ?? false);
        $requireMostSpecific = (bool) ($options['require_most_specific_boundary'] ?? true);

        if ($requireCoordinates && ! $location->hasCoordinates()) {
            return new CoverageAssessment(
                false,
                'coordinates_required',
                ['A map location is required before delivery serviceability can be confirmed.']
            );
        }

        $ruleResult = $this->resolver->resolve($location, $serviceMode, null, false);
        $rule = $ruleResult['rule'];

        if ($this->customPolygons->hasAnyCoverageAreas()) {
            return $this->assessCoverageAreas($location, $ruleResult, $rule);
        }

        if (! $ruleResult['serviceable']) {
            return new CoverageAssessment(
                false,
                $this->denialReason($ruleResult['reason']),
                $ruleResult['messages'],
                $this->ruleDescriptor($rule)
            );
        }

        $customPolygon = $this->customPolygons->findContaining($location);
        if ($customPolygon) {
            return new CoverageAssessment(
                true,
                'allowed_custom',
                array_merge($ruleResult['messages'], [
                    "Verified custom polygon: {$customPolygon->name}.",
                ]),
                $this->ruleDescriptor($rule),
                null,
                'custom_polygon',
                $this->customPolygonDescriptor($customPolygon)
            );
        }

        if ($requireMostSpecific) {
            $target = $location->boundaryTarget();
            if (! $target) {
                return new CoverageAssessment(
                    false,
                    'boundary_missing',
                    ['The location has no geographic unit to verify.'],
                    $this->ruleDescriptor($rule)
                );
            }

            $mostSpecific = $this->boundaries->findBoundary($target['type'], $target['id']);
            if (! $mostSpecific) {
                return new CoverageAssessment(
                    false,
                    'boundary_missing',
                    ['No verified boundary is available for the most specific geographic unit.'],
                    $this->ruleDescriptor($rule)
                );
            }

            if ($location->hasCoordinates()
                && ! $this->boundaries->containsPoint($mostSpecific->geometry, $location->lng, $location->lat)) {
                return new CoverageAssessment(
                    false,
                    'outside_boundary',
                    ['The coordinates are outside the verified boundary for the most specific geographic unit.'],
                    $this->ruleDescriptor($rule),
                    $this->boundaryDescriptor($mostSpecific, $target['type']),
                    $target['type']
                );
            }
        }

        [$boundary, $boundaryType] = $this->bestAdministrativeBoundary($location);
        if (! $boundary) {
            return new CoverageAssessment(
                false,
                'boundary_missing',
                ['No verified administrative boundary is available for this location.'],
                $this->ruleDescriptor($rule)
            );
        }

        if ($location->hasCoordinates()
            && ! $this->boundaries->containsPoint($boundary->geometry, $location->lng, $location->lat)) {
            return new CoverageAssessment(
                false,
                'outside_boundary',
                ['The coordinates are outside the verified administrative boundary.'],
                $this->ruleDescriptor($rule),
                $this->boundaryDescriptor($boundary, $boundaryType),
                $boundaryType
            );
        }

        return new CoverageAssessment(
            true,
            'allowed_administrative',
            ['Delivery is covered by a verified administrative boundary and an active allow rule.'],
            $this->ruleDescriptor($rule),
            $this->boundaryDescriptor($boundary, $boundaryType),
            $boundaryType
        );
    }

    public function validateAddress(array $address, string $serviceMode = 'standard'): CoverageAssessment
    {
        return $this->assess(
            DeliveryLocation::fromArray($address),
            $serviceMode,
            ['require_coordinates' => true, 'require_most_specific_boundary' => true]
        );
    }

    /**
     * When coverage areas are configured they are the complete allow-list:
     * only a point inside a verified, active area is serviceable. Legacy
     * allow rules are not needed; block rules still take precedence.
     */
    private function assessCoverageAreas(
        DeliveryLocation $location,
        array $ruleResult,
        ?DeliveryCoverageRule $rule
    ): CoverageAssessment {
        if ($ruleResult['reason'] === 'hierarchy_mismatch') {
            return new CoverageAssessment(
                false,
                'hierarchy_mismatch',
                $ruleResult['messages'],
                $this->ruleDescriptor($rule)
            );
        }

        if ($ruleResult['reason'] === 'rule_block') {
            return new CoverageAssessment(
                false,
                'blocked_by_rule',
                $ruleResult['messages'],
                $this->ruleDescriptor($rule)
            );
        }

        if (! $location->hasCoordinates()) {
            return new CoverageAssessment(
                false,
                'coordinates_required',
                ['Select a location on the map to confirm it is inside a configured coverage area.'],
                $this->ruleDescriptor($rule)
            );
        }

        $area = $this->customPolygons->findContaining($location, true);
        if ($area) {
            return new CoverageAssessment(
                true,
                'allowed_coverage_area',
                ["Delivery is available inside the configured coverage area: {$area->name}."],
                $this->ruleDescriptor($rule),
                null,
                'coverage_area',
                $this->customPolygonDescriptor($area)
            );
        }

        return new CoverageAssessment(
            false,
            'outside_coverage_area',
            ['Delivery is only available inside the configured coverage areas.'],
            $this->ruleDescriptor($rule)
        );
    }

    private function bestAdministrativeBoundary(DeliveryLocation $location): array
    {
        $levels = [];

        if ($location->wardId) {
            $levels[] = ['ward', $location->wardId];
        }
        if ($location->municipalityId) {
            $levels[] = ['municipality', $location->municipalityId];
        }
        if ($location->districtId) {
            $levels[] = ['district', $location->districtId];
        }
        if ($location->provinceId > 0) {
            $levels[] = ['province', $location->provinceId];
        }

        foreach ($levels as [$type, $id]) {
            $boundary = $this->boundaries->findBoundary($type, $id);
            if ($boundary) {
                return [$boundary, $type];
            }
        }

        return [null, null];
    }

    private function denialReason(string $reason): string
    {
        return match ($reason) {
            'hierarchy_mismatch' => 'hierarchy_mismatch',
            'rule_block' => 'blocked_by_rule',
            'no_matching_rule' => 'no_matching_rule',
            default => $reason,
        };
    }

    private function ruleDescriptor(?DeliveryCoverageRule $rule): ?array
    {
        if (! $rule) {
            return null;
        }

        return [
            'uuid' => $rule->uuid,
            'name' => $rule->name,
            'scope_type' => $rule->scope_type,
            'decision' => $rule->decision,
            'service_mode' => $rule->service_mode,
            'priority' => $rule->priority,
        ];
    }

    private function boundaryDescriptor(GeoBoundary $boundary, string $type): array
    {
        return [
            'geo_type' => $type,
            'geo_id' => $boundary->geo_id,
            'dataset_version' => $boundary->dataset_version,
            'source' => $boundary->source,
            'is_verified' => $boundary->is_verified,
        ];
    }

    private function customPolygonDescriptor(CustomCoveragePolygon $polygon): array
    {
        return [
            'uuid' => $polygon->uuid,
            'name' => $polygon->name,
            'verification_status' => $polygon->verification_status,
            'geometry_type' => $polygon->geometry['type'] ?? null,
        ];
    }
}
