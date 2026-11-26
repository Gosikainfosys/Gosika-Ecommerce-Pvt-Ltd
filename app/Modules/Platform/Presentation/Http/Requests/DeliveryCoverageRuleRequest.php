<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

use App\Modules\Platform\Infrastructure\Models\DeliveryCoverageRule;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

abstract class DeliveryCoverageRuleRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function baseRules(bool $creating): array
    {
        $prefix = $creating ? 'required' : 'sometimes|required';

        return [
            'name' => [$prefix, 'string', 'max:180'],
            'description' => ['nullable', 'string', 'max:1000'],
            'scope_type' => [$prefix, 'in:'.implode(',', DeliveryCoverageRule::SCOPES)],
            'province_id' => [$prefix, 'exists:provinces,id'],
            'district_id' => [
                $creating ? 'nullable' : 'sometimes',
                'required_if:scope_type,district,municipality,ward',
                'exists:districts,id',
            ],
            'municipality_id' => [
                $creating ? 'nullable' : 'sometimes',
                'required_if:scope_type,municipality,ward',
                'exists:municipalities,id',
            ],
            'ward_id' => [
                $creating ? 'nullable' : 'sometimes',
                'nullable',
                'exists:wards,id',
            ],
            'ward_number' => ['nullable', 'integer', 'between:1,99'],
            'decision' => [$prefix, 'in:'.implode(',', DeliveryCoverageRule::DECISIONS)],
            'service_mode' => [$prefix, 'in:'.implode(',', DeliveryCoverageRule::SERVICE_MODES)],
            'priority' => ['nullable', 'integer', 'min:0', 'max:999'],
            'effective_from' => ['nullable', 'date'],
            'effective_to' => ['nullable', 'date', 'after_or_equal:effective_from'],
            'is_active' => ['nullable', 'boolean'],
        ];
    }

    protected function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $scope = $this->input('scope_type');
            $provinceId = $this->nullableId('province_id');
            $districtId = $this->nullableId('district_id');
            $municipalityId = $this->nullableId('municipality_id');
            $wardId = $this->nullableId('ward_id');

            if (! in_array($scope, DeliveryCoverageRule::SCOPES, true)) {
                return;
            }

            if ($scope === DeliveryCoverageRule::SCOPE_PROVINCE
                && ($districtId || $municipalityId || $wardId)) {
                $validator->errors()->add('scope_type', 'A province rule cannot target a child unit.');

                return;
            }

            if ($scope === DeliveryCoverageRule::SCOPE_DISTRICT && ($municipalityId || $wardId)) {
                $validator->errors()->add('scope_type', 'A district rule cannot target a child unit.');

                return;
            }

            if ($scope === DeliveryCoverageRule::SCOPE_MUNICIPALITY && ($wardId || $this->filled('ward_number'))) {
                $validator->errors()->add('scope_type', 'A municipality rule cannot target a child ward.');

                return;
            }

            if ($scope === DeliveryCoverageRule::SCOPE_WARD && ! $wardId && ! $this->filled('ward_number')) {
                $validator->errors()->add('ward_number', 'Select an existing ward or enter a ward number.');
            }

            if ($scope === DeliveryCoverageRule::SCOPE_WARD && $wardId && $this->filled('ward_number')) {
                $validator->errors()->add('ward_number', 'Provide either a ward or a ward number, not both.');
            }

            if ($scope && $scope !== DeliveryCoverageRule::SCOPE_WARD && $this->filled('ward_number')) {
                $validator->errors()->add('ward_number', 'A ward number is only used for ward rules.');
            }

            if ($provinceId && ! Province::whereKey($provinceId)->exists()) {
                $validator->errors()->add('province_id', 'The selected province does not exist.');

                return;
            }

            if ($districtId && ! District::where('id', $districtId)->where('province_id', $provinceId)->exists()) {
                $validator->errors()->add('district_id', 'The selected district does not belong to the selected province.');

                return;
            }

            if ($municipalityId && ! Municipality::where('id', $municipalityId)->where('district_id', $districtId)->exists()) {
                $validator->errors()->add('municipality_id', 'The selected municipality does not belong to the selected district.');

                return;
            }

            if ($wardId && ! Ward::where('id', $wardId)->where('municipality_id', $municipalityId)->exists()) {
                $validator->errors()->add('ward_id', 'The selected ward does not belong to the selected municipality.');
            }
        });
    }

    private function nullableId(string $key): ?int
    {
        $value = $this->input($key);

        return $value === null || $value === '' ? null : (int) $value;
    }
}
