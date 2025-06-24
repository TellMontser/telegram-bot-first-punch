import express from 'express';
import cors from 'cors';
import TelegramBot from 'node-telegram-bot-api';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { 
  addOrUpdateUser, 
  addMessage, 
  addJoinRequest, 
  updateJoinRequestStatus,
  addSubscription,
  isSubscriptionActive,
  addPayment,
  updatePaymentStatus,
  getPaymentByPaymentId,
  getAllUsers,
  getAllPayments,
  getAllSubscriptions,
  getMessages,
  getJoinRequests,
  getStats,
  updateSubscriptionStatus,
  markUserAsBlocked,
  getUser,
  updateUserPaymentData,
  getUserPaymentData,
  getUserPaymentMethods,
  disableAutoPayments
} from './lib/supabase.js';
import { createSubscriptionPayment, handleSuccessfulPayment } from './payments.js';
import { getYukassaPayment } from './yukassa.js';
import { getCryptoCloudInvoice, verifyCryptoCloudWebhook } from './cryptocloud.js';
import { startAutoPaymentScheduler } from './autopayments.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка CORS для работы с фронтендом
app.use(cors({
  origin: ['http://localhost:5173', 'https://telegram-bot-admin-panel.netlify.app'],
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Настройка multer для загрузки файлов
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Telegram Bot
const BOT_TOKEN = '7801546376:AAEr6x5nFu1aIdVUusPzZsJscdL6zzFF6bM';
const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ID канала
const CHANNEL_ID = -1002876590285;

console.log('🤖 Telegram бот запущен');

// Состояния пользователей для сбора данных
const userStates = new Map();

// Состояния для сбора данных
const STATES = {
  WAITING_EMAIL: 'waiting_email',
  WAITING_PHONE: 'waiting_phone', 
  WAITING_FULL_NAME: 'waiting_full_name',
  CONFIRMING_DATA: 'confirming_data'
};

// Функция для валидации email
function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// Функция для валидации телефона
function isValidPhone(phone) {
  const phoneRegex = /^(\+7|8)?[\s\-]?\(?[489][0-9]{2}\)?[\s\-]?[0-9]{3}[\s\-]?[0-9]{2}[\s\-]?[0-9]{2}$/;
  return phoneRegex.test(phone.replace(/[\s\-\(\)]/g, ''));
}

// Функция для форматирования телефона
function formatPhone(phone) {
  const cleaned = phone.replace(/[\s\-\(\)]/g, '');
  if (cleaned.startsWith('8')) {
    return '+7' + cleaned.substring(1);
  } else if (cleaned.startsWith('7')) {
    return '+' + cleaned;
  } else if (cleaned.startsWith('+7')) {
    return cleaned;
  }
  return '+7' + cleaned;
}

// Функция для начала сбора данных
async function startDataCollection(userId, paymentSystem = 'yukassa', enableAuto = false) {
  try {
    // Проверяем, есть ли уже данные у пользователя
    const existingData = await getUserPaymentData(userId);
    
    if (existingData && existingData.email && existingData.phone && existingData.full_name) {
      // Данные уже есть, сразу создаем платеж
      await createPaymentWithData(userId, paymentSystem, enableAuto);
      return;
    }

    // Сохраняем параметры платежа в состоянии
    userStates.set(userId, {
      state: STATES.WAITING_EMAIL,
      paymentSystem,
      enableAuto,
      data: {
        email: existingData?.email || '',
        phone: existingData?.phone || '',
        full_name: existingData?.full_name || ''
      }
    });

    const message = `📋 *Для создания чека нужны ваши данные*

Пожалуйста, укажите ваш email для отправки чека:

_Пример: ivan@example.com_`;

    await bot.sendMessage(userId, message, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '❌ Отмена', callback_data: 'cancel_payment' }]
        ]
      }
    });

    await addMessage(userId, message, true, 'data_collection');
  } catch (error) {
    console.error('❌ Ошибка начала сбора данных:', error);
    await bot.sendMessage(userId, '❌ Произошла ошибка. Попробуйте позже.');
  }
}

// Функция для создания платежа с собранными данными
async function createPaymentWithData(userId, paymentSystem, enableAuto) {
  try {
    const user = await getUser(userId);
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    const payment = await createSubscriptionPayment(userId, user, paymentSystem, enableAuto);
    
    const systemName = paymentSystem === 'cryptocloud' ? 'CryptoCloud' : 'ЮKassa';
    const autoText = enableAuto ? ' с автоплатежами' : '';
    
    const message = `✅ *Платеж создан через ${systemName}${autoText}*

💰 Сумма: ${payment.amount}₽
🔗 Для оплаты перейдите по ссылке ниже:

${payment.confirmationUrl}

${enableAuto ? '🔄 После первой оплаты будут включены автоплатежи каждые 5 минут' : ''}`;

    const keyboard = [
      [{ text: '💳 Перейти к оплате', url: payment.confirmationUrl }]
    ];

    if (enableAuto) {
      keyboard.push([{ text: '📊 Статус подписки', callback_data: 'subscription_status' }]);
    }

    await bot.sendMessage(userId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

    await addMessage(userId, message, true, 'payment_created');
    
    // Очищаем состояние
    userStates.delete(userId);
    
  } catch (error) {
    console.error('❌ Ошибка создания платежа:', error);
    await bot.sendMessage(userId, `❌ Ошибка создания платежа: ${error.message}`);
    userStates.delete(userId);
  }
}

// Обработка текстовых сообщений для сбора данных
async function handleDataCollection(userId, text) {
  const userState = userStates.get(userId);
  if (!userState) return false;

  try {
    switch (userState.state) {
      case STATES.WAITING_EMAIL:
        if (!isValidEmail(text)) {
          await bot.sendMessage(userId, '❌ Неверный формат email. Пожалуйста, введите корректный email:');
          return true;
        }
        
        userState.data.email = text.toLowerCase();
        userState.state = STATES.WAITING_PHONE;
        
        await bot.sendMessage(userId, `✅ Email сохранен: ${text}

📱 Теперь укажите ваш номер телефона:

_Пример: +7 999 123 45 67 или 8 999 123 45 67_`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отмена', callback_data: 'cancel_payment' }]
            ]
          }
        });
        return true;

      case STATES.WAITING_PHONE:
        if (!isValidPhone(text)) {
          await bot.sendMessage(userId, '❌ Неверный формат телефона. Пожалуйста, введите корректный номер телефона:');
          return true;
        }
        
        userState.data.phone = formatPhone(text);
        userState.state = STATES.WAITING_FULL_NAME;
        
        await bot.sendMessage(userId, `✅ Телефон сохранен: ${userState.data.phone}

👤 Теперь укажите ваше полное ФИО:

_Пример: Иванов Иван Иванович_`, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '❌ Отмена', callback_data: 'cancel_payment' }]
            ]
          }
        });
        return true;

      case STATES.WAITING_FULL_NAME:
        if (text.trim().length < 3) {
          await bot.sendMessage(userId, '❌ ФИО слишком короткое. Пожалуйста, введите полное ФИО:');
          return true;
        }
        
        userState.data.full_name = text.trim();
        userState.state = STATES.CONFIRMING_DATA;
        
        const confirmMessage = `📋 *Проверьте ваши данные:*

📧 Email: ${userState.data.email}
📱 Телефон: ${userState.data.phone}
👤 ФИО: ${userState.data.full_name}

Все данные верны?`;

        await bot.sendMessage(userId, confirmMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Да, все верно', callback_data: 'confirm_data' },
                { text: '✏️ Изменить', callback_data: 'edit_data' }
              ],
              [{ text: '❌ Отмена', callback_data: 'cancel_payment' }]
            ]
          }
        });
        return true;
    }
  } catch (error) {
    console.error('❌ Ошибка обработки сбора данных:', error);
    await bot.sendMessage(userId, '❌ Произошла ошибка. Попробуйте позже.');
    userStates.delete(userId);
  }

  return false;
}

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const user = msg.from;

  try {
    await addOrUpdateUser(user);
    await addMessage(userId, '/start', false, 'command');

    const message = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;

    const keyboard = [
      [{ text: '💳 Обычная подписка (10₽)', callback_data: 'get_subscription_yukassa' }],
      [{ text: '🔄 Автоподписка (10₽)', callback_data: 'get_auto_subscription_yukassa' }],
      [{ text: '₿ Криптоплатеж (50₽)', callback_data: 'get_subscription_cryptocloud' }],
      [{ text: '📋 О канале', callback_data: 'about_channel' }],
      [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }],
      [{ text: '🚫 Отключить автоплатежи', callback_data: 'disable_autopayments' }]
    ];

    await bot.sendMessage(userId, message, {
      parse_mode: 'Markdown',
      reply_markup: { inline_keyboard: keyboard }
    });

    await addMessage(userId, message, true, 'welcome');
  } catch (error) {
    console.error('Ошибка обработки /start:', error);
    await bot.sendMessage(userId, '❌ Произошла ошибка. Попробуйте позже.');
  }
});

// Обработка текстовых сообщений
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return; // Игнорируем команды

  const userId = msg.from.id;
  const text = msg.text;

  try {
    await addOrUpdateUser(msg.from);
    await addMessage(userId, text, false, 'text');

    // Проверяем, находится ли пользователь в процессе сбора данных
    if (await handleDataCollection(userId, text)) {
      return; // Сообщение обработано в рамках сбора данных
    }

    // Обычная обработка сообщений
    const message = `Спасибо за сообщение! 

Для получения доступа к каналу "Первый Панч" оформите подписку:`;

    const keyboard = [
      [{ text: '💳 Обычная подписка (10₽)', callback_data: 'get_subscription_yukassa' }],
      [{ text: '🔄 Автоподписка (10₽)', callback_data: 'get_auto_subscription_yukassa' }],
      [{ text: '₿ Криптоплатеж (50₽)', callback_data: 'get_subscription_cryptocloud' }],
      [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }]
    ];

    await bot.sendMessage(userId, message, {
      reply_markup: { inline_keyboard: keyboard }
    });

    await addMessage(userId, message, true, 'auto_reply');
  } catch (error) {
    console.error('Ошибка обработки сообщения:', error);
  }
});

// Обработка callback запросов
bot.on('callback_query', async (callbackQuery) => {
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  const messageId = callbackQuery.message.message_id;

  try {
    await addOrUpdateUser(callbackQuery.from);
    await addMessage(userId, `Нажата кнопка: ${data}`, false, 'button');

    switch (data) {
      case 'get_subscription_yukassa':
        await startDataCollection(userId, 'yukassa', false);
        break;

      case 'get_auto_subscription_yukassa':
        await startDataCollection(userId, 'yukassa', true);
        break;

      case 'get_subscription_cryptocloud':
        await startDataCollection(userId, 'cryptocloud', false);
        break;

      case 'confirm_data':
        const userState = userStates.get(userId);
        if (userState && userState.state === STATES.CONFIRMING_DATA) {
          // Сохраняем данные в базу
          await updateUserPaymentData(userId, userState.data);
          
          // Создаем платеж
          await createPaymentWithData(userId, userState.paymentSystem, userState.enableAuto);
        }
        break;

      case 'edit_data':
        const editState = userStates.get(userId);
        if (editState) {
          editState.state = STATES.WAITING_EMAIL;
          await bot.sendMessage(userId, '✏️ Давайте заново введем ваши данные.\n\nУкажите ваш email:');
        }
        break;

      case 'cancel_payment':
        userStates.delete(userId);
        await bot.sendMessage(userId, '❌ Оплата отменена. Вы можете начать заново в любое время.');
        break;

      case 'disable_autopayments':
        try {
          const paymentMethods = await getUserPaymentMethods(userId);
          let disabledCount = 0;
          
          for (const method of paymentMethods) {
            if (method.auto_payments_enabled) {
              await disableAutoPayments(method.payment_method_id);
              disabledCount++;
            }
          }
          
          const disableMessage = disabledCount > 0 
            ? `🚫 Автоплатежи отключены!

Отключено способов оплаты: ${disabledCount}

Ваша текущая подписка остается активной до окончания срока действия.`
            : `ℹ️ У вас нет активных автоплатежей.

Все способы оплаты уже отключены или не настроены.`;

          await bot.sendMessage(userId, disableMessage, {
            reply_markup: {
              inline_keyboard: [
                [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }],
                [{ text: '🔙 Главное меню', callback_data: 'main_menu' }]
              ]
            }
          });

          await addMessage(userId, disableMessage, true, 'autopayments_disabled');
        } catch (error) {
          console.error('❌ Ошибка отключения автоплатежей:', error);
          await bot.sendMessage(userId, '❌ Ошибка при отключении автоплатежей. Попробуйте позже.');
        }
        break;

      case 'about_channel':
        const aboutMessage = `📋 *Подробнее о канале*

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

🚀 *Попадая в Первый Панч ты:*
• Начинаешь понимать механику юмора
• Становишься увереннее
• Тебя больше слушают
• Легче заводишь новые знакомства

Это полезно и в работе, и в творчестве, и просто в жизни.

👇 *Ссылка на доступ ниже*`;

        const aboutKeyboard = [
          [{ text: '💳 Оформить подписку', callback_data: 'get_subscription_yukassa' }],
          [{ text: '🔄 Автоподписка', callback_data: 'get_auto_subscription_yukassa' }],
          [{ text: '🔙 Главное меню', callback_data: 'main_menu' }]
        ];

        await bot.editMessageText(aboutMessage, {
          chat_id: userId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: aboutKeyboard }
        });
        break;

      case 'subscription_status':
        const isActive = await isSubscriptionActive(userId);
        const statusMessage = isActive 
          ? `✅ *Ваша подписка активна!*

🚀 Добро пожаловать в канал "Первый Панч"!

Переходите по ссылке для доступа к контенту:`
          : `❌ *Подписка не активна*

Для получения доступа к каналу оформите подписку:`;

        const statusKeyboard = isActive 
          ? [
              [{ text: '🚀 Перейти в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
              [{ text: '🚫 Отключить автоплатежи', callback_data: 'disable_autopayments' }],
              [{ text: '🔙 Главное меню', callback_data: 'main_menu' }]
            ]
          : [
              [{ text: '💳 Оформить подписку', callback_data: 'get_subscription_yukassa' }],
              [{ text: '🔄 Автоподписка', callback_data: 'get_auto_subscription_yukassa' }],
              [{ text: '🔙 Главное меню', callback_data: 'main_menu' }]
            ];

        await bot.editMessageText(statusMessage, {
          chat_id: userId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: statusKeyboard }
        });
        break;

      case 'main_menu':
        const mainMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;

        const mainKeyboard = [
          [{ text: '💳 Обычная подписка (10₽)', callback_data: 'get_subscription_yukassa' }],
          [{ text: '🔄 Автоподписка (10₽)', callback_data: 'get_auto_subscription_yukassa' }],
          [{ text: '₿ Криптоплатеж (50₽)', callback_data: 'get_subscription_cryptocloud' }],
          [{ text: '📋 О канале', callback_data: 'about_channel' }],
          [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }]
        ];

        await bot.editMessageText(mainMessage, {
          chat_id: userId,
          message_id: messageId,
          parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: mainKeyboard }
        });
        break;

      default:
        console.log('Неизвестный callback:', data);
    }

    await bot.answerCallbackQuery(callbackQuery.id);
  } catch (error) {
    console.error('Ошибка обработки callback:', error);
    await bot.answerCallbackQuery(callbackQuery.id, { text: 'Произошла ошибка' });
  }
});

// Обработка заявок на вступление в канал
bot.on('chat_join_request', async (joinRequest) => {
  const userId = joinRequest.from.id;
  const chatId = joinRequest.chat.id;
  const chatTitle = joinRequest.chat.title;
  const requestDate = new Date(joinRequest.date * 1000).toISOString();

  try {
    console.log(`📥 Новая заявка на вступление от пользователя ${userId} в чат ${chatTitle}`);

    await addOrUpdateUser(joinRequest.from);

    await addJoinRequest({
      chatId: chatId,
      chatTitle: chatTitle,
      userId: userId,
      date: requestDate,
      status: 'pending'
    });

    // Проверяем статус подписки
    const hasActiveSubscription = await isSubscriptionActive(userId);

    if (hasActiveSubscription) {
      // Одобряем заявку
      await bot.approveChatJoinRequest(chatId, userId);
      await updateJoinRequestStatus(chatId, userId, 'approved');
      
      console.log(`✅ Заявка одобрена для пользователя ${userId} с активной подпиской`);

      // Отправляем приветственное сообщение
      const welcomeMessage = `🎉 *Добро пожаловать в "Первый Панч"!*

Ваша заявка одобрена! Теперь у вас есть доступ к каналу.

🚀 Переходите в канал и наслаждайтесь контентом!`;

      await bot.sendMessage(userId, welcomeMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🚀 Перейти в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }]
          ]
        }
      });

      await addMessage(userId, welcomeMessage, true, 'join_approved');
    } else {
      // Отклоняем заявку
      await bot.declineChatJoinRequest(chatId, userId);
      await updateJoinRequestStatus(chatId, userId, 'declined');
      
      console.log(`❌ Заявка отклонена для пользователя ${userId} без активной подписки`);

      // Отправляем сообщение о необходимости подписки
      const subscriptionMessage = `❌ *Заявка отклонена*

Для доступа к каналу "Первый Панч" необходима активная подписка.

💰 Стоимость: всего 10 рублей на 30 дней

👇 Оформите подписку прямо сейчас:`;

      const keyboard = [
        [{ text: '💳 Обычная подписка (10₽)', callback_data: 'get_subscription_yukassa' }],
        [{ text: '🔄 Автоподписка (10₽)', callback_data: 'get_auto_subscription_yukassa' }],
        [{ text: '₿ Криптоплатеж (50₽)', callback_data: 'get_subscription_cryptocloud' }]
      ];

      await bot.sendMessage(userId, subscriptionMessage, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: keyboard }
      });

      await addMessage(userId, subscriptionMessage, true, 'join_declined');
    }
  } catch (error) {
    console.error('Ошибка обработки заявки на вступление:', error);
  }
});

// Обработка блокировки бота пользователем
bot.on('my_chat_member', async (update) => {
  const userId = update.from.id;
  const newStatus = update.new_chat_member.status;

  if (newStatus === 'kicked') {
    try {
      console.log(`🚫 Пользователь ${userId} заблокировал бота`);
      await markUserAsBlocked(userId);
    } catch (error) {
      console.error('Ошибка при обработке блокировки:', error);
    }
  }
});

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bot: 'running',
    database: 'connected'
  });
});

// Получение пользователей
app.get('/api/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    res.json({ users });
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение статистики
app.get('/api/stats', async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение сообщений пользователя
app.get('/api/messages/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const messages = await getMessages(userId);
    res.json({ messages });
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отправка сообщения пользователю
app.post('/api/send-message', upload.single('media'), async (req, res) => {
  try {
    const { userId, message, mediaCaption, inlineKeyboard } = req.body;
    const mediaFile = req.file;

    if (!userId || (!message && !mediaFile)) {
      return res.status(400).json({ error: 'Не указан userId или сообщение' });
    }

    const parsedUserId = parseInt(userId);
    let options = {};

    // Добавляем инлайн клавиатуру если есть
    if (inlineKeyboard) {
      try {
        const keyboard = typeof inlineKeyboard === 'string' ? JSON.parse(inlineKeyboard) : inlineKeyboard;
        options.reply_markup = { inline_keyboard: keyboard };
      } catch (e) {
        console.error('Ошибка парсинга клавиатуры:', e);
      }
    }

    if (mediaFile) {
      // Отправляем медиафайл
      const caption = mediaCaption || message || '';
      
      if (mediaFile.mimetype.startsWith('image/')) {
        await bot.sendPhoto(parsedUserId, mediaFile.path, { caption, ...options });
      } else if (mediaFile.mimetype.startsWith('video/')) {
        await bot.sendVideo(parsedUserId, mediaFile.path, { caption, ...options });
      } else {
        await bot.sendDocument(parsedUserId, mediaFile.path, { caption, ...options });
      }

      // Удаляем временный файл
      fs.unlinkSync(mediaFile.path);
      
      await addMessage(parsedUserId, caption || 'Медиафайл', true, 'media');
    } else {
      // Отправляем текстовое сообщение
      await bot.sendMessage(parsedUserId, message, options);
      await addMessage(parsedUserId, message, true, 'admin');
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: error.message });
  }
});

// Рассылка сообщений
app.post('/api/broadcast', upload.single('media'), async (req, res) => {
  try {
    const { userIds, message, mediaCaption, inlineKeyboard } = req.body;
    const mediaFile = req.file;

    if (!userIds || (!message && !mediaFile)) {
      return res.status(400).json({ error: 'Не указаны userIds или сообщение' });
    }

    const parsedUserIds = typeof userIds === 'string' ? JSON.parse(userIds) : userIds;
    let options = {};

    // Добавляем инлайн клавиатуру если есть
    if (inlineKeyboard) {
      try {
        const keyboard = typeof inlineKeyboard === 'string' ? JSON.parse(inlineKeyboard) : inlineKeyboard;
        options.reply_markup = { inline_keyboard: keyboard };
      } catch (e) {
        console.error('Ошибка парсинга клавиатуры:', e);
      }
    }

    let successCount = 0;
    let errorCount = 0;

    for (const userId of parsedUserIds) {
      try {
        const parsedUserId = parseInt(userId);
        
        if (mediaFile) {
          const caption = mediaCaption || message || '';
          
          if (mediaFile.mimetype.startsWith('image/')) {
            await bot.sendPhoto(parsedUserId, mediaFile.path, { caption, ...options });
          } else if (mediaFile.mimetype.startsWith('video/')) {
            await bot.sendVideo(parsedUserId, mediaFile.path, { caption, ...options });
          } else {
            await bot.sendDocument(parsedUserId, mediaFile.path, { caption, ...options });
          }
          
          await addMessage(parsedUserId, caption || 'Медиафайл', true, 'broadcast');
        } else {
          await bot.sendMessage(parsedUserId, message, options);
          await addMessage(parsedUserId, message, true, 'broadcast');
        }
        
        successCount++;
        
        // Небольшая задержка между отправками
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Ошибка отправки пользователю ${userId}:`, error);
        errorCount++;
      }
    }

    // Удаляем временный файл если был
    if (mediaFile) {
      fs.unlinkSync(mediaFile.path);
    }

    res.json({ 
      success: true, 
      sent: successCount, 
      errors: errorCount,
      total: parsedUserIds.length 
    });
  } catch (error) {
    console.error('Ошибка рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение заявок на вступление
app.get('/api/join-requests', async (req, res) => {
  try {
    const requests = await getJoinRequests();
    res.json({ requests });
  } catch (error) {
    console.error('Ошибка получения заявок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Одобрение заявки на вступление
app.post('/api/approve-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Не указаны chatId или userId' });
    }

    await bot.approveChatJoinRequest(chatId, userId);
    await updateJoinRequestStatus(chatId, userId, 'approved');

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка одобрения заявки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Отклонение заявки на вступление
app.post('/api/decline-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;

    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Не указаны chatId или userId' });
    }

    await bot.declineChatJoinRequest(chatId, userId);
    await updateJoinRequestStatus(chatId, userId, 'declined');

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отклонения заявки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение подписок
app.get('/api/subscriptions', async (req, res) => {
  try {
    const subscriptions = await getAllSubscriptions();
    res.json({ subscriptions });
  } catch (error) {
    console.error('Ошибка получения подписок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение платежей
app.get('/api/payments', async (req, res) => {
  try {
    const payments = await getAllPayments();
    res.json({ payments });
  } catch (error) {
    console.error('Ошибка получения платежей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновление статуса подписки
app.post('/api/update-subscription-status', async (req, res) => {
  try {
    const { subscriptionId, userId, status } = req.body;

    if (!subscriptionId || !userId || !status) {
      return res.status(400).json({ error: 'Не указаны обязательные параметры' });
    }

    await updateSubscriptionStatus(subscriptionId, userId, status);
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка обновления статуса подписки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Webhook для ЮKassa
app.post('/webhook/yukassa', async (req, res) => {
  try {
    console.log('📥 Получен webhook от ЮKassa:', JSON.stringify(req.body, null, 2));
    
    const { type, object } = req.body;
    
    if (type === 'payment.succeeded') {
      const payment = object;
      const userId = parseInt(payment.metadata.userId);
      const enableAutoPayments = payment.metadata.autoPayment === 'true';
      
      console.log(`💰 Платеж успешен: ${payment.id} для пользователя ${userId}`);
      
      // Обновляем статус платежа в базе
      await updatePaymentStatus(payment.id, 'succeeded');
      
      // Обрабатываем успешный платеж (сохраняем способ оплаты если нужно)
      await handleSuccessfulPayment(payment, enableAutoPayments);
      
      // Создаем подписку
      await addSubscription(
        userId,
        payment.id,
        parseFloat(payment.amount.value),
        30, // 30 дней
        'yukassa',
        payment.payment_method?.id || null
      );
      
      // Отправляем уведомление пользователю
      const user = await getUser(userId);
      if (user) {
        const message = enableAutoPayments 
          ? `✅ Платеж успешно выполнен!

💳 Списано: ${payment.amount.value}₽
📅 Подписка активна на 30 дней
🔄 Автоплатежи включены (каждые 5 минут)

Теперь вы можете подать заявку на вступление в канал!`
          : `✅ Платеж успешно выполнен!

💳 Списано: ${payment.amount.value}₽
📅 Подписка активна на 30 дней

Теперь вы можете подать заявку на вступление в канал!`;

        const keyboard = [
          [{ text: '🚀 Перейти в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
          [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }]
        ];

        if (enableAutoPayments) {
          keyboard.push([{ text: '🚫 Отключить автоплатежи', callback_data: 'disable_autopayments' }]);
        }

        await bot.sendMessage(userId, message, {
          reply_markup: { inline_keyboard: keyboard }
        });

        await addMessage(userId, message, true, 'payment_success');
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка обработки webhook ЮKassa:', error);
    res.status(500).send('Error');
  }
});

// Webhook для CryptoCloud
app.post('/webhook/cryptocloud', async (req, res) => {
  try {
    console.log('📥 Получен webhook от CryptoCloud:', JSON.stringify(req.body, null, 2));
    
    const signature = req.headers['x-signature'];
    const body = JSON.stringify(req.body);
    
    // Проверяем подпись (опционально)
    // if (!verifyCryptoCloudWebhook(body, signature)) {
    //   return res.status(400).send('Invalid signature');
    // }
    
    const { status, uuid, order_id, amount_crypto, amount_rub } = req.body;
    
    if (status === 'paid') {
      // Находим платеж по order_id или uuid
      const payment = await getPaymentByPaymentId(uuid);
      
      if (payment) {
        const userId = payment.user_id;
        
        console.log(`💰 CryptoCloud платеж успешен: ${uuid} для пользователя ${userId}`);
        
        // Обновляем статус платежа
        await updatePaymentStatus(uuid, 'succeeded');
        
        // Создаем подписку
        await addSubscription(
          userId,
          uuid,
          parseFloat(amount_rub || payment.amount),
          30, // 30 дней
          'cryptocloud'
        );
        
        // Отправляем уведомление пользователю
        const user = await getUser(userId);
        if (user) {
          const message = `✅ Криптоплатеж успешно выполнен!

💰 Списано: ${amount_rub || payment.amount}₽
📅 Подписка активна на 30 дней

Теперь вы можете подать заявку на вступление в канал!`;

          const keyboard = [
            [{ text: '🚀 Перейти в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }],
            [{ text: '📊 Статус подписки', callback_data: 'subscription_status' }]
          ];

          await bot.sendMessage(userId, message, {
            reply_markup: { inline_keyboard: keyboard }
          });

          await addMessage(userId, message, true, 'payment_success');
        }
      }
    }
    
    res.status(200).send('OK');
  } catch (error) {
    console.error('Ошибка обработки webhook CryptoCloud:', error);
    res.status(500).send('Error');
  }
});

// Запуск планировщика автоплатежей
startAutoPaymentScheduler();

// Запуск сервера
app.listen(PORT, () => {
  console.log(`🚀 Сервер запущен на порту ${PORT}`);
  console.log(`📡 Webhook URL: https://telegram-bot-first-punch.onrender.com/webhook/yukassa`);
  console.log(`📡 CryptoCloud Webhook URL: https://telegram-bot-first-punch.onrender.com/webhook/cryptocloud`);
});

// Обработка ошибок
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
});
