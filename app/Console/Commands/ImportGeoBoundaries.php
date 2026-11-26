<?php

namespace App\Console\Commands;

use App\Modules\Platform\Application\Services\GeoBoundaryImporter;
use Illuminate\Console\Command;

class ImportGeoBoundaries extends Command
{
    protected $signature = 'geo:import-boundaries
        {--level=* : Levels to import: province,district,municipality. Omit to import all available.}
        {--dry-run : Validate and report without writing boundaries.}
        {--allow-incomplete : Commit even when matched units fall below 80% of the expected count.}
        {--manifest= : Path to an alternative boundary manifest JSON file.}';

    protected $description = 'Validate and import verified Nepal administrative boundary geometries into the geo master.';

    public function handle(GeoBoundaryImporter $importer): int
    {
        $validLevels = ['province', 'district', 'municipality', 'ward'];
        $levels = array_values(array_filter((array) $this->option('level')));

        foreach ($levels as $level) {
            if (! in_array($level, $validLevels, true)) {
                $this->error("Unknown level: {$level}");
                return self::FAILURE;
            }
        }

        if (in_array('ward', $levels, true) && count($levels) === 1) {
            $this->warn('No verified ward (ADM4) boundary dataset is published for Nepal. No ward geometry was fabricated.');
            return self::SUCCESS;
        }

        $levels = array_values(array_diff($levels, ['ward']));

        try {
            $result = $importer->import([
                'levels' => $levels === [] ? ['province', 'district', 'municipality'] : $levels,
                'dry_run' => (bool) $this->option('dry-run'),
                'allow_incomplete' => (bool) $this->option('allow-incomplete'),
                'manifest_path' => $this->option('manifest') ?: null,
            ]);
        } catch (\Throwable $exception) {
            $this->error($exception->getMessage());
            return self::FAILURE;
        }

        if ($result['dry_run']) {
            $this->warn('DRY RUN - no boundaries were written.');
        }

        foreach ($result['levels'] as $level => $summary) {
            $this->newLine();
            $this->info(strtoupper($level).' boundary import');
            $this->line("  Features: {$summary['total_features']}");
            $this->line("  Stored: {$summary['stored']} (created {$summary['created']}, updated {$summary['updated']})");
            $this->line("  Matched master units: {$summary['matched_master_units']} / {$summary['expected_units']}");
            $this->line("  Skipped: invalid {$summary['skipped_invalid']}, unmatched {$summary['skipped_unmatched']}, ambiguous {$summary['skipped_ambiguous']}, duplicate {$summary['skipped_duplicate']}");
            $this->line("  Parent geometry warnings: {$summary['parent_geometry_warnings']}");

            foreach ([
                'invalid' => 'Invalid geometry',
                'unmatched' => 'Unmatched',
                'ambiguous' => 'Ambiguous',
                'duplicate' => 'Duplicate',
                'parent_mismatch' => 'Parent geometry mismatch',
            ] as $key => $label) {
                $features = $summary[$key.'_features'] ?? [];
                if ($features === []) {
                    continue;
                }

                $shown = array_slice($features, 0, 10);
                $suffix = count($features) > count($shown) ? ' (showing first 10)' : '';
                $this->warn("  {$label}: ".implode(', ', $shown).$suffix);
            }
        }

        $this->newLine();
        $this->info('Boundary import completed.');

        return self::SUCCESS;
    }
}
