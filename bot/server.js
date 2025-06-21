import express from 'express';
import cors from 'cors';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createSubscriptionPayment } from './payments.js';
import { verifyWebhookSignature, createSimpleYukassaPayment, getYukassaPayment } from './yukassa.js';
import {
  addOrUpdateUser,
  markUserAsBlocked,
  getUser,
  getAllUsers,
  addMessage,
  getMessages,
  addJoinRequest,
  updateJoinRequestStatus,
  getJoinRequests,
  addSubscription,
  isSubscriptionActive,
  getUserSubscription,
  getAllSubscriptions,
  updateSubscriptionStatus,
  addPayment,
  updatePaymentStatus,
  getPaymentByPaymentId,
  getAllPayments,
  getStats
} from './lib/supabase.js';

// Получаем __dirname для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render автоматически назначает порт
const PORT = process.env.PORT || 10000;

const BOT_TOKEN = '7604320716:AAFK-L72uch_OF2gliQacoPVz4RjlqvZXlc';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Настройка multer для загрузки файлов
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// МАКСИМАЛЬНО ОТКРЫТЫЕ CORS настройки для админки
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  allowedHeaders: '*',
  credentials: false,
  optionsSuccessStatus: 200
}));

// Дополнительные CORS заголовки
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Max-Age', '86400');
  
  console.log(`📨 ${req.method} ${req.url} from ${req.get('Origin') || 'unknown'}`);
  
  if (req.method === 'OPTIONS') {
    console.log('✅ Preflight request handled');
    return res.status(200).end();
  }
  
  next();
});

// Middleware для webhook ЮKassa (должен быть ДО express.json())
app.use('/api/yukassa-webhook', express.raw({ type: 'application/json' }));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ЗАЯВКАМИ ====================

async function approveJoinRequest(chatId, userId) {
  try {
    await bot.approveChatJoinRequest(chatId, userId);
    await updateJoinRequestStatus(chatId, userId, 'approved');
    console.log(`✅ Запрос на вступление одобрен для пользователя ${userId}`);
  } catch (error) {
    console.error('❌ Ошибка при одобрении запроса:', error);
    throw error;
  }
}

async function declineJoinRequest(chatId, userId) {
  try {
    await bot.declineChatJoinRequest(chatId, userId);
    await updateJoinRequestStatus(chatId, userId, 'declined');
    console.log(`❌ Запрос на вступление отклонен для пользователя ${userId}`);
  } catch (error) {
    console.error('❌ Ошибка при отклонении запроса:', error);
    throw error;
  }
}

// ==================== ФУНКЦИИ ДЛЯ РАБОТЫ С ПОДПИСКАМИ ====================

async function cancelUserSubscription(userId) {
  try {
    console.log(`🚫 Отмена подписки для пользователя ${userId}`);
    
    // Получаем активную подписку пользователя
    const subscription = await getUserSubscription(userId);
    
    if (subscription && subscription.status === 'active') {
      // Обновляем статус подписки на cancelled
      await updateSubscriptionStatus(subscription.id, userId, 'cancelled');
      
      console.log(`✅ Подписка отменена для пользователя ${userId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка при отмене подписки:', error);
    return false;
  }
}

async function getSubscriptionInfo(userId) {
  try {
    const subscription = await getUserSubscription(userId);
    const isActive = await isSubscriptionActive(userId);
    
    return {
      hasSubscription: !!subscription,
      isActive: isActive,
      subscription: subscription
    };
  } catch (error) {
    console.error('❌ Ошибка при получении информации о подписке:', error);
    return {
      hasSubscription: false,
      isActive: false,
      subscription: null
    };
  }
}

// ==================== API ENDPOINTS ====================

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check запрос получен');
  try {
    res.status(200).json({ 
      status: 'ok', 
      service: 'telegram-bot-first-punch',
      timestamp: new Date().toISOString(),
      port: PORT,
      env: process.env.NODE_ENV || 'production',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: 'supabase'
    });
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Корневой endpoint
app.get('/', (req, res) => {
  console.log('🏠 Корневой запрос получен');
  res.json({ 
    message: 'Telegram Bot "Первый Панч" API Server', 
    status: 'running',
    timestamp: new Date().toISOString(),
    database: 'supabase',
    endpoints: {
      health: '/health',
      api: '/api/*'
    }
  });
});

// API endpoints
app.get('/api/users', async (req, res) => {
  try {
    console.log('👥 Запрос пользователей');
    const users = await getAllUsers();
    
    const usersWithSubscriptionStatus = await Promise.all(
      users.map(async (user) => {
        const hasActiveSubscription = await isSubscriptionActive(user.id);
        return {
          ...user,
          subscription_active: hasActiveSubscription
        };
      })
    );
    
    console.log(`✅ Отправлено ${usersWithSubscriptionStatus.length} пользователей`);
    res.json({ users: usersWithSubscriptionStatus });
  } catch (error) {
    console.error('❌ Ошибка при получении пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/stats', async (req, res) => {
  try {
    console.log('📊 Запрос статистики');
    const stats = await getStats();
    console.log('✅ Статистика отправлена:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ Ошибка при получении статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/messages/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    console.log(`💬 Запрос сообщений для пользователя ${userId}`);
    const userMessages = await getMessages(userId);
    
    console.log(`✅ Отправлено ${userMessages.length} сообщений`);
    res.json({ messages: userMessages });
  } catch (error) {
    console.error('❌ Ошибка при получении сообщений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновленный endpoint для отправки сообщений с поддержкой медиафайлов
app.post('/api/send-message', upload.single('media'), async (req, res) => {
  try {
    let userId, message, inlineKeyboard, mediaCaption;
    
    // Проверяем, есть ли медиафайл (FormData) или это обычный JSON
    if (req.file) {
      // Запрос с медиафайлом
      userId = parseInt(req.body.userId);
      message = req.body.message;
      mediaCaption = req.body.mediaCaption;
      
      // Безопасная обработка inlineKeyboard для FormData
      if (req.body.inlineKeyboard && typeof req.body.inlineKeyboard === 'string') {
        try {
          inlineKeyboard = JSON.parse(req.body.inlineKeyboard);
        } catch (parseError) {
          console.error('❌ Ошибка парсинга inlineKeyboard:', parseError);
          inlineKeyboard = null;
        }
      } else {
        inlineKeyboard = req.body.inlineKeyboard || null;
      }
      
      console.log(`📤 Отправка медиафайла пользователю ${userId}: ${req.file.originalname}`);
      console.log(`📋 Тип файла: ${req.file.mimetype}, размер: ${req.file.size} байт`);
      
      // Определяем тип медиафайла и метод отправки
      let sendMethod;
      if (req.file.mimetype.startsWith('image/')) {
        sendMethod = 'sendPhoto';
      } else if (req.file.mimetype.startsWith('video/')) {
        sendMethod = 'sendVideo';
      } else {
        sendMethod = 'sendDocument';
      }
      
      console.log(`🎯 Используем метод: ${sendMethod}`);
      
      // Подготавливаем опции
      const options = {
        caption: mediaCaption || message || ''
      };
      
      // Добавляем инлайн клавиатуру если есть
      if (inlineKeyboard && Array.isArray(inlineKeyboard) && inlineKeyboard.length > 0) {
        options.reply_markup = {
          inline_keyboard: inlineKeyboard
        };
        console.log('⌨️ Добавлена инлайн клавиатура:', inlineKeyboard);
      }
      
      // Отправляем медиафайл через буфер
      console.log('📤 Отправка медиафайла через Telegram API...');
      await bot[sendMethod](userId, req.file.buffer, options);
      console.log('✅ Медиафайл успешно отправлен');
      
    } else {
      // Обычное текстовое сообщение
      const data = req.body;
      userId = data.userId;
      message = data.message;
      inlineKeyboard = data.inlineKeyboard;
      
      console.log(`📤 Отправка текстового сообщения пользователю ${userId}: ${message}`);
      
      if (!userId || !message) {
        return res.status(400).json({ error: 'Не указан userId или message' });
      }
      
      // Подготавливаем опции для сообщения
      const options = {};
      
      // Добавляем инлайн клавиатуру если есть
      if (inlineKeyboard && Array.isArray(inlineKeyboard) && inlineKeyboard.length > 0) {
        options.reply_markup = {
          inline_keyboard: inlineKeyboard
        };
        console.log('⌨️ Добавлена инлайн клавиатура:', inlineKeyboard);
      }
      
      // Отправляем текстовое сообщение
      await bot.sendMessage(userId, message, options);
    }
    
    // Сохраняем сообщение в базу данных
    await addMessage(userId, message || mediaCaption || 'Медиафайл', true, 'admin');
    
    console.log('✅ Сообщение отправлено и сохранено в БД');
    res.json({ success: true, message: 'Сообщение отправлено' });
  } catch (error) {
    console.error('❌ Ошибка при отправке сообщения:', error);
    
    if (error.code === 403) {
      await markUserAsBlocked(parseInt(userId));
      res.status(403).json({ error: 'Пользователь заблокировал бота' });
    } else {
      res.status(500).json({ error: 'Ошибка при отправке сообщения', details: error.message });
    }
  }
});

app.post('/api/broadcast', async (req, res) => {
  try {
    const { userIds, message } = req.body;
    console.log(`📢 Рассылка сообщения ${userIds.length} пользователям`);
    
    if (!userIds || !Array.isArray(userIds) || !message) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }
    
    let sent = 0;
    let errors = 0;
    
    for (const userId of userIds) {
      try {
        await bot.sendMessage(userId, message);
        await addMessage(userId, message, true, 'admin');
        sent++;
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Ошибка при отправке сообщения пользователю ${userId}:`, error);
        errors++;
        
        if (error.code === 403) {
          await markUserAsBlocked(userId);
        }
      }
    }
    
    console.log(`✅ Рассылка завершена: отправлено ${sent}, ошибок ${errors}`);
    res.json({ 
      success: true, 
      sent, 
      errors, 
      total: userIds.length,
      message: `Рассылка завершена. Отправлено: ${sent}, ошибок: ${errors}` 
    });
  } catch (error) {
    console.error('❌ Ошибка при рассылке:', error);
    res.status(500).json({ error: 'Ошибка при рассылке' });
  }
});

app.get('/api/join-requests', async (req, res) => {
  try {
    console.log('📋 Запрос заявок на вступление');
    const requests = await getJoinRequests();
    console.log(`✅ Отправлено ${requests.length} заявок`);
    res.json({ requests });
  } catch (error) {
    console.error('❌ Ошибка при получении запросов на вступление:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/approve-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    console.log(`✅ Одобрение заявки: chat ${chatId}, user ${userId}`);
    
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Не указан chatId или userId' });
    }
    
    await approveJoinRequest(chatId, userId);
    res.json({ success: true, message: 'Запрос одобрен' });
  } catch (error) {
    console.error('❌ Ошибка при одобрении запроса:', error);
    res.status(500).json({ error: 'Ошибка при одобрении запроса' });
  }
});

app.post('/api/decline-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    console.log(`❌ Отклонение заявки: chat ${chatId}, user ${userId}`);
    
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Не указан chatId или userId' });
    }
    
    await declineJoinRequest(chatId, userId);
    res.json({ success: true, message: 'Запрос отклонен' });
  } catch (error) {
    console.error('❌ Ошибка при отклонении запроса:', error);
    res.status(500).json({ error: 'Ошибка при отклонении запроса' });
  }
});

app.get('/api/subscriptions', async (req, res) => {
  try {
    console.log('💳 Запрос подписок');
    const subscriptions = await getAllSubscriptions();
    const users = await getAllUsers();
    
    const subscriptionsWithUsers = subscriptions.map(subscription => {
      const user = users.find(u => u.id === subscription.user_id);
      return {
        ...subscription,
        user: user ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        } : null
      };
    });
    
    console.log(`✅ Отправлено ${subscriptionsWithUsers.length} подписок`);
    res.json({ subscriptions: subscriptionsWithUsers });
  } catch (error) {
    console.error('❌ Ошибка при получении подписок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/payments', async (req, res) => {
  try {
    console.log('💰 Запрос платежей');
    const payments = await getAllPayments();
    const users = await getAllUsers();
    
    const paymentsWithUsers = payments.map(payment => {
      const user = users.find(u => u.id === payment.user_id);
      return {
        ...payment,
        user: user ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        } : null
      };
    });
    
    console.log(`✅ Отправлено ${paymentsWithUsers.length} платежей`);
    res.json({ payments: paymentsWithUsers });
  } catch (error) {
    console.error('❌ Ошибка при получении платежей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/update-subscription-status', async (req, res) => {
  try {
    const { subscriptionId, userId, status } = req.body;
    console.log(`🔄 Обновление статуса подписки ${subscriptionId} для пользователя ${userId} на ${status}`);
    
    if (!subscriptionId || !userId || !status) {
      return res.status(400).json({ error: 'Не указаны обязательные параметры' });
    }
    
    const success = await updateSubscriptionStatus(subscriptionId, userId, status);
    
    if (success) {
      console.log('✅ Статус подписки обновлен');
      res.json({ success: true, message: 'Статус подписки обновлен' });
    } else {
      res.status(404).json({ error: 'Подписка не найдена' });
    }
  } catch (error) {
    console.error('❌ Ошибка при обновлении статуса подписки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Эндпоинт для создания платежа
app.post('/api/create-payment', async (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`💳 Создание платежа для пользователя ${userId}`);
    
    if (!userId) {
      return res.status(400).json({ error: 'Не указан userId' });
    }
    
    const user = await getUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    console.log('👤 Найден пользователь:', user);
    
    const payment = await createSubscriptionPayment(userId, user);
    
    console.log('✅ Платеж создан успешно:', payment);
    res.json({ 
      success: true, 
      payment: {
        paymentId: payment.paymentId,
        confirmationUrl: payment.confirmationUrl,
        amount: payment.amount,
        status: payment.status
      }
    });
  } catch (error) {
    console.error('❌ Ошибка при создании платежа:', error);
    res.status(500).json({ 
      error: 'Ошибка при создании платежа',
      details: error.message 
    });
  }
});

// Новый эндпоинт для простого создания платежа
app.post('/api/create-simple-payment', async (req, res) => {
  try {
    const { userId, amount, description, returnUrl } = req.body;
    console.log(`💳 Создание простого платежа для пользователя ${userId}`);
    
    if (!userId || !amount) {
      return res.status(400).json({ error: 'Не указан userId или amount' });
    }
    
    const user = await getUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    // Создаем простой платеж без чека
    const payment = await createSimpleYukassaPayment(
      amount, 
      description || `Подписка для ${user.first_name}`,
      returnUrl || 'https://t.me/firstpunch_bot',
      {
        userId: userId.toString(),
        username: user.username || '',
        first_name: user.first_name || '',
        type: 'subscription'
      }
    );
    
    // Сохраняем платеж в базе данных
    await addPayment(userId, payment.paymentId, payment.amount, payment.status, payment.confirmationUrl);
    
    console.log('✅ Простой платеж создан:', payment);
    res.json({ 
      success: true, 
      paymentId: payment.paymentId,
      paymentUrl: payment.confirmationUrl,
      amount: payment.amount
    });
  } catch (error) {
    console.error('❌ Ошибка при создании простого платежа:', error);
    res.status(500).json({ 
      error: 'Ошибка при создании платежа',
      details: error.message 
    });
  }
});

// Эндпоинт для проверки статуса платежа
app.get('/api/check-payment-status/:paymentId', async (req, res) => {
  try {
    const { paymentId } = req.params;
    console.log(`🔍 Проверка статуса платежа: ${paymentId}`);
    
    const payment = await getYukassaPayment(paymentId);
    
    res.json({
      paymentId: payment.id,
      status: payment.status,
      amount: payment.amount.value
    });
  } catch (error) {
    console.error('❌ Ошибка при проверке статуса платежа:', error);
    res.status(500).json({ error: 'Ошибка при проверке статуса' });
  }
});

// Webhook для ЮKassa
app.post('/api/yukassa-webhook', async (req, res) => {
  try {
    console.log('🔔 Получен webhook от ЮKassa');
    
    const signature = req.headers['x-yookassa-signature'];
    const body = req.body.toString();
    
    const event = JSON.parse(body);
    console.log('📦 Данные webhook:', event);
    
    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      console.log(`💰 Платеж успешен: ${payment.id}`);
      
      // Обновляем статус платежа в базе данных
      await updatePaymentStatus(payment.id, 'succeeded');
      
      // Создаем подписку
      const userId = parseInt(payment.metadata.userId);
      const amount = parseFloat(payment.amount.value);
      
      if (userId) {
        await addSubscription(userId, payment.id, amount, 30);
        console.log(`✅ Подписка создана для пользователя ${userId}`);
        
        // Отправляем уведомление пользователю с кнопкой вступления в канал
        const endDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        const message = `🎉 Поздравляем! Ваша ежемесячная подписка на канал "Первый Панч" активирована!

💳 Платеж: ${amount}₽
📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}
🔄 Тип: Ежемесячная подписка

⚠️ ВАЖНО: Это НЕ автоплатеж! За день до окончания мы напомним вам о продлении.

Теперь вы можете подавать заявки на вступление в канал!`;

        const options = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
              ],
              [
                { text: '📊 Статус подписки', callback_data: 'subscription_status' }
              ]
            ]
          }
        };

        try {
          await bot.sendMessage(userId, message, options);
          await addMessage(userId, message, true, 'system');
        } catch (msgError) {
          console.error('❌ Ошибка отправки уведомления:', msgError);
        }
      }
    } else if (event.event === 'payment.canceled') {
      const payment = event.object;
      console.log(`❌ Платеж отменен: ${payment.id}`);
      await updatePaymentStatus(payment.id, 'cancelled');
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка обработки webhook:', error);
    res.status(500).json({ error: 'Ошибка обработки webhook' });
  }
});

// ==================== TELEGRAM BOT HANDLERS ====================

// Обработка запросов на вступление в канал
bot.on('chat_join_request', async (joinRequest) => {
  console.log('📥 Получен запрос на вступление:', joinRequest);
  
  try {
    await addOrUpdateUser(joinRequest.from);
    
    const hasActiveSubscription = await isSubscriptionActive(joinRequest.from.id);
    
    const requestData = {
      chatId: joinRequest.chat.id,
      chatTitle: joinRequest.chat.title,
      userId: joinRequest.from.id,
      status: hasActiveSubscription ? 'approved' : 'pending',
      date: new Date(joinRequest.date * 1000).toISOString(),
      processed_at: hasActiveSubscription ? new Date().toISOString() : null
    };
    
    await addJoinRequest(requestData);
    
    if (hasActiveSubscription) {
      try {
        await bot.approveChatJoinRequest(joinRequest.chat.id, joinRequest.from.id);
        console.log(`✅ Запрос автоматически одобрен для пользователя с активной подпиской ${joinRequest.from.first_name} (ID: ${joinRequest.from.id})`);
      } catch (error) {
        console.error('❌ Ошибка при автоматическом одобрении запроса:', error);
      }
    } else {
      console.log(`⏳ Новый запрос на вступление от ${joinRequest.from.first_name} (ID: ${joinRequest.from.id}) - подписка неактивна`);
      
      // Отправляем сообщение о необходимости подписки
      const message = `❌ Для вступления в канал "Первый Панч" необходима активная подписка.

💰 Стоимость: 10₽ в месяц
⏰ Срок: 30 дней
🔄 Без автопродления

Оформите подписку и повторите заявку на вступление.`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Оформить подписку', callback_data: 'get_subscription' }
            ],
            [
              { text: '📋 Подробнее о канале', callback_data: 'about_channel' }
            ]
          ]
        }
      };

      try {
        await bot.sendMessage(joinRequest.from.id, message, options);
        await addMessage(joinRequest.from.id, message, true, 'system');
      } catch (msgError) {
        console.error('❌ Ошибка отправки уведомления о подписке:', msgError);
      }
    }
  } catch (error) {
    console.error('❌ Ошибка при обработке запроса на вступление:', error);
  }
});

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  try {
    await addOrUpdateUser(user);
    await addMessage(chatId, '/start', false, 'command');
    
    const subscriptionInfo = await getSubscriptionInfo(user.id);
    
    let subscriptionText = '';
    let mainButton = { text: '💳 Оформить подписку', callback_data: 'get_subscription' };
    
    if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
      const endDate = new Date(subscriptionInfo.subscription.end_date);
      const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
      
      subscriptionText = `\n\n✅ *У вас активная ежемесячная подписка*
📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}
⏰ Осталось дней: ${daysLeft}
🔄 Без автопродления`;
      
      mainButton = { text: '📊 Управление подпиской', callback_data: 'subscription_management' };
    }
    
    const welcomeMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Ежемесячная подписка: 10 рублей на 30 дней*
🔄 *Без автопродления - полный контроль*${subscriptionText}

👇 *Выберите действие* 👇`;

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [mainButton],
          [
            { text: '📋 Подробнее о канале', callback_data: 'about_channel' }
          ],
          [
            { text: '💬 Обратная связь', callback_data: 'feedback' }
          ],
          [
            { text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }
          ]
        ]
      }
    };

    await bot.sendMessage(chatId, welcomeMessage, options);
    await addMessage(chatId, welcomeMessage, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка при обработке команды /start:', error);
  }
});

// Обработка команды /status
bot.onText(/\/status/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  try {
    await addOrUpdateUser(user);
    await addMessage(chatId, '/status', false, 'command');
    
    const subscriptionInfo = await getSubscriptionInfo(user.id);
    
    let statusMessage = '';
    let buttons = [];
    
    if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
      const endDate = new Date(subscriptionInfo.subscription.end_date);
      const startDate = new Date(subscriptionInfo.subscription.start_date);
      const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
      
      statusMessage = `📊 *Статус вашей подписки*

✅ *Статус:* Активна
💳 *Сумма платежа:* ${subscriptionInfo.subscription.amount}₽
📅 *Дата оплаты:* ${startDate.toLocaleDateString('ru-RU')}
⏰ *Действует до:* ${endDate.toLocaleDateString('ru-RU')}
🗓 *Осталось дней:* ${daysLeft}

🔄 *Тип подписки:* Ежемесячная (без автопродления)
⚠️ *Важно:* За день до окончания мы напомним о продлении

🚀 Вы можете подавать заявки на вступление в канал!`;

      buttons = [
        [
          { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
        ],
        [
          { text: '🚫 Отменить подписку', callback_data: 'cancel_subscription' }
        ],
        [
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ];
    } else {
      statusMessage = `📊 *Статус вашей подписки*

❌ *Статус:* Неактивна
💰 *Стоимость:* 10₽ на 30 дней
🔄 *Тип:* Ежемесячная (без автопродления)

Для получения доступа к каналу необходимо оформить подписку.`;

      buttons = [
        [
          { text: '💳 Оформить подписку', callback_data: 'get_subscription' }
        ],
        [
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ];
    }
    
    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: buttons
      }
    };
    
    await bot.sendMessage(chatId, statusMessage, options);
    await addMessage(chatId, statusMessage, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка при обработке команды /status:', error);
  }
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    try {
      await addOrUpdateUser(user);
      await addMessage(chatId, msg.text, false, 'text');
      
      const responses = [
        '👍 Понял тебя!',
        '🤔 Интересно...',
        '💬 Спасибо за сообщение!',
        '✨ Отлично!',
        '📝 Записал твоё сообщение.',
        '🚀 Получил информацию!'
      ];
      
      const randomResponse = responses[Math.floor(Math.random() * responses.length)];
      
      const options = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: '🏠 Главное меню', callback_data: 'main_menu' }
            ]
          ]
        }
      };
      
      await bot.sendMessage(chatId, randomResponse, options);
      await addMessage(chatId, randomResponse, true, 'text');
    } catch (error) {
      console.error('❌ Ошибка при обработке сообщения:', error);
    }
  }
});

// Обработка нажатий на кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const user = query.from;
  
  try {
    await addOrUpdateUser(user);
    await addMessage(chatId, `Нажата кнопка: ${data}`, false, 'button');
    
    let responseText = '';
    let options = {};
    
    switch (data) {
      case 'get_subscription':
        // Проверяем, есть ли уже активная подписка
        const subscriptionInfo = await getSubscriptionInfo(user.id);
        
        if (subscriptionInfo.isActive) {
          responseText = `✅ *У вас уже есть активная подписка!*

Ваша подписка действует до: *${new Date(subscriptionInfo.subscription.end_date).toLocaleDateString('ru-RU')}*

Вы можете подавать заявки на вступление в канал.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
                ],
                [
                  { text: '📊 Управление подпиской', callback_data: 'subscription_management' }
                ],
                [
                  { text: '🔙 Назад', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        } else {
          try {
            console.log('💳 Пользователь запросил создание платежа:', user);
            const payment = await createSubscriptionPayment(user.id, user);
            
            responseText = `💳 *Оформление ежемесячной подписки*

💰 Стоимость: *10 рублей*
⏰ Срок: *30 дней*
🔄 *Без автопродления* - полный контроль

Для оплаты нажмите кнопку ниже:`;
            
            options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '💳 Оплатить 10₽', url: payment.confirmationUrl }
                  ],
                  [
                    { text: '🔙 Назад', callback_data: 'main_menu' }
                  ]
                ]
              }
            };
          } catch (error) {
            console.error('❌ Ошибка создания платежа в боте:', error);
            responseText = `❌ *Ошибка создания платежа*

Попробуйте позже или обратитесь к администратору.

*Детали ошибки:* ${error.message}`;
            
            options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '👨‍💼 Связаться с админом', url: 'https://t.me/johnyestet' }
                  ],
                  [
                    { text: '🔙 Назад', callback_data: 'main_menu' }
                  ]
                ]
              }
            };
          }
        }
        break;

      case 'subscription_management':
      case 'subscription_status': {
        const subscription = await getUserSubscription(user.id);
        const isActive = await isSubscriptionActive(user.id);
        
        if (isActive && subscription) {
          const endDate = new Date(subscription.end_date);
          const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
          
          responseText = `📊 *Управление подпиской*

✅ *Статус:* Активна
📅 *Действует до:* ${endDate.toLocaleDateString('ru-RU')}
⏰ *Осталось дней:* ${daysLeft}
💳 *Сумма:* ${subscription.amount}₽

🔄 *Тип:* Ежемесячная подписка без автопродления
⚠️ *Важно:* За день до окончания мы напомним о продлении

Вы можете отменить подписку в любой момент.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
                ],
                [
                  { text: '🚫 Отменить подписку', callback_data: 'cancel_subscription' }
                ],
                [
                  { text: '🔙 Назад', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        } else {
          responseText = `❌ *Подписка неактивна*

У вас нет активной подписки на канал.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Оформить подписку', callback_data: 'get_subscription' }
                ],
                [
                  { text: '🔙 Назад', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        }
        break;
      }

      case 'cancel_subscription': {
        const isActive = await isSubscriptionActive(user.id);
        
        if (isActive) {
          responseText = `🚫 *Отмена подписки*

Вы уверены, что хотите отменить подписку?

⚠️ *Внимание:*
• Доступ к каналу будет закрыт
• Возврат средств не предусмотрен
• Подписку можно будет оформить заново

Подтвердите отмену подписки:`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '✅ Да, отменить подписку', callback_data: 'confirm_cancel_subscription' }
                ],
                [
                  { text: '❌ Нет, оставить подписку', callback_data: 'subscription_management' }
                ]
              ]
            }
          };
        } else {
          responseText = `❌ *Нет активной подписки*

У вас нет активной подписки для отмены.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Оформить подписку', callback_data: 'get_subscription' }
                ],
                [
                  { text: '🔙 Назад', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        }
        break;
      }

      case 'confirm_cancel_subscription': {
        const cancelled = await cancelUserSubscription(user.id);
        
        if (cancelled) {
          responseText = `✅ *Подписка отменена*

Ваша подписка успешно отменена.

• Доступ к каналу закрыт
• Вы можете оформить новую подписку в любое время
• Спасибо за то, что были с нами!`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '💳 Оформить новую подписку', callback_data: 'get_subscription' }
                ],
                [
                  { text: '🏠 Главное меню', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        } else {
          responseText = `❌ *Ошибка отмены*

Не удалось отменить подписку. Попробуйте позже или обратитесь к администратору.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '👨‍💼 Связаться с админом', url: 'https://t.me/johnyestet' }
                ],
                [
                  { text: '🔙 Назад', callback_data: 'subscription_management' }
                ]
              ]
            }
          };
        }
        break;
      }

      case 'join_channel':
        responseText = `🚀 *Вступление в канал*

Нажмите кнопку ниже, чтобы подать заявку на вступление в канал "Первый Панч".

Ваша заявка будет автоматически одобрена, так как у вас активная подписка!`;
        
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
              ],
              [
                { text: '🔙 Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        };
        break;
        
      case 'about_channel':
        responseText = `📋 *Подробнее о канале*

*Первый Панч* - это тренажерный клуб по юмору. Если ты хочешь научиться уверенно шутить и легко справляться с неловкими ситуациями - ты по адресу.

🎯 *Представь, что через пару недель ты:*
• Легко превращаешь любые неловкие ситуации в шутку
• Больше не думаешь: «А что сказать, чтобы было смешно?»
• Начал думать по-новому!

📚 *Что внутри:*
• Ежедневные короткие и полезные уроки по юмору, подаче, уверенности в разговоре
• Прямые эфиры со Стасом Ерником
• С первого дня доступ к тренажёрам по юмору, подборкам панчей и вебинарам

👥 И всё это среди людей, которые на одной волне: смеются над твоими шутками и помогают становиться лучше. Здесь нормально учиться, пробовать, ошибаться и становиться смешнее каждый день.

🏆 *А также ежедневный конкурс шуток!* Лучшая забирает 1000 рублей. Просто за хороший панч. В конце месяца супер приз. Победитель получает 100 000 рублей!

💰 *Всё это - всего за 10 рублей в месяц.*
🔄 *Без автопродления - полный контроль над подпиской*

🚀 *Попадая в Первый Панч ты:*
• Начинаешь понимать механику юмора
• Становишься увереннее
• Тебя больше слушают
• Легче заводишь новые знакомства

Это полезно и в работе, и в творчестве, и просто в жизни.

👇 *Ссылка на доступ ниже*`;
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💳 Оформить подписку', callback_data: 'get_subscription' }
              ],
              [
                { text: '🔙 Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        };
        break;
        
      case 'feedback':
        responseText = `💬 *Обратная связь*

Проверь «Ответы на популярные вопросы» — возможно решение уже там.

*Не нашёл?*

Нажми на кнопку ниже 👇`;
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🆘 Мне нужна помощь', url: 'https://t.me/johnyestet' }
              ],
              [
                { text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }
              ],
              [
                { text: '🔙 Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        };
        break;
        
      case 'main_menu': {
        const subscriptionInfo = await getSubscriptionInfo(user.id);
        
        let subscriptionText = '';
        let mainButton = { text: '💳 Оформить подписку', callback_data: 'get_subscription' };
        
        if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
          const endDate = new Date(subscriptionInfo.subscription.end_date);
          const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
          
          subscriptionText = `\n\n✅ *У вас активная ежемесячная подписка*
📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}
⏰ Осталось дней: ${daysLeft}
🔄 Без автопродления`;
          
          mainButton = { text: '📊 Управление подпиской', callback_data: 'subscription_management' };
        }
        
        responseText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Ежемесячная подписка: 10 рублей на 30 дней*
🔄 *Без автопродления - полный контроль*${subscriptionText}

👇 *Выберите действие* 👇`;
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [mainButton],
              [
                { text: '📋 Подробнее о канале', callback_data: 'about_channel' }
              ],
              [
                { text: '💬 Обратная связь', callback_data: 'feedback' }
              ],
              [
                { text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }
              ]
            ]
          }
        };
        break;
      }
    }
    
    if (responseText) {
      await bot.editMessageText(responseText, {
        chat_id: chatId,
        message_id: messageId,
        ...options
      });
      
      await addMessage(chatId, responseText, true, 'text');
    }
    
    await bot.answerCallbackQuery(query.id);
  } catch (error) {
    console.error('❌ Ошибка при обработке callback query:', error);
    await bot.answerCallbackQuery(query.id, { text: 'Произошла ошибка' });
  }
});

// Обработка ошибок
bot.on('error', (error) => {
  console.error('❌ Ошибка бота:', error);
});

bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.response && error.response.body) {
    let body;
    if (typeof error.response.body === 'string') {
      try {
        body = JSON.parse(error.response.body);
      } catch (parseError) {
        console.error('❌ Ошибка при парсинге JSON:', parseError);
        return;
      }
    } else {
      body = error.response.body;
    }
    
    if (body.description && body.description.includes('blocked')) {
      console.log('⚠️ Пользователь заблокировал бота');
    }
  }
});

// Обработка 404 - ДОЛЖНА БЫТЬ ПОСЛЕДНЕЙ!
app.use('*', (req, res) => {
  console.log(`❓ 404 запрос: ${req.method} ${req.originalUrl}`);
  res.status(404).json({ 
    error: 'Endpoint не найден',
    method: req.method,
    url: req.originalUrl,
    timestamp: new Date().toISOString()
  });
});

// Запуск сервера
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 =================================');
  console.log(`🌐 API сервер запущен на порту ${PORT}`);
  console.log(`🤖 Бот "Первый Панч" работает`);
  console.log(`📊 API доступен по адресу: /api`);
  console.log(`🏥 Health check: /health`);
  console.log(`💳 ЮKassa webhook: /api/yukassa-webhook`);
  console.log(`🗄️ База данных: Supabase PostgreSQL`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🔗 URL: https://telegram-bot-first-punch.onrender.com`);
  console.log('🚀 =================================');
});
