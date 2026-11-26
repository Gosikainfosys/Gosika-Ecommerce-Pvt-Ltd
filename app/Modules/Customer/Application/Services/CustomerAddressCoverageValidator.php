<?php

namespace App\Modules\Customer\Application\Services;

use App\Modules\Customer\Infrastructure\Models\CustomerAddress;
use App\Modules\Platform\Application\DataTransferObjects\CoverageAssessment;
use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Application\Services\DeliveryLocationResolver;

class CustomerAddressCoverageValidator
{
    public function __construct(
        private readonly DeliveryCoverageService $coverage,
        private readonly DeliveryLocationResolver $locations,
    ) {
    }

    /**
     * Strictly validate a shipping address through the central coverage engine.
     * Billing-only addresses do not affect delivery and are not checked.
     */
    public function validate(array $data, ?CustomerAddress $address = null): CoverageAssessment
    {
        $type = array_key_exists('address_type', $data)
            ? $data['address_type']
            : $address?->address_type;

        if ($type !== 'shipping') {
            return new CoverageAssessment(true, 'not_applicable', []);
        }

        $location = $this->locations->resolve($data, $address ? [
            'province_id' => $address->province_id,
            'district_id' => $address->district_id,
            'municipality_id' => $address->municipality_id,
            'ward_id' => $address->ward_id,
            'latitude' => $address->latitude,
            'longitude' => $address->longitude,
        ] : []);

        return $this->coverage->validateAddress($location->toArray(), 'standard');
    }
}
