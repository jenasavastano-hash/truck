# Architecture (текущее состояние)

## Frontend

- **React 18 + Vite**
- Роутинг: `react-router-dom`
- Proxy: `/api` -> `http://localhost:5000` (см. `frontend/vite.config.js`)

Ключевая точка входа:
- `frontend/src/main.jsx`
- `frontend/src/App.jsx` (роуты и панели ролей)

## Backend

- **Node.js + Express**
- База: **SQLite**
- API: `backend/server.js`
- Джобы:
  - `services/epl-expiry-job`
  - `services/qr-fetch-job`
  - `services/fc-expiry-job`
  - `services/document-qr-job`

## Что нужно поменять для «Грузовых ЭПЛ»

- Нейминг (Taxi → Cargo/EPL)
- Роли и экраны (убрать эвакуатор/комиссионер, добавить worker/dispatcher и т.п.)
- Контракты API: привести эндпоинты и DTO к домену грузовых ЭПЛ
- Отдельный раздел “workers”: очереди/статусы/ошибки внешних интеграций

