# Чеклист: почему не открывается сайт (домен / IP VPS)

Делай по порядку. Как только что-то не совпадает — исправляй и перепроверяй.

**Что дальше после деплоя:** см. **DEPLOY-ДАЛЬШЕ.md** (HTTPS, DNS, обновления).

---

## Часть 1. Подключение к серверу

1. Открой PowerShell (или cmd) на своём компе.
2. Выполни: `ssh root@212.22.82.181` (порт 22, пароль из панели VPS).
3. Введи пароль. Должно появиться приглашение: `root@VM-919223:~#`
4. Все команды ниже выполняй **на сервере** (в этой SSH-сессии).

---

## Часть 2. Бэкенд (Node + PM2)

### 2.1 PM2 запущен

```bash
pm2 list
```

- Должна быть строка с именем процесса API (например **freight-epl-api**), статус **online**.
- Если нет или статус **errored** / **stopped**:
  ```bash
  cd /root/backend && pm2 start server.js --name freight-epl-api && pm2 save
  ```

### 2.2 Бэкенд слушает порт 5000

```bash
ss -tlnp | grep 5000
```

- Должна быть строка с `:5000` и `node`.
- Если пусто — бэкенд не запустился. Смотри логи:
  ```bash
  pm2 logs freight-epl-api --lines 50
  ```

### 2.3 Проверка API с самого сервера

```bash
curl -s http://127.0.0.1:5000/api/health
```

- Ожидается ответ вроде: `{"status":"OK","timestamp":"..."}`
- Если ошибка или пусто — бэкенд не отвечает, смотри `pm2 logs freight-epl-api` (или имя из `pm2 list`).

---

## Часть 3. Nginx

### 3.1 Nginx запущен

```bash
systemctl status nginx
```

- Должно быть: **active (running)** (зелёным).
- Если не запущен:
  ```bash
  systemctl start nginx
  ```

### 3.2 Nginx слушает порт 80

```bash
ss -tlnp | grep :80
```

- Должна быть строка с `:80` и **nginx**.

### 3.3 Конфиг taxi подключён

```bash
ls -la /etc/nginx/sites-enabled/
```

- Должна быть ссылка на **taxi** (например `taxi -> /etc/nginx/sites-available/taxi`).
- Если нет:
  ```bash
  ln -sf /etc/nginx/sites-available/taxi /etc/nginx/sites-enabled/
  ```

### 3.4 Содержимое конфига taxi

```bash
cat /etc/nginx/sites-available/taxi
```

Проверь, что есть **всё** из этого (без лишних команд в конце файла):

- `listen 80;`
- `server_name` содержит **ваш домен** и/или **IP сервера**
- `root /root/dist;`
- `location /api { ... proxy_pass http://127.0.0.1:5000; ... }`

Если чего-то нет или `server_name` другой — отредактируй:

```bash
nano /etc/nginx/sites-available/taxi
```

Исправь, сохрани (Ctrl+O, Enter), выйди (Ctrl+X).

### 3.5 Проверка конфига и перезагрузка nginx

```bash
nginx -t && systemctl reload nginx
```

- Должно быть: **syntax is ok** и **test is successful**. Если ошибка — исправь конфиг по сообщению.

### 3.5a Если /api/auth/login возвращает 404 (после certbot / HTTPS)

Часто после **certbot** появляется отдельный блок `listen 443 ssl`, в котором нет `location /api` — тогда запросы на `https://.../api/...` не проксируются на Node и отдают 404.

1. Открой конфиг: `cat /etc/nginx/sites-available/taxi` (или файл, который изменил certbot для вашего домена).
2. Найди блок с `listen 443 ssl;` и проверь, что **внутри него** есть такой же `location /api`:
   ```nginx
   location /api {
       proxy_pass http://127.0.0.1:5000;
       proxy_http_version 1.1;
       proxy_set_header Host $host;
       proxy_set_header X-Real-IP $remote_addr;
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
       proxy_set_header X-Forwarded-Proto $scheme;
   }
   ```
3. Если блока нет — добавь его в тот же server { listen 443 ... }, сохрани, затем: `nginx -t && systemctl reload nginx`.

### 3.6 Файлы фронта на месте

```bash
ls -la /root/dist/
```

- Должны быть: **index.html** и папка **assets** (внутри .js и .css).
- Если пусто или нет index.html — заново залей фронт через deploy.bat (п. 1 «Перезалить всё»).

---

## Часть 4. Фаервол (порт 80 снаружи)

```bash
ufw status
```

- Если **active** и в списке нет **80** — открой порт:
  ```bash
  ufw allow 80/tcp
  ufw reload
  ```
- Если **inactive** — порты не блокируются, этот шаг можно пропустить.

---

## Часть 5. Проверка с самого сервера (из SSH)

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/api/health
```

- Первая команда: ожидается **200** (главная страница).
- Вторая: ожидается **200** (API).

Если 200 — nginx и бэкенд на сервере работают. Если 404/502 — смотри конфиг nginx и root/прокси.

---

## Часть 6. DNS (для открытия по доменному имени)

- Зайди в панель, где управляешь доменом (Beget / регистратор).
- Раздел **DNS** или **Подзоны и записи DNS**.
- Для корня домена (или @) и **www** должна быть A-запись на **IP вашего VPS**.
- Записи с другим IP — удали или замени на актуальный IP сервера.
- Подожди 5–30 минут после изменений.

Проверка с компа (PowerShell), подставь свой домен:

```powershell
nslookup ваш-домен.example
```

- В ответе должен быть адрес **вашего VPS**.

---

## Часть 7. Проверка с твоего компа (браузер)

1. Открой в браузере: **http://IP_вашего_VPS**
   - Должна открыться главная (логин/интерфейс). Если «Страница не найдена» — проблема на сервере (nginx/фронт/фаервол), вернись к частям 2–5.
2. Открой по домену, если уже настроен DNS.
   - Должно быть то же, что по IP. Если не открывается — проверь DNS (часть 6).

---

## Часть 8. Если по IP открывается, а по домену — нет

- Значит, DNS ещё не обновился или указан не тот IP. Ещё раз проверь A-записи и подожди.
- В конфиге nginx в `server_name` должны быть и домен, и IP (как в п. 3.4).

---

## Часть 9. Если ничего не открывается

Проверь по шагам:

1. `pm2 list` → процесс API **online**
2. `ss -tlnp | grep -E '80|5000'` → есть **:80** (nginx) и **:5000** (node)
3. `curl -s http://127.0.0.1:5000/api/health` → ответ с `"status":"OK"`
4. `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1/` → **200**
5. `ufw status` → порт 80 разрешён или фаервол выключен
6. Конфиг: `nginx -t` без ошибок, в `server_name` указаны **ваш домен** и/или **IP сервера**
7. Фронт есть: `ls /root/dist/index.html` — файл есть

Скинь вывод этих команд — по ним можно будет сказать, на каком шаге ломается.

---

## Краткая шпаргалка команд (копируй на сервер)

```bash
# Статус бэка и портов
pm2 list
ss -tlnp | grep -E '80|5000'
curl -s http://127.0.0.1:5000/api/health

# Статус nginx и конфиг
systemctl status nginx
nginx -t
cat /etc/nginx/sites-available/taxi

# Фронт
ls -la /root/dist/

# Фаервол
ufw status
```

После любых правок конфига nginx: `nginx -t && systemctl reload nginx`.  
После правок бэка: `pm2 restart freight-epl-api` (или имя из `pm2 list`).
