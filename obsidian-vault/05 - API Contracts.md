# API Contracts

Контракты между frontend и backend. **Источник правды по путям** — `backend/server.js` (монтирование) и `backend/routes/*.js` (обработчики).

База: `http://localhost:5000` (или `PORT` из `.env`). Префикс API: `/api`.

---

## Глобальные точки (вне роутеров)

| Метод | Путь | Назначение |
|-------|------|------------|
| GET | `/api/health` | Проверка живости |
| GET | `/api/public/epl-document/:id?token=` | PDF по токену (QR «открыть документ») |

---

## Префиксы и файлы

| Префикс | Файл(ы) | Роли / назначение |
|-----------|---------|-------------------|
| `/api/auth` | `routes/auth.js` | Регистрация, логин, `/me`, учётные данные |
| `/api/admin` | `admin.js`, `admin-stats.js`, `admin-evacuator.js`, `admin-commissioner.js`, `admin-drivers-monitoring.js`, `admin-finance.js` | Администратор парков, ЭПЛ, Takskom, финансы, эвакуаторы/комиссары, мониторинг |
| `/api/manager` | `manager.js` | Менеджер парка: водители, авто, ЭПЛ, фотоконтроль, рассылки |
| `/api/driver` | `driver.js` | Водитель: ЭПЛ, рейсы (`rides`), баланс, игра, фотоконтроль, эвакуатор/комиссар с водителя |
| `/api/worker` | `worker.js` | Сервисные вызовы воркера (напр. сбой создания ЭПЛ) |
| `/api/clinic` | `clinic.js` | **ПК-клиника / Takskom-пайплайн** (heartbeat, очереди, PDF, QR, завершение) — не браузерный UI |
| `/api/director` | `director.js` | Директор парка: дашборд, водители, авто, ЭПЛ, фотоконтроль, рассылки |
| `/api/evacuator` | `evacuator.js` | Кабинет эвакуатора |
| `/api/commissioner` | `commissioner.js` | Кабинет комиссара |
| `/api/signer` | `signer.js` | Подписание титулов (внешний поток) |
| `/api/crm` | `crm-leads.js` | Публичные лиды обратного звонка + обработка менеджером |

Подробнее по значениям `epl.status` и агрегированным статусам UI — [[11 - Glossary EPL Statuses]].

Поля **Такском / коммерческий вид перевозки** при создании ЭПЛ через API — см. [[12 - EPL Takskom Freight]] (`commercialShippingType`, env `TAKSKOM_COMMERCIAL_SHIPPING_TYPE`).

---

## Auth (`/api/auth`)

- `POST /register`, `POST /login`, `GET /me`
- `PUT /me/credentials`, `PUT /users/:id/credentials`
- `POST /admin/register`

---

## Driver (`/api/driver`) — ключевые группы

**Профиль и прочее:** `GET /profile`, `GET /home-stats`, `GET /balance`, уведомления, треды рассылок, `POST /balance/topup`, `GET /payment/:paymentId/status`.

- `GET /driver/profile` теперь возвращает:
  - `eplAccessMode`: `all | driver_only | manager_director_only` (уровень парка),
  - `eplAccessOverride`: `default | force_allow | force_deny` (персонально по водителю),
  - `canCreateEpl`: итоговый флаг доступа на создание ЭПЛ в кабинете водителя.

**ЭПЛ и смена:** `GET /epl/list`, `GET /commercial-shipping-types` (коды вида коммерческой перевозки для формы), `POST /epl/create` (тело: `startOdometer?`, `commercialShippingType?` — код `ПГ|РП|ЗП|ТЛ|ОД`, по умолчанию **ПГ**), `GET /epl/:id`, `POST /epl/:id/complete`, `POST /epl/:id/close-shift`, `GET /epl/:id/document`, титулы и подпись: `GET /epl/:eplId/titles`, `POST /epl/:titleId/sign`, `POST /epl/:eplId/submit` (в файле есть перекрывающиеся маршруты `GET /epl/:eplId` — порядок объявления важен).

- `POST /driver/epl/create` блокируется (403), если эффективный доступ `canCreateEpl = false`.
- `POST /driver/shift-open-request` — водитель отправляет заявку менеджеру/директору на открытие смены (создаёт запись в `shift_open_requests`, создаёт/обновляет тред и отправляет нотификации в парк). Требует `startOdometer`, антиспам: только 1 активная заявка `pending` на водителя.
  - если на текущую дату есть план смены в `shift_plans` (status=`planned`), то заявка не создаётся: система сразу создаёт `epl` со статусом `pending_clinic` и помечает план `consumed`.
- `GET /driver/shift-open-request/status` — статус последней заявки водителя (`hasActiveRequest`, `request`) + наличие плана на сегодня (`hasPlannedShiftToday`, `plannedShift`).

**Рейсы:** `POST /rides/start`, `POST /rides/:rideId/end`, `GET /rides`.

**Игра:** `/game/*` (settings, leaderboard, points, achievements, inventory, shop, score).

**Фотоконтроль:** `/photo-control/*`.

**Эвакуатор / комиссар с водителя:** `/evacuator/*`, `/commissioner/*` (запросы с телефона водителя).

---

## Manager (`/api/manager`)

Парк: `GET /parks`, `GET /park`, `owners`, `cars`, `drivers`, поиск, дашборд, статистика.

ЭПЛ: `GET /epl`, закрытие смены, логи, requeue, документы/QR Mintrans, `POST /epl/:id/complete-without-driver`.

Рассылки и мониторинг: `broadcast-threads`, `drivers/monitoring`, `broadcast-templates`.

Фотоконтроль: `photo-control/applications` и связанные `PATCH`.

- `PUT /manager/drivers/:driverId` поддерживает `eplAccessOverride` (`default | force_allow | force_deny`).
- `GET /manager/shift-open-requests` — список заявок на открытие смены (поиск/фильтр по статусу).
- `POST /manager/shift-open-requests/:id/approve` — принять заявку и открыть смену (создать `epl` со статусом `pending_clinic`).
- `POST /manager/shift-open-requests/:id/reject` — отклонить заявку (с причиной или без).
- `GET /manager/shift-plans` — список планов смен на дату (`date`, `status`, `search`).
- `POST /manager/shift-plans` — создать/обновить план смены для водителя (upsert по `parkId+shiftDate+driverUserId`).
- `POST /manager/shift-plans/:id/cancel` — отменить запланированную смену.

---

## Director (`/api/director`)

Широкий паритет с менеджером плюс управление парком/водителями/авто/EPL с точки зрения директора: см. grep в `director.js` (dashboard, epl, cars, drivers, statistics, photo-control, broadcast).

- `GET/PUT /director/park/settings` поддерживает `eplAccessMode` (`all | driver_only | manager_director_only`).
- `PUT /director/drivers/:driverId` поддерживает `eplAccessOverride` (`default | force_allow | force_deny`).
- `GET /director/shift-open-requests` — список заявок на открытие смены (поиск/фильтр по статусу).
- `POST /director/shift-open-requests/:id/approve` — принять заявку и открыть смену (создать `epl` со статусом `pending_clinic`).
- `POST /director/shift-open-requests/:id/reject` — отклонить заявку (с причиной или без).
- `GET /director/shift-plans` — список планов смен на дату (`date`, `status`, `search`).
- `POST /director/shift-plans` — создать/обновить план смены для водителя (upsert по `parkId+shiftDate+driverUserId`).
- `POST /director/shift-plans/:id/cancel` — отменить запланированную смену.

---

## Admin (`/api/admin`)

Takskom: `/takskom/check`, `/takskom/carparks`, `/takskom/link-carpark`.

Настройки: `epl-creation-mode`, парки, синхронизация, владельцы, taxcom-links, финансы парка.

- `GET/PUT /admin/parks/:parkId/settings` поддерживает `eplAccessMode` (`all | driver_only | manager_director_only`).
- `PUT /admin/drivers/:driverId/takskom` поддерживает `eplAccessOverride` (`default | force_allow | force_deny`).
- `GET /admin/shift-open-requests` — список заявок на открытие смены по всем паркам (или `?parkId=`).
- `POST /admin/shift-open-requests/:id/approve` — принять заявку и открыть смену (создать `epl` со статусом `pending_clinic`).
- `POST /admin/shift-open-requests/:id/reject` — отклонить заявку (с причиной или без).
- `GET /admin/shift-plans` — список планов смен по паркам (`parkId`, `date`, `status`, `search`).
- `POST /admin/shift-plans` — создать/обновить план смены (обязательно `parkId`).
- `POST /admin/shift-plans/:id/cancel` — отменить запланированную смену.
- `POST /admin/parks/:parkId/staff` и `POST /director/parks/:parkId/staff` теперь поддерживают несколько сотрудников на роль:
  - если передан `id` — обновление конкретного сотрудника;
  - если `id` не передан — создание новой записи;
  - новые поля персонала: `isActive`, `priority`.

## Валидации активации парка

- При включении парка (`isActive=1`) в настройках:
  - должен быть активный `dispatcher`, `medic`, `technic`;
  - у каждой роли должны быть заполнены `fullName` и `position`;
  - у медика дополнительно обязательны лицензия и даты (`licenseSerial`, `licenseNumber`, `licenseDateStart`, `licenseDateEnd`).

ЭПЛ: списки, детали, логи, закрытие смены, requeue, mutate-inn, документы/QR.

Персонал: менеджеры, директора, водители, impersonate (driver/evacuator/commissioner/director/manager), баланс, штрафы, увольнение.

Прочее: `/statistics`, `/balance/sanity`, `/bot/create-park`, авто под парком.

**Доп. модули на том же префиксе:**

- `admin-stats.js`: `/statistics/aggregate`, `/parks/:parkId/statistics`, `/parks/:parkId/cars`
- `admin-finance.js`: `GET /finance`, `GET /finance/export` (отдельная авторизация finance)
- `admin-drivers-monitoring.js`: мониторинг водителей и шаблоны рассылок (дублирует часть путей с другими ролями — смотреть файл)
- `admin-evacuator.js`, `admin-commissioner.js`: CRUD и настройки эвакуаторов/комиссаров

---

## Clinic (`/api/clinic`) — интеграция ПК

Служебные: `POST /heartbeat`, `GET /pending-creation`, `POST /titul-progress`, `POST /epl-created`, `POST /clear-qr`, `GET /next-epl-for-qr-fetch`, `POST /epl-log`, `POST /epl/:id/qr`, `GET /pending-completion`, `POST /epl-completed`.

Тело крупных POST — JSON до 10 MB (`server.js`).

---

## Worker (`/api/worker`)

- `POST /epl/:id/create-attempt-failed` — отметка неудачной попытки создания (воркер/клиника).

---

## CRM (`/api/crm`)

- `POST /callback` — публичная заявка с лендинга (имя, контакт, компания, тип бизнеса, комментарий, sourcePage).
- `GET /callback` — список лидов для ролей `admin|manager|director`.
- `PATCH /callback/:id` — обновление статуса отработки (`new|in_progress|done|rejected`) и `callResult`.

---

## Signer (`/api/signer`)

- `GET /pending`, `POST /title/:titleId/sign`

---

## Evacuator / Commissioner

Зеркальная структура: settings, online, balance, notifications, requests, orders, balance topup, payment status — см. `evacuator.js` / `commissioner.js`.

---

## Будущая нормализация (не реализовано)

Ранее в черновике фигурировали отдельные пути вида `POST /api/epl` — **в текущем коде ЭПЛ размазаны по ролевым префиксам** (`/api/driver/epl/*`, `/api/admin/epl/*`, и т.д.). При рефакторинге имеет смысл вынести общую модель в документ и постепенно сходить к единому REST-неймингу; до тех пор ориентируйтесь на таблицу выше и grep по `backend/routes`.
