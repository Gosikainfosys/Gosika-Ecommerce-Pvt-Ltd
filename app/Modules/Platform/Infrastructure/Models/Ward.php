<?php

namespace App\Modules\Platform\Infrastructure\Models;

use App\Modules\Shared\Infrastructure\Traits\HasUuid;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Ward extends Model
{
    use HasUuid;

    protected $fillable = [
        'municipality_id',
        'ward_number',
        'name',
        'code',
        'is_active',
    ];

    protected function casts(): array
    {
        return [
            'ward_number' => 'integer',
            'is_active' => 'boolean',
        ];
    }

    public function municipality(): BelongsTo
    {
        return $this->belongsTo(Municipality::class);
    }

    public function getLabelAttribute(): string
    {
        $name = trim((string) ($this->name ?? ''));

        return $name !== ''
            ? "Ward {$this->ward_number} — {$name}"
            : "Ward {$this->ward_number}";
    }
}
