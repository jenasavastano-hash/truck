# Visual Implementation Spec — кабинет водителя (Freight)

Краткий контракт для правок UI без «точечных костылей».

## Принципы

1. **Одна сцена day/night** — фон (`FreightCinematicBackdrop`), шапка, hero и карточки читаются как один слой; ночь не смешивает фиолетовый неон с полупрозрачным белым хедером без правила.
2. **Палитра ночи** — slate + teal (акцент бренда), без доминанты violet/indigo на фоне.
3. **Поверхности** — CSS-переменные `--freight-driver-surface`, `--freight-driver-surface-night`, `--freight-driver-border`, `--freight-driver-border-night` в `frontend/src/index.css`; hero и карточки статусов согласованы.
4. **Проп `night`** — передаётся в `StatusOverview`, `FreightEplHint`, опционально в триггеры шапки (`ProfileMenu`), чтобы строки и бордеры не оставались «дневными» на тёмной сцене.

## Файлы

| Область | Файл |
|--------|------|
| Токены | `frontend/src/index.css` |
| Фон сцены (водитель) | `frontend/src/components/FreightCinematicBackdrop.jsx` |
| Фон операционный (админ: трасса + силуэты ТС, день/ночь) | `frontend/src/components/freight/FreightOperationsBackdrop.jsx` |
| Портал | `frontend/src/pages/DriverPortal.jsx` |
| Админ-панель | `frontend/src/pages/AdminPanel.jsx`, `frontend/src/components/AdminParksList.jsx` |
| Карточка статусов | `frontend/src/components/driver/StatusOverview.jsx` |
| Подсказка ЭПЛ | `frontend/src/components/driver/FreightEplHint.jsx` |
| Профиль в шапке | `frontend/src/components/driver/ProfileMenu.jsx` |

Админ: сцена в `localStorage` как `freight_admin_scene` (`day` / `night`), по умолчанию как у водителя (ночь 7–20).

Операционный фон (`FreightOperationsBackdrop`): ночь — много звёзд (в т.ч. крупные, CSS-мерцание `freight-star` / `freight-star-lg`), без жёлтой анимированной дорожной разметки; день — небо + облака. Карточки парков: `Card` с `variant` glassNight / glassDay (iOS-подобное стекло: blur, hairline, ring).

## Регрессия

После правок: `npm run build` в `frontend`.
