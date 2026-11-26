<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

class UpdateDeliveryCoverageRuleRequest extends DeliveryCoverageRuleRequest
{
    public function rules(): array
    {
        return $this->baseRules(false);
    }
}
