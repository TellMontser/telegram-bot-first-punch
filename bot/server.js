import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { TelegramBotService } from './src/bot/telegramBot.js';
import { Database } from './src/database/database.js';
import { YookassaService } from './src/services/yookassaService.js';
import { CryptoCloudService } from './src/services/cryptoCloudService.js';
import { PaymentScheduler } from './src/services/paymentScheduler.js';
import { webhookRoutes } from './src/routes/webhookRoutes.js';
import { apiRoutes } from './src/routes/apiRoutes.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Проверяем обязательные переменные среды
const requiredEnvVars = [
  'BOT_TOKEN',
  'WEBHOOK_URL',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'YUKASSA_SHOP_ID',
  'YUKASSA_SECRET_KEY',
  'CRYPTOCLOUD_API_KEY',
  'CRYPTOCLOUD_SHOP_ID',
  'CRYPTOCLOUD_SECRET'
];

console.log('🔍 Проверка переменных среды:');
for (const envVar of requiredEnvVars) {
  const value = process.env[envVar];
  if (!value) {
    console.error(`❌ Переменная среды ${envVar} не найдена`);
    if (['BOT_TOKEN', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].includes(envVar)) {
      process.exit(1); // Критические переменные
    } else {
      console.warn(`⚠️ Переменная ${envVar} не найдена, сервис может работать некорректно`);
    }
  } else {
    console.log(`✅ ${envVar}: ${envVar.includes('TOKEN') || envVar.includes('KEY') ? value.substring(0, 10) + '...' : value}`);
  }
}

// Проверяем дополнительные переменные для канала
console.log('🔒 Проверка настроек канала:');
console.log(`📋 PRIVATE_CHANNEL_ID: ${process.env.PRIVATE_CHANNEL_ID || 'НЕ НАСТРОЕН (будет использован по умолчанию)'}`);
console.log(`👑 CHANNEL_ADMINS: ${process.env.CHANNEL_ADMINS || 'НЕ НАСТРОЕНЫ'}`);

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Инициализация сервисов
let database, yookassaService, cryptoCloudService, paymentScheduler, telegramBot;

try {
  database = new Database();
  yookassaService = new YookassaService();
  
  // Инициализируем CryptoCloud сервис
  try {
    cryptoCloudService = new CryptoCloudService();
    console.log('✅ CryptoCloud сервис инициализирован');
  } catch (error) {
    console.warn('⚠️ CryptoCloud сервис недоступен:', error.message);
    cryptoCloudService = null;
  }
  
  telegramBot = new TelegramBotService(database, yookassaService, null, cryptoCloudService); // paymentScheduler будет передан позже
  paymentScheduler = new PaymentScheduler(database, yookassaService, telegramBot); // Передаем telegramBot
  
  // Обновляем ссылку на paymentScheduler в telegramBot
  telegramBot.paymentScheduler = paymentScheduler;
  
  console.log('✅ Все сервисы инициализированы');
} catch (error) {
  console.error('❌ Ошибка инициализации сервисов:', error);
  process.exit(1);
}

// Маршруты
app.use('/webhook', webhookRoutes(telegramBot, yookassaService, cryptoCloudService));
app.use('/api', apiRoutes(database, telegramBot)); // Передаем telegramBot для отправки сообщений

// Главная страница
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Telegram Bot Server с управлением каналом и криптоплатежами работает',
    timestamp: new Date().toISOString(),
    bot_token_present: !!process.env.BOT_TOKEN,
    webhook_url: process.env.WEBHOOK_URL,
    payment_systems: {
      yookassa: !!yookassaService,
      cryptocloud: !!cryptoCloudService
    },
    channel_management: {
      private_channel_id: process.env.PRIVATE_CHANNEL_ID || 'default',
      admins_configured: !!(process.env.CHANNEL_ADMINS && process.env.CHANNEL_ADMINS.length > 0)
    }
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
      cryptocloud: !!cryptoCloudService,
      telegram: !!telegramBot,
      scheduler: !!paymentScheduler,
      channel_management: true
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
    
    // Запуск планировщика платежей и аудита канала
    paymentScheduler.start();
    console.log('✅ Планировщик платежей и аудита канала запущен');
    
    // Проверяем доступность CryptoCloud API
    if (cryptoCloudService) {
      try {
        const cryptoStatus = await cryptoCloudService.checkApiStatus();
        if (cryptoStatus) {
          console.log('✅ CryptoCloud API доступен');
        } else {
          console.warn('⚠️ CryptoCloud API недоступен');
        }
      } catch (error) {
        console.warn('⚠️ Не удалось проверить CryptoCloud API:', error.message);
      }
    }
    
    console.log('🎉 Все сервисы запущены успешно!');
    console.log('🔒 Управление закрытым каналом активировано');
    console.log('💰 Платежные системы:', {
      yookassa: '✅ ЮКасса',
      cryptocloud: cryptoCloudService ? '✅ CryptoCloud' : '❌ CryptoCloud недоступен'
    });
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