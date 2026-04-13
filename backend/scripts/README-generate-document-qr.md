# Генерация QR на PDF для существующих ЭПЛ

Скрипт `generate-document-qr.js` находит все ЭПЛ, у которых есть PDF (`documentPdf`), но нет QR на PDF (`documentQr`), и генерирует QR для каждого.

## Запуск на сервере

1. Подключись по SSH: `ssh root@212.22.82.181`
2. Перейди в папку backend: `cd /root/backend`
3. Запусти скрипт:
   ```bash
   node scripts/generate-document-qr.js
   ```

Скрипт покажет:
- Сколько ЭПЛ найдено без documentQr
- Прогресс обработки каждого ЭПЛ
- Итоговую статистику (сколько обработано, сколько ошибок)

## Что делает скрипт

1. Ищет все ЭПЛ с `documentPdf IS NOT NULL AND length(documentPdf) > 0`, но без `documentQr`
2. Для каждого ЭПЛ:
   - Генерирует случайный `documentToken` (24 байта, hex)
   - Создаёт URL: `{PUBLIC_APP_URL}/api/public/epl-document/{eplId}?token={token}`
   - Генерирует QR-код (data URL, PNG, 400x400px)
   - Сохраняет `documentToken` и `documentQr` в БД
3. Выводит статистику

## Переменные окружения

Скрипт использует `PUBLIC_APP_URL` из `.env` (или `API_URL`, или иначе `http://127.0.0.1:<PORT>` из `.env`).

## Безопасность

Скрипт только читает и обновляет БД. Не удаляет данные. Можно запускать многократно — он обработает только те ЭПЛ, у которых ещё нет `documentQr`.
