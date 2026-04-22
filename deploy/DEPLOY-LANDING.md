# Деплой фронта (лендинг + приложение) на сервер

В этом репозитории **один** фронтенд-сборщик (`frontend/`): после `npm run build` в `frontend/dist` попадает **весь** SPA — лендинг на `/`, кабинеты, `/entry`, API через `/api` в dev через прокси Vite.

## Вариант A — тот же домен, тот же продукт (рекомендуется)

Если **truckdriver.online** должен отдавать именно этот проект (как в `deploy/nginx-taxi.conf`):

1. На машине с кодом:
   ```bash
   cd frontend
   npm ci
   npm run build
   ```
2. На сервер залить **содержимое** `frontend/dist` в каталог, который указан в nginx как `root` (в примере это `/root/dist`).

   **Важно:** `scp` / `cd` к папке `C:\Users\...` делаются **на своём компьютере (Windows)**, в **новом** окне PowerShell или CMD — **не** внутри SSH, где приглашение `root@VM-342508:~#`. На сервере нет твоего `dist` и нет диска `C:`.

3. **На Windows (выйди из SSH или открой второе окно терминала):** после `npm run build` выполни из каталога `frontend` проекта:
   ```powershell
   cd "C:\Users\Данил\Downloads\Yandex.Disk.Files\грузовые ЭПЛ (2)\frontend"
   scp -r -o StrictHostKeyChecking=accept-new .\dist\* root@212.119.42.239:/root/dist/
   ```
   На запрос пароля вводишь пароль **root** сервера.

   Либо **rsync** из Git Bash / WSL (из папки `frontend`, подставь хост и путь к `root` nginx):
   ```bash
   rsync -avz --delete ./dist/ root@212.119.42.239:/root/dist/
   ```
4. Проверить nginx и перезагрузить:
   ```bash
   sudo nginx -t && sudo systemctl reload nginx
   ```

Важно: **не заливай** папку `dist` целиком как один файл — нужны файлы внутри (`index.html`, `assets/`, …).

### Частые ошибки (у тебя уже было)

| Где ты | Команда | Почему не работает |
|--------|---------|-------------------|
| `root@VM-342508:~#` (SSH на Linux) | `cd C:\Users\...` | На Linux **нет** диска `C:` и твоего проекта. |
| То же, SSH | `npm run build` в `/root` | В `/root` **нет** `package.json` — сборка только из папки **`frontend`** репозитория. |
| То же, SSH | `scp .\dist\*` | Синтаксис **Windows**; на сервере используй **`dist/*`** и путь к реальному каталогу. |
| То же, SSH | `rsync ./dist/ root@212.119.42.239:/root/dist/` | Если `./dist` = `/root/dist`, ты копируешь **сам на себя** — в логе будет `sent ~1–2 KB`, сайт **не обновится**. Новый билд должен прийти **с твоего ПК** или из **свежего клона репозитория на сервере**. |

**Проверка, обновился ли сайт:** на сервере после выкладки:

```bash
stat /root/dist/index.html
```

Смотри строку **`Modify:`** — дата должна стать **сегодняшней** (как время заливки). Если там старый день (например, 18 апреля) — новый `dist` ещё не залит.

## Вариант A2 — собрать прямо на сервере (без scp с Windows)

Если репозиторий в **git** (GitHub/GitLab) и на VPS поставлен **Node 18+**:

```bash
cd /opt   # или /var/www
git clone <URL_репозитория> freight-epl && cd freight-epl/frontend
npm ci
npm run build
rsync -av --delete dist/ /root/dist/
sudo nginx -t && sudo systemctl reload nginx
```

Перед первым `npm ci` можно положить `frontend/.env.production` с `VITE_API_URL` и т.д.

Если репозитория нет в сети — заархивируй на Windows папку **`frontend`** (или весь проект), залей **`scp`** архив на сервер в `/tmp`, `unzip`, дальше `cd .../frontend && npm ci && npm run build` и копирование в `/root/dist`.

## Вариант B — лендинг на поддомене (если кабинет — отдельный билд)

Когда на `truckdriver.online` уже крутится **другой** фронт и менять корень нельзя:

1. Поддомен в DNS, например `www.truckdriver.online` или `info.truckdriver.online` → IP того же сервера.
2. Отдельный `server { ... }` в nginx с другим `server_name` и своим `root` на вторую копию `dist` (см. пример `deploy/nginx-marketing-subdomain.conf.example`).
3. Сборка та же: `npm run build`, `rsync` в **другой** каталог, например `/var/www/truckdriver-marketing/dist`.

## Вариант C — только лендинг под префиксом `/marketing/` (редко)

Нужен `base: '/marketing/'` в `vite.config.js` и правки роутера — иначе ассеты и роуты поедут. Проще поддомен (вариант B).

## Переменные окружения на проде

Перед сборкой задай `VITE_API_URL` (URL бэкенда с `/api`), при необходимости `VITE_TAXI_LOGIN_URL` / `VITE_FREIGHT_LOGIN_URL`.  
Можно положить `frontend/.env.production` (не коммитить секреты) или задать в CI.

## SSL

После правок конфига — как обычно `certbot` для `server_name`, в SSL-блоке сохранить те же `location /` и `location /api`, что и для `:80`.

## Проверка после выкладки

- Открыть `/` — лендинг.
- `/entry` — поток входа/регистрации.
- Авторизованный пользователь с `/` должен улетать в свой кабинет (логика в `Landing.jsx`).
