<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

class StoreDeliveryCoverageRuleRequest extends DeliveryCoverageRuleRequest
{
    public function rules(): array
    {
        return $this->baseRules(true);
    }
}
