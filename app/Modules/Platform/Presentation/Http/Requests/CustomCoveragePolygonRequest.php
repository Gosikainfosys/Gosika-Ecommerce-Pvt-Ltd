<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

abstract class CustomCoveragePolygonRequest extends FormRequest
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
            'reason' => [$prefix, 'string', 'min:15', 'max:1000'],
            'province_id' => [$prefix, 'exists:provinces,id'],
            'district_id' => ['nullable', 'exists:districts,id'],
            'municipality_id' => ['nullable', 'exists:municipalities,id'],
            'ward_id' => ['nullable', 'exists:wards,id'],
            'geometry' => [$prefix, 'array'],
            'geometry.type' => [$prefix, 'in:Polygon,MultiPolygon'],
            'geometry.coordinates' => [$prefix, 'array'],
            'display_geometry' => ['nullable', 'array'],
            'display_geometry.type' => ['nullable', 'in:Polygon,MultiPolygon'],
            'display_geometry.coordinates' => ['nullable', 'array'],
            'source' => ['nullable', 'string', 'max:180'],
            'source_url' => ['nullable', 'url', 'max:500'],
            'expires_at' => ['nullable', 'date'],
            'is_active' => ['nullable', 'boolean'],
        ];
    }

    protected function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            $provinceId = $this->nullableId('province_id');
            $districtId = $this->nullableId('district_id');
            $municipalityId = $this->nullableId('municipality_id');
            $wardId = $this->nullableId('ward_id');

            if ($municipalityId && ! $districtId) {
                $validator->errors()->add('municipality_id', 'A district is required when a municipality is selected.');
            }

            if ($wardId && ! $municipalityId) {
                $validator->errors()->add('ward_id', 'A municipality is required when a ward is selected.');
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

                return;
            }

            $service = app(CustomCoveragePolygonService::class);

            if ($this->filled('geometry')) {
                try {
                    $service->validateGeometry($this->input('geometry'));
                } catch (\Throwable $e) {
                    $validator->errors()->add('geometry', $e->getMessage());
                }
            }

            if ($this->filled('display_geometry')) {
                try {
                    $service->validateGeometry($this->input('display_geometry'));
                } catch (\Throwable $e) {
                    $validator->errors()->add('display_geometry', $e->getMessage());
                }
            }
        });
    }

    private function nullableId(string $key): ?int
    {
        $value = $this->input($key);

        return $value === null || $value === '' ? null : (int) $value;
    }
}
