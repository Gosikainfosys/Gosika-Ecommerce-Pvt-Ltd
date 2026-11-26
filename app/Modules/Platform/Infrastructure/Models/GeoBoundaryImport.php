<?php

namespace App\Modules\Platform\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Traits\HasUuid;
use Illuminate\Database\Eloquent\Model;

class GeoBoundaryImport extends Model
{
    use HasUuid;

    protected $table = 'geo_boundary_imports';

    protected $fillable = [
        'provider',
        'dataset_version',
        'level',
        'source',
        'source_url',
        'license',
        'file',
        'checksum',
        'status',
        'summary',
        'error',
        'imported_at',
    ];

    protected function casts(): array
    {
        return [
            'summary' => 'array',
            'imported_at' => 'datetime',
        ];
    }
}
