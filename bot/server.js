import express from 'express';
import cors from 'cors';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { createRecurringSubscription, processAutoPayment, getRecurringConfig } from './payments.js';
import { getYukassaPayment } from './yukassa.js';
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
  getStats,
  addPaymentMethod,
  getPaymentMethodByUserId,
  getActivePaymentMethods,
  updatePaymentMethodNextPayment,
  disablePaymentMethod
} from './lib/supabase.js';

// Получаем __dirname для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render автоматически назначает порт
const PORT = process.env.PORT || 10000;

const BOT_TOKEN = '7801546376:AAEr6x5nFu1aIdVUusPzZsJscdL6zzFF6bM';

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

// Middleware для webhook (должен быть ДО express.json())
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
    console.log(`🚫 Отмена рекуррентной подписки для пользователя ${userId}`);
    
    // Получаем активную подписку пользователя
    const subscription = await getUserSubscription(userId);
    
    if (subscription && subscription.status === 'active') {
      // Обновляем статус подписки на cancelled
      await updateSubscriptionStatus(subscription.id, userId, 'cancelled');
      
      // Отключаем автоплатежи
      const paymentMethod = await getPaymentMethodByUserId(userId);
      if (paymentMethod) {
        await disablePaymentMethod(userId, paymentMethod.payment_method_id);
      }
      
      console.log(`✅ Рекуррентная подписка отменена для пользователя ${userId}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('❌ Ошибка при отмене рекуррентной подписки:', error);
    return false;
  }
}

async function getSubscriptionInfo(userId) {
  try {
    const subscription = await getUserSubscription(userId);
    const isActive = await isSubscriptionActive(userId);
    const paymentMethod = await getPaymentMethodByUserId(userId);
    
    return {
      hasSubscription: !!subscription,
      isActive: isActive,
      subscription: subscription,
      paymentMethod: paymentMethod,
      isRecurring: !!paymentMethod?.auto_payments_enabled
    };
  } catch (error) {
    console.error('❌ Ошибка при получении информации о подписке:', error);
    return {
      hasSubscription: false,
      isActive: false,
      subscription: null,
      paymentMethod: null,
      isRecurring: false
    };
  }
}

// ==================== СИСТЕМА АВТОПЛАТЕЖЕЙ ====================

// Функция для обработки автоплатежей
async function processRecurringPayments() {
  try {
    console.log('🔄 Запуск обработки рекуррентных платежей...');
    
    const activePaymentMethods = await getActivePaymentMethods();
    console.log(`📋 Найдено активных способов оплаты: ${activePaymentMethods.length}`);
    
    const now = new Date();
    
    for (const paymentMethod of activePaymentMethods) {
      try {
        const nextPaymentDate = new Date(paymentMethod.next_payment_date);
        
        // Проверяем, пора ли создавать автоплатеж
        if (now >= nextPaymentDate) {
          console.log(`💳 Создание автоплатежа для пользователя ${paymentMethod.user_id}`);
          
          // Создаем автоплатеж
          const autoPayment = await processAutoPayment(
            paymentMethod.payment_method_id, 
            paymentMethod.user_id
          );
          
          if (autoPayment.status === 'succeeded') {
            // Если автоплатеж успешен, продлеваем подписку
            await addSubscription(
              paymentMethod.user_id,
              autoPayment.paymentId,
              autoPayment.amount,
              30, // 30 дней
              'yukassa'
            );
            
            // Обновляем дату следующего платежа (через 10 минут)
            const nextPayment = new Date(now.getTime() + 10 * 60 * 1000);
            await updatePaymentMethodNextPayment(
              paymentMethod.payment_method_id,
              nextPayment.toISOString()
            );
            
            // Отправляем уведомление пользователю
            await sendAutoPaymentSuccessMessage(paymentMethod.user_id, autoPayment.amount);
            
            console.log(`✅ Автоплатеж успешно обработан для пользователя ${paymentMethod.user_id}`);
          } else {
            console.log(`⚠️ Автоплатеж не прошел для пользователя ${paymentMethod.user_id}: ${autoPayment.status}`);
            
            // Если автоплатеж не прошел, отправляем уведомление
            await sendAutoPaymentFailedMessage(paymentMethod.user_id);
          }
        }
      } catch (error) {
        console.error(`❌ Ошибка обработки автоплатежа для пользователя ${paymentMethod.user_id}:`, error);
      }
    }
    
    console.log('✅ Обработка рекуррентных платежей завершена');
  } catch (error) {
    console.error('❌ Ошибка в системе автоплатежей:', error);
  }
}

// Запускаем обработку автоплатежей каждые 5 минут
setInterval(processRecurringPayments, 5 * 60 * 1000);

// Запускаем первую обработку через 1 минуту после старта
setTimeout(processRecurringPayments, 60 * 1000);

// ==================== API ENDPOINTS ====================

// Health check endpoint
app.get('/health', (req, res) => {
  console.log('🏥 Health check запрос получен');
  try {
    const recurringConfig = getRecurringConfig();
    res.status(200).json({ 
      status: 'ok', 
      service: 'telegram-bot-first-punch',
      timestamp: new Date().toISOString(),
      port: PORT,
      env: process.env.NODE_ENV || 'production',
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      database: 'supabase',
      paymentSystems: ['yukassa'],
      recurringPayments: {
        enabled: true,
        config: recurringConfig
      }
    });
  } catch (error) {
    console.error('❌ Health check error:', error);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Корневой endpoint
app.get('/', (req, res) => {
  console.log('🏠 Корневой запрос получен');
  const recurringConfig = getRecurringConfig();
  res.json({ 
    message: 'Telegram Bot "Первый Панч" API Server', 
    status: 'running',
    timestamp: new Date().toISOString(),
    database: 'supabase',
    paymentSystems: ['yukassa'],
    recurringPayments: {
      enabled: true,
      config: recurringConfig
    },
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
        const paymentMethod = await getPaymentMethodByUserId(user.id);
        return {
          ...user,
          subscription_active: hasActiveSubscription,
          has_recurring: !!paymentMethod?.auto_payments_enabled
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

app.post('/api/broadcast', upload.single('media'), async (req, res) => {
  try {
    let userIds, message, inlineKeyboard, mediaCaption;
    
    // Проверяем, есть ли медиафайл (FormData) или это обычный JSON
    if (req.file) {
      // Запрос с медиафайлом
      try {
        userIds = JSON.parse(req.body.userIds);
      } catch (parseError) {
        console.error('❌ Ошибка парсинга userIds:', parseError);
        return res.status(400).json({ error: 'Неверный формат userIds' });
      }
      
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
      
      console.log(`📢 Рассылка медиафайла ${userIds.length} пользователям: ${req.file.originalname}`);
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
      
    } else {
      // Обычное текстовое сообщение
      const data = req.body;
      userIds = data.userIds;
      message = data.message;
      inlineKeyboard = data.inlineKeyboard;
      
      console.log(`📢 Рассылка текстового сообщения ${userIds.length} пользователям`);
    }
    
    if (!userIds || !Array.isArray(userIds) || (!message && !req.file)) {
      return res.status(400).json({ error: 'Неверные параметры' });
    }
    
    let sent = 0;
    let errors = 0;
    
    for (const userId of userIds) {
      try {
        if (req.file) {
          // Отправляем медиафайл
          const options = {
            caption: mediaCaption || message || ''
          };
          
          // Добавляем инлайн клавиатуру если есть
          if (inlineKeyboard && Array.isArray(inlineKeyboard) && inlineKeyboard.length > 0) {
            options.reply_markup = {
              inline_keyboard: inlineKeyboard
            };
          }
          
          // Определяем метод отправки
          let sendMethod;
          if (req.file.mimetype.startsWith('image/')) {
            sendMethod = 'sendPhoto';
          } else if (req.file.mimetype.startsWith('video/')) {
            sendMethod = 'sendVideo';
          } else {
            sendMethod = 'sendDocument';
          }
          
          await bot[sendMethod](userId, req.file.buffer, options);
          await addMessage(userId, mediaCaption || message || 'Медиафайл', true, 'admin');
        } else {
          // Отправляем текстовое сообщение
          const options = {};
          
          // Добавляем инлайн клавиатуру если есть
          if (inlineKeyboard && Array.isArray(inlineKeyboard) && inlineKeyboard.length > 0) {
            options.reply_markup = {
              inline_keyboard: inlineKeyboard
            };
          }
          
          await bot.sendMessage(userId, message, options);
          await addMessage(userId, message, true, 'admin');
        }
        
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

// Эндпоинт для создания рекуррентной подписки
app.post('/api/create-payment', async (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`💳 Создание рекуррентной подписки для пользователя ${userId}`);
    
    if (!userId) {
      return res.status(400).json({ error: 'Не указан userId' });
    }
    
    const user = await getUser(userId);
    
    if (!user) {
      return res.status(404).json({ error: 'Пользователь не найден' });
    }
    
    console.log('👤 Найден пользователь:', user);
    
    const payment = await createRecurringSubscription(userId, user);
    
    console.log('✅ Рекуррентная подписка создана успешно:', payment);
    res.json({ 
      success: true, 
      payment: {
        paymentId: payment.paymentId,
        confirmationUrl: payment.confirmationUrl,
        amount: payment.amount,
        status: payment.status,
        paymentSystem: payment.paymentSystem,
        isRecurring: payment.isRecurring
      }
    });
  } catch (error) {
    console.error('❌ Ошибка при создании рекуррентной подписки:', error);
    res.status(500).json({ 
      error: 'Ошибка при создании рекуррентной подписки',
      details: error.message 
    });
  }
});

// Эндпоинт для получения конфигурации рекуррентных платежей
app.get('/api/recurring-config', (req, res) => {
  try {
    const config = getRecurringConfig();
    res.json({ config });
  } catch (error) {
    console.error('❌ Ошибка при получении конфигурации рекуррентных платежей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
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
      amount: payment.amount.value,
      paymentSystem: 'yukassa'
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
    console.log('📦 Данные webhook ЮKassa:', event);
    
    if (event.event === 'payment.succeeded') {
      const payment = event.object;
      console.log(`💰 Платеж ЮKassa успешен: ${payment.id}`);
      
      // Обновляем статус платежа в базе данных
      await updatePaymentStatus(payment.id, 'succeeded');
      
      const userId = parseInt(payment.metadata.userId);
      const amount = parseFloat(payment.amount.value);
      const paymentType = payment.metadata.payment_type;
      
      if (userId) {
        if (paymentType === 'recurring_initial') {
          // Это первый рекуррентный платеж - сохраняем способ оплаты
          if (payment.payment_method && payment.payment_method.id) {
            await addPaymentMethod(
              userId,
              payment.payment_method.id,
              payment.payment_method.type || 'card',
              payment.payment_method.card?.last4 ? `****${payment.payment_method.card.last4}` : null,
              true // Включаем автоплатежи
            );
            
            console.log(`✅ Способ оплаты сохранен для пользователя ${userId}: ${payment.payment_method.id}`);
          }
          
          // Создаем подписку
          await addSubscription(userId, payment.id, amount, 30, 'yukassa');
          console.log(`✅ Рекуррентная подписка создана для пользователя ${userId}`);
          
          // Отправляем уведомление об успешной подписке
          await sendRecurringSubscriptionSuccessMessage(userId, amount);
        } else if (paymentType === 'recurring_auto') {
          // Это автоплатеж - просто продлеваем подписку
          await addSubscription(userId, payment.id, amount, 30, 'yukassa');
          console.log(`✅ Подписка продлена автоплатежом для пользователя ${userId}`);
          
          // Отправляем уведомление об автоплатеже
          await sendAutoPaymentSuccessMessage(userId, amount);
        }
      }
    } else if (event.event === 'payment.canceled') {
      const payment = event.object;
      console.log(`❌ Платеж ЮKassa отменен: ${payment.id}`);
      await updatePaymentStatus(payment.id, 'cancelled');
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Ошибка обработки webhook ЮKassa:', error);
    res.status(500).json({ error: 'Ошибка обработки webhook' });
  }
});

// Функция для отправки уведомления об успешной рекуррентной подписке
async function sendRecurringSubscriptionSuccessMessage(userId, amount) {
  try {
    const recurringConfig = getRecurringConfig();
    const message = `🎉 Поздравляем! Ваша рекуррентная подписка на канал "Первый Панч" активирована!

💳 Стартовый платеж: ${amount}₽ через ЮKassa
🔄 Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽
📅 Подписка: активна

✨ ОСОБЕННОСТИ РЕКУРРЕНТНОЙ ПОДПИСКИ:
• Автоматическое продление каждые ${recurringConfig.intervalMinutes} минут
• Никаких перерывов в доступе к каналу
• Можете отменить в любой момент

Теперь вы можете подавать заявки на вступление в канал!`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
          ],
          [
            { text: '📊 Статус подписки', callback_data: 'subscription_status' }
          ],
          [
            { text: '🚫 Отменить автоплатежи', callback_data: 'cancel_subscription' }
          ]
        ]
      }
    };

    await bot.sendMessage(userId, message, options);
    await addMessage(userId, message, true, 'system');
  } catch (msgError) {
    console.error('❌ Ошибка отправки уведомления о рекуррентной подписке:', msgError);
  }
}

// Функция для отправки уведомления об успешном автоплатеже
async function sendAutoPaymentSuccessMessage(userId, amount) {
  try {
    const recurringConfig = getRecurringConfig();
    const message = `✅ Автоплатеж успешно выполнен!

💳 Списано: ${amount}₽
🔄 Следующий платеж: через ${recurringConfig.intervalMinutes} минут
📅 Подписка продлена на 30 дней

Ваш доступ к каналу "Первый Панч" продолжается без перерывов!`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '📊 Статус подписки', callback_data: 'subscription_status' }
          ],
          [
            { text: '🚫 Отменить автоплатежи', callback_data: 'cancel_subscription' }
          ]
        ]
      }
    };

    await bot.sendMessage(userId, message, options);
    await addMessage(userId, message, true, 'system');
  } catch (msgError) {
    console.error('❌ Ошибка отправки уведомления об автоплатеже:', msgError);
  }
}

// Функция для отправки уведомления о неудачном автоплатеже
async function sendAutoPaymentFailedMessage(userId) {
  try {
    const message = `❌ Автоплатеж не прошел

К сожалению, не удалось списать средства с вашей карты.

🔄 Возможные причины:
• Недостаточно средств на карте
• Карта заблокирована или истек срок действия
• Технические проблемы банка

💡 Что делать:
• Проверьте баланс карты
• Оформите новую подписку с актуальной картой

⚠️ Автоплатежи приостановлены до решения проблемы.`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Оформить новую подписку', callback_data: 'get_subscription_yukassa' }
          ],
          [
            { text: '📞 Связаться с поддержкой', url: 'https://t.me/johnyestet' }
          ]
        ]
      }
    };

    await bot.sendMessage(userId, message, options);
    await addMessage(userId, message, true, 'system');
  } catch (msgError) {
    console.error('❌ Ошибка отправки уведомления о неудачном автоплатеже:', msgError);
  }
}

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
      
      // Отправляем сообщение о необходимости рекуррентной подписки
      const recurringConfig = getRecurringConfig();
      const message = `❌ Для вступления в канал "Первый Панч" необходима активная рекуррентная подписка.

💰 Стоимость: ${recurringConfig.initialAmount}₽ стартовый платеж
🔄 Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽
⏰ Без перерывов в доступе к каналу

✨ ПРЕИМУЩЕСТВА РЕКУРРЕНТНОЙ ПОДПИСКИ:
• Автоматическое продление
• Никаких пропусков контента
• Можете отменить в любой момент

Нажмите кнопку ниже для оформления:`;

      const options = {
        reply_markup: {
          inline_keyboard: [
            [
              { text: `💳 Оформить рекуррентную подписку (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }
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
        console.error('❌ Ошибка отправки уведомления о рекуррентной подписке:', msgError);
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
    const recurringConfig = getRecurringConfig();
    
    let subscriptionText = '';
    let mainButtons = [];
    
    if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
      const endDate = new Date(subscriptionInfo.subscription.end_date);
      const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
      
      subscriptionText = `\n\n✅ *У вас активная рекуррентная подписка*
💳 Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽
📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}
⏰ Осталось дней: ${daysLeft}
🔄 Автоматическое продление включено`;
      
      mainButtons = [
        [{ text: '📊 Управление подпиской', callback_data: 'subscription_management' }],
        [{ text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }]
      ];
    } else {
      mainButtons = [
        [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }]
      ];
    }
    
    const welcomeMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Рекуррентная подписка: ${recurringConfig.initialAmount}₽ + автоплатежи ${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут*
🔄 *Автоматическое продление - никаких перерывов*${subscriptionText}

👇 *Выберите действие* 👇`;

    const additionalButtons = [
      [{ text: '📋 Подробнее о канале', callback_data: 'about_channel' }],
      [{ text: '💬 Обратная связь', callback_data: 'feedback' }],
      [{ text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }]
    ];

    const options = {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [...mainButtons, ...additionalButtons]
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
    const recurringConfig = getRecurringConfig();
    
    let statusMessage = '';
    let buttons = [];
    
    if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
      const endDate = new Date(subscriptionInfo.subscription.end_date);
      const startDate = new Date(subscriptionInfo.subscription.start_date);
      const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
      
      statusMessage = `📊 *Статус вашей рекуррентной подписки*

✅ *Статус:* Активна
💳 *Тип:* Рекуррентная подписка
💰 *Автоплатежи:* ${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут
📅 *Дата оплаты:* ${startDate.toLocaleDateString('ru-RU')}
⏰ *Действует до:* ${endDate.toLocaleDateString('ru-RU')}
🗓 *Осталось дней:* ${daysLeft}

🔄 *Автоматическое продление:* Включено
⚡ *Следующий автоплатеж:* В течение ${recurringConfig.intervalMinutes} минут

🚀 Вы можете подавать заявки на вступление в канал!`;

      buttons = [
        [{ text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
        [{ text: '🚫 Отменить автоплатежи', callback_data: 'cancel_subscription' }],
        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
      ];
    } else {
      statusMessage = `📊 *Статус вашей подписки*

❌ *Статус:* Неактивна
💰 *Стоимость:* ${recurringConfig.initialAmount}₽ + автоплатежи ${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут
🔄 *Тип:* Рекуррентная подписка с автопродлением

Для получения доступа к каналу необходимо оформить рекуррентную подписку.`;

      buttons = [
        [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }],
        [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
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
            [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
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
    
    const recurringConfig = getRecurringConfig();
    
    // Обработка создания рекуррентной подписки
    if (data === 'get_recurring_subscription') {
      // Проверяем, есть ли уже активная подписка
      const subscriptionInfo = await getSubscriptionInfo(user.id);
      
      if (subscriptionInfo.isActive) {
        responseText = `✅ *У вас уже есть активная рекуррентная подписка!*

Ваша подписка действует до: *${new Date(subscriptionInfo.subscription.end_date).toLocaleDateString('ru-RU')}*

Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽

Вы можете подавать заявки на вступление в канал.`;
        
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
              [{ text: '📊 Управление подпиской', callback_data: 'subscription_management' }],
              [{ text: '🔙 Назад', callback_data: 'main_menu' }]
            ]
          }
        };
      } else {
        try {
          console.log(`💳 Пользователь запросил создание рекуррентной подписки:`, user);
          const payment = await createRecurringSubscription(user.id, user);
          
          responseText = `💳 *Оформление рекуррентной подписки*

💰 Стартовый платеж: *${payment.amount} рублей*
🔄 Автоплатежи: *${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут*
⏰ Без перерывов в доступе к каналу

✨ ПРЕИМУЩЕСТВА:
• Автоматическое продление
• Никаких пропусков контента  
• Можете отменить в любой момент

Для оплаты нажмите кнопку ниже:`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Оплатить ${payment.amount}₽`, url: payment.confirmationUrl }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        } catch (error) {
          console.error('❌ Ошибка создания рекуррентной подписки в боте:', error);
          responseText = `❌ *Ошибка создания рекуррентной подписки*

Попробуйте позже или обратитесь в поддержку.

*Детали ошибки:* ${error.message}`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👨‍💼 Связаться с админом', url: 'https://t.me/johnyestet' }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        }
      }
    }
    
    // Остальные обработчики кнопок остаются без изменений...
    switch (data) {
      case 'subscription_management':
      case 'subscription_status': {
        const subscription = await getUserSubscription(user.id);
        const isActive = await isSubscriptionActive(user.id);
        const paymentMethod = await getPaymentMethodByUserId(user.id);
        
        if (isActive && subscription) {
          const endDate = new Date(subscription.end_date);
          const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
          
          responseText = `📊 *Управление рекуррентной подпиской*

✅ *Статус:* Активна
💳 *Тип:* Рекуррентная подписка
📅 *Действует до:* ${endDate.toLocaleDateString('ru-RU')}
⏰ *Осталось дней:* ${daysLeft}
💰 *Сумма:* ${subscription.amount}₽

🔄 *Автоплатежи:* ${paymentMethod?.auto_payments_enabled ? 'Включены' : 'Отключены'}
⚡ *Интервал:* каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽

Вы можете отменить автоплатежи в любой момент.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
                [{ text: '🚫 Отменить автоплатежи', callback_data: 'cancel_subscription' }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        } else {
          responseText = `❌ *Рекуррентная подписка неактивна*

У вас нет активной рекуррентной подписки на канал.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        }
        break;
      }

      case 'cancel_subscription': {
        const isActive = await isSubscriptionActive(user.id);
        
        if (isActive) {
          responseText = `🚫 *Отмена рекуррентной подписки*

Вы уверены, что хотите отменить автоплатежи?

⚠️ *Внимание:*
• Автоплатежи будут остановлены
• Текущая подписка будет действовать до окончания периода
• После окончания доступ к каналу будет закрыт
• Подписку можно будет оформить заново

Подтвердите отмену автоплатежей:`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '✅ Да, отменить автоплатежи', callback_data: 'confirm_cancel_subscription' }],
                [{ text: '❌ Нет, оставить подписку', callback_data: 'subscription_management' }]
              ]
            }
          };
        } else {
          responseText = `❌ *Нет активной подписки*

У вас нет активной рекуррентной подписки для отмены.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        }
        break;
      }

      case 'confirm_cancel_subscription': {
        const cancelled = await cancelUserSubscription(user.id);
        
        if (cancelled) {
          responseText = `✅ *Автоплатежи отменены*

Ваши автоплатежи успешно отменены.

• Текущая подписка будет действовать до окончания периода
• Новые списания не будут производиться
• Вы можете оформить новую подписку в любое время
• Спасибо за то, что были с нами!`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }],
                [{ text: '🏠 Главное меню', callback_data: 'main_menu' }]
              ]
            }
          };
        } else {
          responseText = `❌ *Ошибка отмены*

Не удалось отменить автоплатежи. Попробуйте позже или обратитесь к администратору.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [{ text: '👨‍💼 Связаться с админом', url: 'https://t.me/johnyestet' }],
                [{ text: '🔙 Назад', callback_data: 'subscription_management' }]
              ]
            }
          };
        }
        break;
      }

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

💰 *Рекуррентная подписка: ${recurringConfig.initialAmount}₽ + автоплатежи ${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут*
🔄 *Автоматическое продление - никаких перерывов в доступе*

🚀 *Попадая в Первый Панч ты:*
• Начинаешь понимать механику юмора
• Становишься увереннее
• Тебя больше слушают
• Легче заводишь новые знакомства

Это полезно и в работе, и в творчестве, и просто в жизни.

👇 *Оформить рекуррентную подписку*`;
        
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }],
              [{ text: '🔙 Назад', callback_data: 'main_menu' }]
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
              [{ text: '🆘 Мне нужна помощь', url: 'https://t.me/johnyestet' }],
              [{ text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }],
              [{ text: '🔙 Назад', callback_data: 'main_menu' }]
            ]
          }
        };
        break;
        
      case 'main_menu': {
        const subscriptionInfo = await getSubscriptionInfo(user.id);
        
        let subscriptionText = '';
        let mainButtons = [];
        
        if (subscriptionInfo.isActive && subscriptionInfo.subscription) {
          const endDate = new Date(subscriptionInfo.subscription.end_date);
          const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
          
          subscriptionText = `\n\n✅ *У вас активная рекуррентная подписка*
💳 Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽
📅 Действует до: ${endDate.toLocaleDateString('ru-RU')}
⏰ Осталось дней: ${daysLeft}
🔄 Автоматическое продление включено`;
          
          mainButtons = [
            [{ text: '📊 Управление подпиской', callback_data: 'subscription_management' }],
            [{ text: '🚀 Вступить в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }]
          ];
        } else {
          mainButtons = [
            [{ text: `💳 Рекуррентная подписка (${recurringConfig.initialAmount}₽)`, callback_data: 'get_recurring_subscription' }]
          ];
        }
        
        responseText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Рекуррентная подписка: ${recurringConfig.initialAmount}₽ + автоплатежи ${recurringConfig.recurringAmount}₽ каждые ${recurringConfig.intervalMinutes} минут*
🔄 *Автоматическое продление - никаких перерывов*${subscriptionText}

👇 *Выберите действие* 👇`;

        const additionalButtons = [
          [{ text: '📋 Подробнее о канале', callback_data: 'about_channel' }],
          [{ text: '💬 Обратная связь', callback_data: 'feedback' }],
          [{ text: '❓ Ответы на популярные вопросы', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }]
        ];

        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [...mainButtons, ...additionalButtons]
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
  const recurringConfig = getRecurringConfig();
  console.log('🚀 =================================');
  console.log(`🌐 API сервер запущен на порту ${PORT}`);
  console.log(`🤖 Бот "Первый Панч" работает`);
  console.log(`📊 API доступен по адресу: /api`);
  console.log(`🏥 Health check: /health`);
  console.log(`💳 ЮKassa webhook: /api/yukassa-webhook`);
  console.log(`🗄️ База данных: Supabase PostgreSQL`);
  console.log(`💰 Платежная система: ЮKassa (рекуррентные платежи)`);
  console.log(`🔄 Автоплатежи: каждые ${recurringConfig.intervalMinutes} минут по ${recurringConfig.recurringAmount}₽`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🔗 URL: https://telegram-bot-first-punch.onrender.com`);
  console.log('🚀 =================================');
});