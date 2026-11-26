<?php

namespace App\Modules\Platform\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Models\BaseModel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;

class DeliveryCoverageRule extends BaseModel
{
    use SoftDeletes;

    public const SCOPE_PROVINCE = 'province';
    public const SCOPE_DISTRICT = 'district';
    public const SCOPE_MUNICIPALITY = 'municipality';
    public const SCOPE_WARD = 'ward';

    public const SCOPES = [
        self::SCOPE_PROVINCE,
        self::SCOPE_DISTRICT,
        self::SCOPE_MUNICIPALITY,
        self::SCOPE_WARD,
    ];

    public const DECISION_ALLOW = 'allow';
    public const DECISION_BLOCK = 'block';

    public const DECISIONS = [self::DECISION_ALLOW, self::DECISION_BLOCK];

    public const SERVICE_MODES = ['all', 'standard', 'express'];

    protected $fillable = [
        'name',
        'description',
        'scope_type',
        'province_id',
        'district_id',
        'municipality_id',
        'ward_id',
        'decision',
        'service_mode',
        'priority',
        'effective_from',
        'effective_to',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'priority' => 'integer',
            'effective_from' => 'datetime',
            'effective_to' => 'datetime',
            'is_active' => 'boolean',
        ];
    }

    public function province()
    {
        return $this->belongsTo(Province::class);
    }

    public function district()
    {
        return $this->belongsTo(District::class);
    }

    public function municipality()
    {
        return $this->belongsTo(Municipality::class);
    }

    public function ward()
    {
        return $this->belongsTo(Ward::class);
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    public function scopeEffectiveAt(Builder $query, mixed $moment = null): Builder
    {
        $moment = $moment ?? now();

        return $query
            ->where(function (Builder $q) use ($moment) {
                $q->whereNull('effective_from')->orWhere('effective_from', '<=', $moment);
            })
            ->where(function (Builder $q) use ($moment) {
                $q->whereNull('effective_to')->orWhere('effective_to', '>=', $moment);
            });
    }

    public function scopeForServiceMode(Builder $query, string $mode): Builder
    {
        return $query->whereIn('service_mode', ['all', $mode]);
    }

    public function specificity(): int
    {
        return match ($this->scope_type) {
            self::SCOPE_WARD => 4,
            self::SCOPE_MUNICIPALITY => 3,
            self::SCOPE_DISTRICT => 2,
            self::SCOPE_PROVINCE => 1,
            default => 0,
        };
    }

    public function scopeLabel(): string
    {
        return match ($this->scope_type) {
            self::SCOPE_WARD => $this->ward?->label ?? 'Ward #'.$this->ward_id,
            self::SCOPE_MUNICIPALITY => $this->municipality?->name ?? (string) $this->municipality_id,
            self::SCOPE_DISTRICT => $this->district?->name ?? (string) $this->district_id,
            self::SCOPE_PROVINCE => $this->province?->name ?? (string) $this->province_id,
            default => 'Unknown scope',
        };
    }
}
