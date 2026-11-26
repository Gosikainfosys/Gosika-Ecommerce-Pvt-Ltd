<?php

namespace App\Modules\Wallet\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class InitiateAdminAvailableBalancePayoutRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'amount' => ['required', 'numeric', 'gt:0'],
            'bank_account_id' => ['required', 'string', 'max:64'],
            'provider_reference' => ['nullable', 'string', 'max:120'],
            'notes' => ['nullable', 'string', 'max:2000'],
            'proof_files' => ['nullable', 'array', 'max:5'],
            'proof_files.*' => ['file', 'mimes:jpg,jpeg,png,pdf', 'max:5120'],
        ];
    }

    public function withValidator(Validator $validator): void
    {
        $validator->after(function (Validator $validator): void {
            if (! $this->filled('provider_reference') && count((array) $this->file('proof_files', [])) === 0) {
                $validator->errors()->add('proof_files', 'Provide a transfer reference or upload at least one receipt or screenshot.');
            }
        });
    }
}
