# Agent guide (Cursor)

Этот проект предполагает работу “агента”, который:
- читает/правит код
- поддерживает чистоту структуры
- ведёт документацию в `obsidian-vault/`
- предлагает и исполняет задачи из roadmap

## Как агенту работать с задачами

- Визуал логина / неба / промзоны: **`obsidian-vault/10 - Visual Scene (Login & Sky).md`** — единый чеклист и границы эпика.
- Каждую задачу привязывать к пункту из `obsidian-vault/04 - Roadmap.md`
- Перед удалением файлов:
  - проверить импорты/роуты/динамические require
  - проверить сборку frontend и старт backend
- Любые изменения API отражать в `obsidian-vault/05 - API Contracts.md`

## Конвенции

- Frontend:
  - страницы: `frontend/src/pages/*`
  - компоненты: `frontend/src/components/*`
  - доступ к API: `frontend/src/api/*` и единый `frontend/src/api/index.js`
- Backend:
  - роуты: `backend/routes/*`
  - бизнес-логика: `backend/services/*`
  - утилиты: `backend/utils/*`

