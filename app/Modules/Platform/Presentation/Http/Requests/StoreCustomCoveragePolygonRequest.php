<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

class StoreCustomCoveragePolygonRequest extends CustomCoveragePolygonRequest
{
    public function rules(): array
    {
        return $this->baseRules(true);
    }
}
