# Деплой QR-Реставратора на GitHub Pages

Проект — статический SPA (Vite + React), для публикации достаточно собранной папки `dist`.
В репозиторий уже добавлены:

- `.github/workflows/deploy.yml` — автосборка и публикация при каждом пуше в `main`;
- `public/.nojekyll` — чтобы GitHub Pages не трогал файлы Jekyll-ом;
- сборка в workflow идёт с флагом `--base=./`, поэтому ассеты подхватываются
  по любому базовому пути (`https://<username>.github.io/<repo>/`).

---

## Вариант A — через GitHub Actions (рекомендуется)

1. **Создайте репозиторий** на github.com (например, `qr-restorer`), пустой, без README.

2. **Запушьте код:**

   ```bash
   git init
   git add .
   git commit -m "QR-Реставратор"
   git branch -M main
   git remote add origin https://github.com/<username>/qr-restorer.git
   git push -u origin main
   ```

3. **Включите Pages на Actions:**
   репозиторий → **Settings → Pages** → **Build and deployment → Source** →
   выбрать **GitHub Actions**.

4. Дождитесь зелёной галочки во вкладке **Actions** (первый прогон ~1–2 минуты).
   Сайт появится по адресу:

   ```
   https://<username>.github.io/qr-restorer/
   ```

Каждый следующий `git push` в `main` автоматически пересобирает и обновляет сайт.

---

## Вариант B — вручную через ветку `gh-pages`

Если Actions по какой-то причине недоступны:

```bash
# разовая установка
npm install -D gh-pages

# сборка с относительной базой и публикация
npx vite build --base=./
npx gh-pages -d dist
```

Затем в репозитории: **Settings → Pages → Source: Deploy from a branch**,
ветка **gh-pages**, папка **/ (root)** → Save. Через минуту сайт будет доступен
по тому же адресу `https://<username>.github.io/qr-restorer/`.

Для удобства можно запускать одной командой:

```bash
npx vite build --base=./ && npx gh-pages -d dist
```

---

## Частые проблемы

| Симптом | Причина и решение |
| --- | --- |
| Белая страница, в консоли 404 на `assets/*.js` | Сборка без `--base=./`. Пересоберите с флагом (в workflow он уже есть). |
| 404 сразу после пуша | Pages ещё публикуется — обновите страницу через минуту; статус виден в Settings → Pages. |
| Репозиторий приватный | Для приватных репо Pages нужен план Pro/Team; либо сделайте репозиторий публичным. |
| `npm ci` падает в Actions | Убедитесь, что `package-lock.json` закоммичен. |
| Изменения не появляются | Кэш браузера — откройте в режиме инкогнито или сделайте hard reload (Ctrl+Shift+R). |

## Свой домен (опционально)

Settings → Pages → **Custom domain** → укажите домен и добавьте CNAME-запись
у регистратора, указывающую на `username.github.io`. Для поддомена достаточно CNAME,
для апекс-домена — A-записи на IP GitHub (185.199.108–111.153).
