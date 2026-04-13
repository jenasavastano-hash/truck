# 🚀 Быстрый старт Telegram Mini App

## Шаг 1: Создай бота

1. Открой [@BotFather](https://t.me/BotFather)
2. Отправь `/newbot`
3. Следуй инструкциям
4. **Сохрани токен** (выглядит как `1234567890:ABCdefGHIjklMNOpqrsTUVwxyz`)

## Шаг 2: Задеплой сайт

### Вариант А: Vercel (рекомендуется)

```bash
cd frontend
npm install -g vercel
vercel
# Следуй инструкциям
# Получишь URL: https://taxi-app.vercel.app
```

### Вариант Б: Netlify

```bash
cd frontend
npm run build
npm install -g netlify-cli
netlify deploy --prod
# Получишь URL: https://taxi-app.netlify.app
```

## Шаг 3: Настрой Mini App

1. Открой [@BotFather](https://t.me/BotFather)
2. Отправь `/newapp`
3. Выбери своего бота
4. Введи:
   - Название: "Личный кабинет водителя"
   - Описание: "Управление путевыми листами"
   - **URL:** `https://твой-домен.vercel.app` (из шага 2)
   - Иконка: 512x512px PNG
   - Скриншот: 640x360px PNG

## Шаг 4: Запусти бота

```bash
# Установи зависимости
npm install node-telegram-bot-api

# Создай .env файл в корне проекта
echo "TELEGRAM_BOT_TOKEN=твой_токен_от_BotFather" > .env
echo "TELEGRAM_WEB_APP_URL=https://твой-домен.vercel.app" >> .env

# Запусти бота
node telegram-bot.js
```

## Шаг 5: Протестируй

1. Открой своего бота в Telegram
2. Отправь `/start`
3. Нажми кнопку "Открыть личный кабинет"
4. **Готово!** 🎉

---

## 📝 Что дальше?

1. **Интеграция авторизации:** Обнови `AuthContext.jsx` для работы с Telegram (см. `TELEGRAM_MINI_APP_ИНТЕГРАЦИЯ.md`)
2. **Бэкенд:** Добавь эндпоинт `/api/auth/telegram` (см. документацию)
3. **Уведомления:** Настрой отправку уведомлений через бота

---

## ❓ Проблемы?

- **Бот не отвечает:** Проверь токен в `.env`
- **Кнопка не работает:** Убедись, что сайт на HTTPS
- **Сайт не открывается:** Проверь URL в настройках Mini App
