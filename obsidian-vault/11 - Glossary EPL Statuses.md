# Глоссарий: статусы ЭПЛ и смены

Согласование **БД → API → UI**. При смене CHECK-ограничений в `epl` или логики агрегации на бэкенде обновляйте этот файл и подписи в `StatusOverview` и связанных экранах.

---

## `epl.status` (SQLite, таблица `epl`)

Ограничение в схеме (см. `backend/database.js`, `CREATE TABLE epl`):

`draft` · `pending_clinic` · `pending` · `signed` · `submitted` · `approved` · `rejected` · `failed`

| Значение | Смысл (кратко) |
|----------|----------------|
| `draft` | Черновик / до отправки в очередь клиники |
| `pending_clinic` | Ожидает создания/обработки программой на ПК (клиника) |
| `pending` | В процессе (Такском/Минтранс), в т.ч. ожидание QR и т.п. |
| `signed` | Подписан (титулы/подпись пройдена по сценарию) |
| `submitted` | Отправлен |
| `approved` | Принят |
| `rejected` | Отклонён |
| `failed` | Ошибка создания; детали в `errorMessage` |

Дополнительные поля строки ЭПЛ (не статусы): `waybillNumber`, `mintransId`, `qrCode`, одометр, `documentPdf`/`documentToken` при наличии миграций.

---

## `shifts.status` (таблица `shifts`)

`active` · `closed` · `auto_closed`

Относится к записи смены, привязанной к `eplId`. Автозакрытие и напоминания — см. сервисы expiry/job.

---

## Агрегированный `shiftStatus` / фотоконтроль в UI

На экране водителя (`StatusOverview` и родственные ответы API) для карточек смены и фотоконтроля используются **не только** значения из `shifts.status`, а вычисляемые строки, например:

- `active` — смена/контроль в рабочем состоянии
- `creating` — идёт создание или ожидание
- `inactive` — нет активной смены / контроль не активен

Их нужно трактовать как **UX-статусы**, сопоставляя с парой `(epl.status, shifts.status, photo_control_application.*)` по ответу конкретного эндпоинта. Если расхождение с подписью на экране — править либо маппинг на бэкенде, либо текст в UI, чтобы не противоречить [[05 - API Contracts]].

---

## Быстрая проверка в коде

- Схема ЭПЛ: `backend/database.js` — `CREATE TABLE IF NOT EXISTS epl`
- Смены: тот же файл — `CREATE TABLE IF NOT EXISTS shifts`
- Водительский UI: `frontend/src/components/driver/StatusOverview.jsx`
