<?php

namespace App\Modules\Platform\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Traits\HasUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class GeoBoundary extends Model
{
    use HasUuid;
    use SoftDeletes;

    protected $table = 'geo_boundaries';

    protected $fillable = [
        'geo_type',
        'geo_id',
        'province_id',
        'district_id',
        'municipality_id',
        'ward_id',
        'import_id',
        'source_feature_id',
        'source_name',
        'geometry',
        'display_geometry',
        'bbox_min_lng',
        'bbox_min_lat',
        'bbox_max_lng',
        'bbox_max_lat',
        'dataset_version',
        'source',
        'source_url',
        'license',
        'is_verified',
        'validation_status',
        'validation_errors',
        'is_active',
        'imported_at',
    ];

    protected function casts(): array
    {
        return [
            'geometry' => 'array',
            'display_geometry' => 'array',
            'bbox_min_lng' => 'float',
            'bbox_min_lat' => 'float',
            'bbox_max_lng' => 'float',
            'bbox_max_lat' => 'float',
            'is_verified' => 'boolean',
            'validation_errors' => 'array',
            'is_active' => 'boolean',
            'imported_at' => 'datetime',
        ];
    }

    public function province(): BelongsTo
    {
        return $this->belongsTo(Province::class);
    }

    public function district(): BelongsTo
    {
        return $this->belongsTo(District::class);
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }

    public function ward(): BelongsTo
    {
        return $this->belongsTo(Ward::class);
    }

    public function import(): BelongsTo
    {
        return $this->belongsTo(GeoBoundaryImport::class, 'import_id');
    }

    public function scopeActive($query)
    {
        return $query->where('is_active', true);
    }

    public function scopeVerified($query)
    {
        return $query->where('is_verified', true)
            ->where('validation_status', 'valid');
    }

    public function scopeForGeo($query, string $type, int $id)
    {
        return $query->where('geo_type', $type)->where('geo_id', $id);
    }
}
