<?php

namespace App\Modules\Platform\Presentation\Http\Requests;

class UpdateCustomCoveragePolygonRequest extends CustomCoveragePolygonRequest
{
    public function rules(): array
    {
        return $this->baseRules(false);
    }
}
