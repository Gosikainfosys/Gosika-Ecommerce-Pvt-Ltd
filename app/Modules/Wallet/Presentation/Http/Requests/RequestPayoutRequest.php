<?php

namespace App\Modules\Wallet\Presentation\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

class RequestPayoutRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'settlement_id' => ['nullable', 'string', 'max:36', 'required_without:amount', 'prohibits:amount'],
            'amount' => ['nullable', 'numeric', 'gt:0', 'required_without:settlement_id', 'prohibits:settlement_id'],
            'bank_account_id' => ['nullable', 'string', 'exists:bank_accounts,uuid'],
        ];
    }
}
