# Telegram Bot с ЮКассой и Supabase

Telegram бот с интеграцией ЮКассы для приема рекуррентных платежей и базой данных Supabase.

## Функциональность

- 🤖 Telegram бот для взаимодействия с пользователями
- 💳 Интеграция с ЮКассой для приема платежей
- 🔄 Рекуррентные платежи каждые 3 минуты
- 👥 Управление пользователями и подписками
- 📊 API для админ панели
- 📋 Логирование всех действий
- 🗄️ База данных Supabase

## Настройка

### 1. Настройка Supabase

1. Создайте проект в [Supabase](https://supabase.com)
2. Скопируйте URL проекта и ключи API
3. Выполните миграцию из файла `supabase/migrations/create_tables.sql`

### 2. Настройка переменных среды

Создайте файл `.env`:

```env
# Telegram Bot
BOT_TOKEN=7801546376:AAEqlhQLVwxXXujuFtYCGr6g9bE51o1BLQ
WEBHOOK_URL=https://telegram-bot-first-punch.onrender.com

# ЮКасса
YUKASSA_SHOP_ID=1103466
YUKASSA_SECRET_KEY=live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo
YUKASSA_API_URL=https://api.yookassa.ru/v3

# Supabase
SUPABASE_URL=your_supabase_url_here
SUPABASE_ANON_KEY=your_supabase_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key_here

# Server
PORT=3000
```

### 3. Деплой на Render

1. Создайте новый Web Service на Render
2. Подключите репозиторий
3. Настройте переменные среды
4. Запустите деплой

## Структура проекта

```
bot/
├── src/
│   ├── bot/
│   │   └── telegramBot.js          # Основная логика бота
│   ├── database/
│   │   └── database.js             # Работа с Supabase
│   ├── services/
│   │   ├── yookassaService.js      # Интеграция с ЮКассой
│   │   └── paymentScheduler.js     # Планировщик платежей
│   └── routes/
│       ├── apiRoutes.js            # API для админ панели
│       └── webhookRoutes.js        # Webhook'и
├── supabase/
│   └── migrations/
│       └── create_tables.sql       # SQL миграции
├── server.js                       # Главный файл сервера
├── package.json                    # Зависимости
└── README.md                       # Документация
```

## API Endpoints

- `GET /api/stats` - Статистика
- `GET /api/users` - Список пользователей
- `GET /api/payments` - Список платежей
- `GET /api/logs` - Логи действий
- `GET /api/users/:id` - Пользователь по ID
- `PUT /api/users/:id/status` - Обновить статус пользователя
- `PUT /api/users/:id/auto-payment` - Управление автоплатежом

## Команды бота

- `/start` - Начать работу с ботом
- `/subscribe` - Оформить подписку
- `/status` - Проверить статус подписки
- `/cancel` - Отменить автоплатеж
- `/help` - Показать помощь

## Схема работы

1. **Первый платеж**: Пользователь оплачивает 10 руб через ЮКассу
2. **Активация**: После успешного платежа активируется подписка
3. **Рекуррентные платежи**: Каждые 3 минуты автоматически списывается 10 руб
4. **Отмена**: Пользователь может отменить автоплатеж в любой момент

## База данных

### Таблицы:

- **users** - пользователи бота
- **payments** - все платежи
- **subscription_logs** - логи действий

### Безопасность:

- Включен Row Level Security (RLS)
- Политики доступа для service role
- Индексы для оптимизации запросов

## Безопасность

- Все платежи проходят через ЮКассу
- Webhook'и защищены проверкой подлинности
- База данных защищена RLS политиками
- Все действия логируются

## Поддержка

Если возникли проблемы, проверьте:
1. Правильность настройки переменных среды
2. Подключение к Supabase
3. Валидность токена бота
4. Настройки webhook'ов в ЮКассе
5. Логи сервера для диагностики ошибок