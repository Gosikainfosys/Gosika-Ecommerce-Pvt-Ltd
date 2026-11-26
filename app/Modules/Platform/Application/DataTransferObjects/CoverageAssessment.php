<?php

namespace App\Modules\Platform\Application\DataTransferObjects;

final class CoverageAssessment
{
    public function __construct(
        public readonly bool $serviceable,
        public readonly string $reason,
        public readonly array $messages,
        public readonly ?array $rule = null,
        public readonly ?array $boundary = null,
        public readonly ?string $boundaryType = null,
        public readonly ?array $customPolygon = null,
    ) {
    }

    public function status(): string
    {
        return $this->serviceable ? 'serviceable' : 'unserviceable';
    }

    public function toArray(): array
    {
        return [
            'serviceable' => $this->serviceable,
            'status' => $this->status(),
            'reason' => $this->reason,
            'scope' => $this->rule['scope_type'] ?? null,
            'rule' => $this->rule,
            'boundary_type' => $this->boundaryType,
            'boundary' => $this->boundary,
            'custom_polygon' => $this->customPolygon,
            'messages' => $this->messages,
        ];
    }
}
