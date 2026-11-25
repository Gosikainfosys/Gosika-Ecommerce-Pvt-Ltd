<?php

use App\Http\Controllers\SpaController;
use App\Modules\Payment\Presentation\Http\Controllers\PaymentController;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| Web Routes
|--------------------------------------------------------------------------
|
| All public GET routes serve the React SPA through SpaController, which
| renders a Blade template with server-side SEO meta tags (including
| Google / Bing / Yandex verification tokens) injected into <head>.
| This ensures search-engine crawlers see the tags without executing JS.
|
*/

// ── Payment callbacks (handled server-side first, SPA fallback) ──────────

Route::get('/payments/esewa/callback', function (Request $request) {
    if ($request->has('data') && is_string($request->query('data'))) {
        return app(PaymentController::class)->esewaWebCallback($request);
    }

    if ($request->query('status') === 'failure' && $request->filled('transaction_uuid')) {
        return app(PaymentController::class)->esewaWebFailureCallback($request);
    }

    return app(SpaController::class)();
});

Route::get('/payments/khalti/callback', function (Request $request) {
    if ($request->has('pidx') || $request->has('status')) {
        return app(PaymentController::class)->khaltiWebCallback($request);
    }

    return app(SpaController::class)();
});

// ── Homepage ─────────────────────────────────────────────────────────────
Route::get('/', SpaController::class);

// ── Secure deploy/cache-clear endpoint ───────────────────────────────────
// Hit: GET /deploy-clear?token=<DEPLOY_SECRET>
Route::get('/deploy-clear', function (Request $request) {
    $secret = config('app.deploy_secret', env('DEPLOY_SECRET', ''));
    if ($secret === '' || $request->query('token') !== $secret) {
        abort(403, 'Forbidden');
    }

    \Illuminate\Support\Facades\Artisan::call('route:clear');
    \Illuminate\Support\Facades\Artisan::call('config:clear');
    \Illuminate\Support\Facades\Artisan::call('cache:clear');
    \Illuminate\Support\Facades\Artisan::call('view:clear');

    return response()->json([
        'status' => 'ok',
        'cleared' => ['routes', 'config', 'cache', 'views'],
        'timestamp' => now()->toISOString(),
    ]);
});

// ── SPA fallback for all other public GET requests ───────────────────────
Route::fallback(function (Request $request) {
    if ($request->is('api/*') || $request->is('storage/*') || $request->is('up')) {
        return response()->json(['message' => 'Not Found.'], 404);
    }

    if ($request->isMethod('GET')) {
        return app(SpaController::class)();
    }

    return response()->json(['message' => 'Not Found.'], 404);
});
