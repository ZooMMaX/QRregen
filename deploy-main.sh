#!/bin/bash

set -e

CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)

if [ "$CURRENT_BRANCH" != "main" ]; then
    echo "❌ Ошибка: скрипт deploy-main.sh можно запускать только с ветки 'main'"
    echo "   Текущая ветка: $CURRENT_BRANCH"
    echo "   Переключись: git checkout main"
    exit 1
fi

echo "🚀 Deploying to MAIN site (ветка: $CURRENT_BRANCH)..."

echo "📦 Building..."
npx vite build --base=/ --outDir dist-root

echo "📁 Deploying to /var/www/zoommax.space/..."
sudo rm -rf /var/www/zoommax.space
sudo mkdir -p /var/www/zoommax.space
sudo cp -r dist-root/. /var/www/zoommax.space
sudo chmod -R a+rX /var/www/zoommax.space

echo "🔄 Reloading nginx..."
sudo nginx -s reload

echo "✅ Done!"
echo "🌐 Main site: https://zoommax.space/"
