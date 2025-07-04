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

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Инициализация сервисов
const database = new Database();
const yookassaService = new YookassaService();
const paymentScheduler = new PaymentScheduler(database, yookassaService);
const telegramBot = new TelegramBotService(database, yookassaService, paymentScheduler);

// Маршруты
app.use('/webhook', webhookRoutes(telegramBot, yookassaService));
app.use('/api', apiRoutes(database));

// Главная страница
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Telegram Bot Server работает',
    timestamp: new Date().toISOString()
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Запуск сервера
app.listen(PORT, async () => {
  console.log(`Сервер запущен на порту ${PORT}`);
  
  try {
    // Инициализация базы данных
    await database.init();
    console.log('База данных инициализирована');
    
    // Запуск бота
    await telegramBot.start();
    console.log('Telegram бот запущен');
    
    // Запуск планировщика платежей
    paymentScheduler.start();
    console.log('Планировщик платежей запущен');
    
    console.log('Все сервисы запущены успешно!');
  } catch (error) {
    console.error('Ошибка при запуске сервисов:', error);
  }
});

// Обработка завершения процесса
process.on('SIGINT', async () => {
  console.log('Завершение работы сервера...');
  await telegramBot.stop();
  paymentScheduler.stop();
  process.exit(0);
});