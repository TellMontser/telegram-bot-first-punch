import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { TelegramBotService } from './src/bot/telegramBot.js';
import { Database } from './src/database/database.js';
import { YookassaService } from './src/services/yookassaService.js';
import { PaymentScheduler } from './src/services/paymentScheduler.js';
import { webhookRoutes } from './src/routes/webhookRoutes.js';
import { apiRoutes } from './src/routes/apiRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Проверяем обязательные переменные среды
const requiredEnvVars = [
  'BOT_TOKEN',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'YUKASSA_SHOP_ID',
  'YUKASSA_SECRET_KEY'
];

console.log('Проверка переменных среды:');
for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  if (!value) {
    console.error(`❌ Переменная среды ${envVar} не найдена`);
    process.exit(1);
  } else {
    console.log(`✅ ${envVar}: ${envVar.includes('TOKEN') || envVar.includes('KEY') ? value.substring(0, 10) + '...' : value}`);
  }
}

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Инициализация сервисов
let database, yookassaService, paymentScheduler, telegramBot;

try {
  database = new Database();
  yookassaService = new YookassaService();
  paymentScheduler = new PaymentScheduler(database, yookassaService);
  telegramBot = new TelegramBotService(database, yookassaService, paymentScheduler);
  
  console.log('✅ Все сервисы инициализированы');
} catch (error) {
  console.error('❌ Ошибка инициализации сервисов:', error);
  process.exit(1);
}

// Маршруты
app.use('/webhook', webhookRoutes(telegramBot, yookassaService));
app.use('/api', apiRoutes(database, telegramBot)); // Передаем telegramBot для отправки сообщений

// Главная страница
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Telegram Bot Server работает',
    timestamp: new Date().toISOString(),
    bot_token_present: !!process.env.BOT_TOKEN,
    webhook_url: process.env.WEBHOOK_URL
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    services: {
      database: !!database,
      yookassa: !!yookassaService,
      telegram: !!telegramBot,
      scheduler: !!paymentScheduler
    }
  });
});

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  
  try {
    // Инициализация базы данных
    await database.init();
    console.log('✅ База данных инициализирована');
    
    // Запуск бота
    await telegramBot.start();
    console.log('✅ Telegram бот запущен');
    
    // Запуск планировщика платежей
    paymentScheduler.start();
    console.log('✅ Планировщик платежей запущен');
    
    console.log('🎉 Все сервисы запущены успешно!');
  } catch (error) {
    console.error('❌ Ошибка при запуске сервисов:', error);
    process.exit(1);
  }
});

// Обработка завершения процесса
process.on('SIGINT', async () => {
  console.log('⏹️ Завершение работы сервера...');
  try {
    if (telegramBot) await telegramBot.stop();
    if (paymentScheduler) paymentScheduler.stop();
    console.log('✅ Все сервисы остановлены');
  } catch (error) {
    console.error('❌ Ошибка при остановке сервисов:', error);
  }
  process.exit(0);
});

// Обработка необработанных ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(1);
});
