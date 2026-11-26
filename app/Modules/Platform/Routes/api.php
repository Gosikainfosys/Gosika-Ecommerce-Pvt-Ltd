<?php

use App\Modules\Platform\Presentation\Http\Controllers\AdminCoverageAreaController;
use App\Modules\Platform\Presentation\Http\Controllers\AdminCustomCoveragePolygonController;
use App\Modules\Platform\Presentation\Http\Controllers\AdminDeliveryCoverageRuleController;
use App\Modules\Platform\Presentation\Http\Controllers\AdminGeoBoundaryController;
use App\Modules\Platform\Presentation\Http\Controllers\AdminLogsController;
use App\Modules\Platform\Presentation\Http\Controllers\AdminSettingsController;
use App\Modules\Platform\Presentation\Http\Controllers\GeoController;
use App\Modules\Platform\Presentation\Http\Controllers\PlatformConfigController;
use App\Modules\Platform\Presentation\Http\Controllers\PublicDeliveryCoverageController;
use App\Modules\Platform\Presentation\Http\Controllers\SettingsController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/platform')->group(function () {
    Route::get('config', [PlatformConfigController::class, 'publicConfig'])->middleware('throttle:public');
    Route::get('social-providers', [PlatformConfigController::class, 'socialProviders'])->middleware('throttle:public');
    Route::get('countries', [GeoController::class, 'countries'])->middleware('throttle:public');
    Route::get('provinces', [GeoController::class, 'provinces'])->middleware('throttle:public');
    Route::get('districts', [GeoController::class, 'districts'])->middleware('throttle:public');
    Route::get('municipalities', [GeoController::class, 'municipalities'])->middleware('throttle:public');
    Route::get('wards', [GeoController::class, 'wards'])->middleware('throttle:public');
    Route::get('reverse-geocode', [GeoController::class, 'reverseGeocode'])->middleware('throttle:public');
    Route::match(['get', 'post'], 'delivery-coverage/check', [PublicDeliveryCoverageController::class, 'check'])
        ->middleware('throttle:public');
});

Route::post('v1/upload/image', [\App\Modules\Platform\Presentation\Http\Controllers\ImageUploadController::class, 'upload'])
    ->middleware(['auth:sanctum']);

Route::prefix('v1/admin/settings')->middleware(['auth:sanctum', 'ensure:admin', 'throttle:admin'])->group(function () {
    // Modular Domain Endpoints
    Route::get('general', [AdminSettingsController::class, 'getGeneral']);
    Route::put('general', [AdminSettingsController::class, 'updateGeneral']);

    Route::get('branding', [AdminSettingsController::class, 'getBranding']);
    Route::post('branding', [AdminSettingsController::class, 'updateBranding']);
    Route::put('branding', [AdminSettingsController::class, 'updateBranding']);

    Route::get('commissions', [AdminSettingsController::class, 'getCommissions']);
    Route::put('commissions', [AdminSettingsController::class, 'updateCommissions']);

    Route::get('shipping', [AdminSettingsController::class, 'getShipping']);
    Route::put('shipping', [AdminSettingsController::class, 'updateShipping']);

    Route::get('payments', [AdminSettingsController::class, 'getPayments']);
    Route::put('payments', [AdminSettingsController::class, 'updatePayments']);

    Route::get('vendors', [AdminSettingsController::class, 'getVendors']);
    Route::put('vendors', [AdminSettingsController::class, 'updateVendors']);

    Route::get('orders', [AdminSettingsController::class, 'getOrders']);
    Route::put('orders', [AdminSettingsController::class, 'updateOrders']);

    // Legacy Fallback Endpoints (Fully Preserved)
    Route::get('/', [SettingsController::class, 'index']);
    Route::put('/', [SettingsController::class, 'batchUpdate']);
    Route::put('{key}', [SettingsController::class, 'update']);
    Route::delete('{key}', [SettingsController::class, 'destroy']);
});

Route::prefix('v1/admin')->middleware(['auth:sanctum', 'ensure:admin', 'throttle:admin'])->group(function () {
    Route::get('logs', [AdminLogsController::class, 'index']);
    Route::get('logs/view', [AdminLogsController::class, 'show']);

    Route::prefix('geo')->middleware('permission:deliveries.manage')->group(function () {
        Route::get('boundaries/{type}/{geo}', [AdminGeoBoundaryController::class, 'show'])
            ->where('type', 'province|district|municipality|ward');
    });

    Route::prefix('delivery-coverage')->middleware('permission:deliveries.manage')->group(function () {
        Route::get('areas', [AdminCoverageAreaController::class, 'index']);
        Route::post('areas', [AdminCoverageAreaController::class, 'store']);
        Route::delete('areas/{areaId}', [AdminCoverageAreaController::class, 'destroy']);

        Route::get('rules', [AdminDeliveryCoverageRuleController::class, 'index']);
        Route::post('rules', [AdminDeliveryCoverageRuleController::class, 'store']);
        Route::get('rules/evaluate', [AdminDeliveryCoverageRuleController::class, 'evaluate']);
        Route::get('rules/{ruleId}', [AdminDeliveryCoverageRuleController::class, 'show']);
        Route::put('rules/{ruleId}', [AdminDeliveryCoverageRuleController::class, 'update']);
        Route::delete('rules/{ruleId}', [AdminDeliveryCoverageRuleController::class, 'destroy']);

        Route::get('custom-polygons', [AdminCustomCoveragePolygonController::class, 'index']);
        Route::post('custom-polygons', [AdminCustomCoveragePolygonController::class, 'store']);
        Route::get('custom-polygons/{polygonId}', [AdminCustomCoveragePolygonController::class, 'show']);
        Route::put('custom-polygons/{polygonId}', [AdminCustomCoveragePolygonController::class, 'update']);
        Route::delete('custom-polygons/{polygonId}', [AdminCustomCoveragePolygonController::class, 'destroy']);
        Route::post('custom-polygons/{polygonId}/verify', [AdminCustomCoveragePolygonController::class, 'verify']);
        Route::post('custom-polygons/{polygonId}/reject', [AdminCustomCoveragePolygonController::class, 'reject']);
    });
});
