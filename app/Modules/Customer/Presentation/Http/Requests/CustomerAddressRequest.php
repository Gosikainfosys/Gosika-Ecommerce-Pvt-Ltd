<?php

namespace App\Modules\Customer\Presentation\Http\Requests;

use App\Modules\Customer\Application\Services\CustomerAddressCoverageValidator;
use App\Modules\Customer\Infrastructure\Models\CustomerAddress;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Validator;

class CustomerAddressRequest extends FormRequest
{
    public function __construct(private readonly CustomerAddressCoverageValidator $coverage)
    {
    }

    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'address_type' => ['required', 'string', Rule::in(['shipping', 'billing'])],
            'label' => ['nullable', 'string', 'max:60'],
            'full_name' => ['nullable', 'string', 'max:180'],
            'phone' => ['required', 'string', 'max:20'],
            'address_line_1' => ['required', 'string', 'max:255'],
            'address_line_2' => ['nullable', 'string', 'max:255'],
            'country_id' => ['nullable', 'string', 'exists:countries,uuid'],
            'province_id' => ['nullable', 'string', 'exists:provinces,uuid'],
            'district_id' => ['nullable', 'string', 'exists:districts,uuid'],
            'municipality_id' => ['nullable', 'string', 'exists:municipalities,uuid'],
            'ward_id' => ['nullable', 'string', 'exists:wards,uuid'],
            'ward_number' => ['nullable', 'integer', 'between:1,99'],
            'postal_code' => ['nullable', 'string', 'max:20'],
            'landmark' => ['nullable', 'string', 'max:255'],
            'latitude' => ['nullable', 'numeric', 'between:-90,90'],
            'longitude' => ['nullable', 'numeric', 'between:-180,180'],
            'is_default' => ['nullable', 'boolean'],
        ];
    }

    protected function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator) {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            $existing = $this->route('address');
            $assessment = $this->coverage->validate(
                $this->all(),
                $existing instanceof CustomerAddress ? $existing : null
            );

            if ($assessment->serviceable) {
                return;
            }

            $messages = array_values(array_filter($assessment->messages));
            $validator->errors()->add(
                'location',
                $messages ? implode(' ', $messages) : 'Delivery is not available for this location.'
            );
            $validator->errors()->add('coverage_reason', $assessment->reason);
        });
    }
}
