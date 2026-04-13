# Грузовые ЭПЛ — web

Монорепо:

| Пакет | Стек | Назначение |
|-------|------|------------|
| `frontend/` | Vite + React | Панели ролей (водитель, менеджер, админ, …) |
| `backend/` | Node.js + Express + SQLite | REST API, интеграция Такском, джобы |
| `signer-client/` | отдельный процесс | ПК-клиника / подпись (см. свой README) |

Документация продукта и дорожная карта: каталог `obsidian-vault/` (Obsidian).

## Быстрый старт (локально)

### 1) Очистка артефактов (по желанию)

В корне:

```bat
cleanup.bat
```

Сборки (`dist/`, `build/`) в `.gitignore` — в git не коммитятся.

### 2) Backend

```bash
cd backend
cp .env.example .env   # Linux/macOS; в Windows: скопируйте файл вручную
npm install
npm run dev
```

Проверка: [http://localhost:5000/api/health](http://localhost:5000/api/health)

Переменные: см. `backend/.env.example` (`PORT` по умолчанию **5000**, `JWT_SECRET`, Такском, ЮKassa и т.д.).

### 3) Frontend

```bash
cd frontend
cp .env.example .env.development   # или создайте .env.development с VITE_API_URL
npm install
npm run dev
```

По умолчанию UI: **http://127.0.0.1:3000**, прокси `/api` → `http://localhost:5000` (см. `frontend/vite.config`).

`VITE_API_URL` должен указывать на тот же хост/порт, что и API (пример в `frontend/.env.example`).

## Полезные ссылки

- Сводка API: `obsidian-vault/05 - API Contracts.md`
- Smoke перед релизом: `docs/SMOKE.md`

## Legacy

Отдельные имена в коде (старые префиксы localStorage, ассеты `taxi.png` в игре) постепенно выводятся; поведение для пользователя — грузовой домен. Крупные удаления — только после проверки сборки и сценариев.
