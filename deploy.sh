#!/bin/bash
# Run this on the production server after git pull
set -e

echo "==> Installing frontend dependencies..."
npm --prefix frontend ci

echo "==> Building frontend assets..."
npm --prefix frontend run build

echo "==> Clearing Laravel caches..."
php artisan route:clear
php artisan config:clear
php artisan cache:clear
php artisan view:clear

echo "==> Optimizing for production..."
php artisan route:cache
php artisan config:cache

echo "==> Done."
