<?php

namespace App\Modules\Platform\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Models\BaseModel;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\SoftDeletes;

class CustomCoveragePolygon extends BaseModel
{
    use SoftDeletes;

    public const STATUS_PENDING = 'pending';
    public const STATUS_VERIFIED = 'verified';
    public const STATUS_REJECTED = 'rejected';

    public const STATUSES = [self::STATUS_PENDING, self::STATUS_VERIFIED, self::STATUS_REJECTED];

    protected $fillable = [
        'name',
        'description',
        'reason',
        'is_coverage_area',
        'province_id',
        'district_id',
        'municipality_id',
        'ward_id',
        'geometry',
        'display_geometry',
        'bbox_min_lng',
        'bbox_min_lat',
        'bbox_max_lng',
        'bbox_max_lat',
        'source',
        'source_url',
        'verification_status',
        'verified_at',
        'verified_by',
        'expires_at',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'geometry' => 'array',
            'display_geometry' => 'array',
            'verified_at' => 'datetime',
            'expires_at' => 'datetime',
            'is_active' => 'boolean',
            'is_coverage_area' => 'boolean',
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

    public function verifier()
    {
        return $this->belongsTo(config('auth.providers.users.model'), 'verified_by');
    }

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    public function scopeVerified(Builder $query): Builder
    {
        return $query->where('verification_status', self::STATUS_VERIFIED);
    }

    public function scopeUsable(Builder $query): Builder
    {
        return $query
            ->active()
            ->verified()
            ->where(function (Builder $q) {
                $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
            });
    }

    public function scopeCoverageAreas(Builder $query): Builder
    {
        return $query->where('is_coverage_area', true);
    }

    public function parentLabel(): string
    {
        if ($this->municipality_id) {
            return $this->municipality?->name ?? (string) $this->municipality_id;
        }

        if ($this->district_id) {
            return $this->district?->name ?? (string) $this->district_id;
        }

        return $this->province?->name ?? (string) $this->province_id;
    }
}
