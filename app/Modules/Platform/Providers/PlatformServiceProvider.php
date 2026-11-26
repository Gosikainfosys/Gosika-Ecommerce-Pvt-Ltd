<?php

namespace App\Modules\Platform\Providers;

use App\Modules\Platform\Application\Services\CustomCoveragePolygonService;
use App\Modules\Platform\Application\Services\DeliveryCoverageRuleResolver;
use App\Modules\Platform\Application\Services\DeliveryCoverageService;
use App\Modules\Platform\Application\Services\GeoBoundaryImporter;
use App\Modules\Platform\Application\Services\GeoBoundaryService;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;

class PlatformServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->app->singleton(GeoBoundaryService::class);
        $this->app->singleton(GeoBoundaryImporter::class);
        $this->app->singleton(DeliveryCoverageRuleResolver::class);
        $this->app->singleton(CustomCoveragePolygonService::class);
        $this->app->singleton(DeliveryCoverageService::class);
    }

    public function boot(): void
    {
        Route::prefix('api')
            ->middleware('api')
            ->group(__DIR__.'/../Routes/api.php');
    }
}
