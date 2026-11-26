<?php

namespace App\Modules\Platform\Application\Services;

use App\Modules\Platform\Application\DataTransferObjects\DeliveryLocation;
use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Database\Eloquent\Builder;

class DeliveryCoverageRuleResolver
{
    private const SPECIFICITY_ORDER = [
        DeliveryCoverageRule::SCOPE_WARD => 4,
        DeliveryCoverageRule::SCOPE_MUNICIPALITY => 3,
        DeliveryCoverageRule::SCOPE_DISTRICT => 2,
        DeliveryCoverageRule::SCOPE_PROVINCE => 1,
    ];

    public function __construct(private readonly GeoBoundaryService $boundaries)
    {
    }

    /**
     * Resolve the most specific active rule for a hierarchical location.
     *
     * @return array{serviceable: bool, decision: string, reason: string, rule: DeliveryCoverageRule|null, scope: string|null, boundary_type: string|null, messages: array<int, string>}
     */
    public function resolve(
        DeliveryLocation $location,
        string $serviceMode = 'standard',
        mixed $moment = null,
        bool $checkBoundary = true
    ): array {
        if (! $this->hierarchyIsValid($location)) {
            return $this->result(false, 'block', 'hierarchy_mismatch', null, null, null, [
                'The province, district, municipality, and ward do not form a valid parent chain.',
            ]);
        }

        $rule = $this->matchingRules($location, $serviceMode, $moment)->first();

        if (! $rule) {
            return $this->result(false, 'block', 'no_matching_rule', null, null, null, [
                'No active delivery coverage rule applies to this location.',
            ]);
        }

        if ($rule->decision === DeliveryCoverageRule::DECISION_BLOCK) {
            return $this->result(false, 'block', 'rule_block', $rule, $rule->scope_type, null, [
                "Delivery is blocked by rule: {$rule->name}.",
            ]);
        }

        if (! $checkBoundary) {
            return $this->result(true, 'allow', 'rule_allow', $rule, $rule->scope_type, null, [
                "Delivery is allowed by rule: {$rule->name}.",
            ]);
        }

        $target = $this->boundaryTargetForRule($rule, $location);
        if (! $target) {
            return $this->result(false, 'block', 'boundary_missing', $rule, $rule->scope_type, null, [
                'The rule has no geographic unit to verify.',
            ]);
        }

        $boundary = $this->boundaries->findBoundary($target['type'], $target['id']);
        if (! $boundary) {
            return $this->result(false, 'block', 'boundary_missing', $rule, $rule->scope_type, $target['type'], [
                'No verified boundary is available for this location.',
            ]);
        }

        if ($location->hasCoordinates()
            && ! $this->boundaries->containsPoint($boundary->geometry, $location->lng, $location->lat)) {
            return $this->result(false, 'block', 'outside_boundary', $rule, $rule->scope_type, $target['type'], [
                'The coordinates are outside the verified boundary for this location.',
            ]);
        }

        return $this->result(true, 'allow', 'rule_allow', $rule, $rule->scope_type, $target['type'], [
            "Delivery is allowed by rule: {$rule->name}.",
        ]);
    }

    private function matchingRules(
        DeliveryLocation $location,
        string $serviceMode,
        mixed $moment
    ): \Illuminate\Support\Collection {
        $rules = DeliveryCoverageRule::query()
            ->active()
            ->effectiveAt($moment)
            ->forServiceMode($serviceMode)
            ->where(function (Builder $query) use ($location) {
                $query->where(function (Builder $q) use ($location) {
                    $q->where('scope_type', DeliveryCoverageRule::SCOPE_PROVINCE)
                        ->where('province_id', $location->provinceId);
                });

                if ($location->districtId) {
                    $query->orWhere(function (Builder $q) use ($location) {
                        $q->where('scope_type', DeliveryCoverageRule::SCOPE_DISTRICT)
                            ->where('district_id', $location->districtId);
                    });
                }

                if ($location->municipalityId) {
                    $query->orWhere(function (Builder $q) use ($location) {
                        $q->where('scope_type', DeliveryCoverageRule::SCOPE_MUNICIPALITY)
                            ->where('municipality_id', $location->municipalityId);
                    });
                }

                if ($location->wardId) {
                    $query->orWhere(function (Builder $q) use ($location) {
                        $q->where('scope_type', DeliveryCoverageRule::SCOPE_WARD)
                            ->where('ward_id', $location->wardId);
                    });
                }
            })
            ->get();

        return $rules->sort(function (DeliveryCoverageRule $a, DeliveryCoverageRule $b) {
            return [
                self::SPECIFICITY_ORDER[$b->scope_type] ?? 0,
                $b->priority,
                $b->id,
            ] <=> [
                self::SPECIFICITY_ORDER[$a->scope_type] ?? 0,
                $a->priority,
                $a->id,
            ];
        })->values();
    }

    private function boundaryTargetForRule(DeliveryCoverageRule $rule, DeliveryLocation $location): ?array
    {
        return match ($rule->scope_type) {
            DeliveryCoverageRule::SCOPE_WARD => $location->wardId
                ? ['type' => 'ward', 'id' => $location->wardId]
                : null,
            DeliveryCoverageRule::SCOPE_MUNICIPALITY => $location->municipalityId
                ? ['type' => 'municipality', 'id' => $location->municipalityId]
                : null,
            DeliveryCoverageRule::SCOPE_DISTRICT => $location->districtId
                ? ['type' => 'district', 'id' => $location->districtId]
                : null,
            DeliveryCoverageRule::SCOPE_PROVINCE => $location->provinceId > 0
                ? ['type' => 'province', 'id' => $location->provinceId]
                : null,
            default => null,
        };
    }

    private function hierarchyIsValid(DeliveryLocation $location): bool
    {
        if ($location->provinceId <= 0 || ! Province::whereKey($location->provinceId)->exists()) {
            return false;
        }

        if ($location->districtId
            && ! District::where('id', $location->districtId)
                ->where('province_id', $location->provinceId)
                ->exists()) {
            return false;
        }

        if ($location->municipalityId) {
            if (! $location->districtId) {
                return false;
            }

            if (! Municipality::where('id', $location->municipalityId)
                ->where('district_id', $location->districtId)
                ->exists()) {
                return false;
            }
        }

        if ($location->wardId) {
            if (! $location->municipalityId) {
                return false;
            }

            if (! Ward::where('id', $location->wardId)
                ->where('municipality_id', $location->municipalityId)
                ->exists()) {
                return false;
            }
        }

        return true;
    }

    private function result(
        bool $serviceable,
        string $decision,
        string $reason,
        ?DeliveryCoverageRule $rule,
        ?string $scope,
        ?string $boundaryType,
        array $messages
    ): array {
        return [
            'serviceable' => $serviceable,
            'decision' => $decision,
            'reason' => $reason,
            'rule' => $rule,
            'scope' => $scope,
            'boundary_type' => $boundaryType,
            'messages' => $messages,
        ];
    }
}
