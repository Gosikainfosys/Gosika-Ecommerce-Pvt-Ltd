<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Infrastructure\Models\District;
use App\Modules\Platform\Infrastructure\Models\Municipality;
use App\Modules\Platform\Infrastructure\Models\Province;
use App\Modules\Platform\Infrastructure\Models\Ward;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class StoreCoverageAreaRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:180'],
            'description' => ['nullable', 'string', 'max:1000'],
            'reason' => ['nullable', 'string', 'max:1000'],
            'province_id' => ['required', 'exists:provinces,id'],
            'district_id' => ['nullable', 'exists:districts,id'],
            'municipality_id' => ['nullable', 'exists:municipalities,id'],
            'ward_id' => ['nullable', 'exists:wards,id'],
            'ward_number' => ['nullable', 'integer', 'between:1,99'],
            'geometry' => ['nullable', 'array'],
            'geometry.type' => ['nullable', 'in:Polygon,MultiPolygon'],
            'geometry.coordinates' => ['nullable', 'array'],
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
            $wardNumber = $this->nullableId('ward_number');
            $isWardArea = $wardId !== null || $wardNumber !== null;

            if ($provinceId && ! Province::whereKey($provinceId)->exists()) {
                $validator->errors()->add('province_id', 'The selected province does not exist.');

                return;
            }

            if ($districtId && ! District::where('id', $districtId)->where('province_id', $provinceId)->exists()) {
                $validator->errors()->add('district_id', 'The selected district does not belong to the selected province.');

                return;
            }

            if ($municipalityId && ! $districtId) {
                $validator->errors()->add('municipality_id', 'A district is required when a municipality is selected.');

                return;
            }

            if ($municipalityId && ! Municipality::where('id', $municipalityId)->where('district_id', $districtId)->exists()) {
                $validator->errors()->add('municipality_id', 'The selected municipality does not belong to the selected district.');

                return;
            }

            if ($wardId !== null && $wardNumber !== null) {
                $validator->errors()->add('ward_number', 'Use either an existing ward or a ward number, not both.');

                return;
            }

            if ($isWardArea && ! $municipalityId) {
                $validator->errors()->add('municipality_id', 'A municipality is required when a ward is selected.');

                return;
            }

            if ($wardId && ! Ward::where('id', $wardId)->where('municipality_id', $municipalityId)->exists()) {
                $validator->errors()->add('ward_id', 'The selected ward does not belong to the selected municipality.');

                return;
            }

            if ($isWardArea) {
                if (! $this->filled('geometry')) {
                    $validator->errors()->add('geometry', 'Draw a ward coverage polygon on the map.');
                }

                if (strlen(trim((string) $this->input('reason'))) < 15) {
                    $validator->errors()->add('reason', 'A documented reason of at least 15 characters is required for a ward area.');
                }
            } elseif ($this->filled('geometry')) {
                $validator->errors()->add('geometry', 'Geometry is derived from the verified administrative boundary; draw only for a ward area.');
            }

            if ($this->filled('geometry')) {
                try {
                    app(CustomCoveragePolygonService::class)->validateGeometry($this->input('geometry'));
                } catch (\Throwable $e) {
                    $validator->errors()->add('geometry', $e->getMessage());
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
