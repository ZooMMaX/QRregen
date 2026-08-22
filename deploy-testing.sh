#!/bin/bash

set -e

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$CURRENT_BRANCH" != "testing" ]; then
    echo "❌ Ошибка: скрипт deploy-testing.sh можно запускать только с ветки 'testing'"
    echo "   Текущая ветка: $CURRENT_BRANCH"
    echo "   Переключись: git checkout testing"
    exit 1
fi

echo "🚀 Deploying to TESTING site (ветка: $CURRENT_BRANCH)..."

echo "📦 Building..."
npx vite build --base=/testing/ --outDir dist-testing

echo "📁 Deploying to /var/www/zoommax.space/testing/..."
sudo rm -rf /var/www/zoommax.space/testing
sudo mkdir -p /var/www/zoommax.space/testing
sudo cp -r dist-testing/. /var/www/zoommax.space/testing
sudo chmod -R a+rX /var/www/zoommax.space/testing

echo "🔄 Reloading nginx..."
sudo nginx -s reload

echo "✅ Done!"
echo "🌐 Testing site: https://zoommax.space/testing/"
