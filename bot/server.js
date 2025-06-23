const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs').promises;
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Настройка CORS для всех доменов
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin'],
  credentials: false
}));

app.use(express.json());

// Настройка multer для загрузки файлов
const upload = multer({
  dest: 'uploads/',
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB
  }
});

// Инициализация бота
const bot = new TelegramBot(process.env.TELEGRAM_BOT_TOKEN, { polling: true });

// Константы
const CHAT_ID = -1002876590285; // ID канала "Первый Панч"
const SUBSCRIPTION_PRICE = 10; // Цена подписки в рублях

// Пути к файлам данных
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const MESSAGES_FILE = path.join(DATA_DIR, 'messages.json');
const JOIN_REQUESTS_FILE = path.join(DATA_DIR, 'join_requests.json');
const PAYMENTS_FILE = path.join(DATA_DIR, 'payments.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'subscriptions.json');

// Создание директории для данных
async function ensureDataDir() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
}

// Функции для работы с файлами
async function readJsonFile(filePath, defaultValue = []) {
  try {
    const data = await fs.readFile(filePath, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log(`Файл ${filePath} не найден, создаем новый`);
    await writeJsonFile(filePath, defaultValue);
    return defaultValue;
  }
}

async function writeJsonFile(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

// Функция для отправки медиафайлов через Telegram API
async function sendMediaToTelegram(userId, file, caption = '', isVideoNote = false, inlineKeyboard = null) {
  try {
    console.log(`📤 Отправка медиафайла пользователю ${userId}:`, {
      filename: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      isVideoNote
    });

    const fileBuffer = await fs.readFile(file.path);
    
    let result;

    if (isVideoNote && file.mimetype.startsWith('video/')) {
      // Отправляем как видеокружок - ПРАВИЛЬНЫЙ способ
      console.log('🎥 Отправка видеокружка через sendVideoNote...');
      
      // Для видеокружков используем только buffer без дополнительных опций
      result = await bot.sendVideoNote(userId, fileBuffer);
      
      console.log('✅ Видеокружок отправлен успешно');
    } else if (file.mimetype.startsWith('image/')) {
      // Отправляем как фото
      console.log('🖼️ Отправка изображения...');
      const options = {
        filename: file.originalname,
        contentType: file.mimetype
      };
      
      const sendOptions = {};
      if (caption) sendOptions.caption = caption;
      if (inlineKeyboard) sendOptions.reply_markup = { inline_keyboard: inlineKeyboard };
      
      result = await bot.sendPhoto(userId, fileBuffer, sendOptions, options);
    } else if (file.mimetype.startsWith('video/')) {
      // Отправляем как обычное видео
      console.log('🎬 Отправка видео...');
      const options = {
        filename: file.originalname,
        contentType: file.mimetype
      };
      
      const sendOptions = {
        supports_streaming: true
      };
      if (caption) sendOptions.caption = caption;
      if (inlineKeyboard) sendOptions.reply_markup = { inline_keyboard: inlineKeyboard };
      
      result = await bot.sendVideo(userId, fileBuffer, sendOptions, options);
    } else {
      // Отправляем как документ
      console.log('📄 Отправка документа...');
      const options = {
        filename: file.originalname,
        contentType: file.mimetype
      };
      
      const sendOptions = {};
      if (caption) sendOptions.caption = caption;
      if (inlineKeyboard) sendOptions.reply_markup = { inline_keyboard: inlineKeyboard };
      
      result = await bot.sendDocument(userId, fileBuffer, sendOptions, options);
    }

    console.log(`✅ Медиафайл успешно отправлен пользователю ${userId}`);
    return result;
  } catch (error) {
    console.error(`❌ Ошибка отправки медиафайла пользователю ${userId}:`, error.message);
    throw error;
  } finally {
    // Удаляем временный файл
    try {
      await fs.unlink(file.path);
    } catch (unlinkError) {
      console.warn('⚠️ Не удалось удалить временный файл:', unlinkError.message);
    }
  }
}

// Функция для сохранения сообщения
async function saveMessage(userId, text, isFromBot = false, messageType = 'text') {
  const messages = await readJsonFile(MESSAGES_FILE, { messages: [] });
  const message = {
    id: Date.now() + Math.random(),
    userId,
    text,
    isFromBot,
    messageType,
    timestamp: new Date().toISOString()
  };
  
  messages.messages.push(message);
  await writeJsonFile(MESSAGES_FILE, messages);
  return message;
}

// Функция для обновления пользователя
async function updateUser(userId, userData) {
  const users = await readJsonFile(USERS_FILE, { users: [] });
  const userIndex = users.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    users.users[userIndex] = { ...users.users[userIndex], ...userData, updated_at: new Date().toISOString() };
  } else {
    const newUser = {
      id: userId,
      username: null,
      first_name: null,
      last_name: null,
      first_seen: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      is_blocked: false,
      message_count: 0,
      payment_status: 'unpaid',
      ...userData
    };
    users.users.push(newUser);
  }
  
  await writeJsonFile(USERS_FILE, users);
}

// Обработчик команды /start
bot.onText(/\/start/, async (msg) => {
  const userId = msg.from.id;
  const user = msg.from;
  
  console.log(`👤 Пользователь ${userId} запустил бота`);
  
  // Сохраняем сообщение пользователя
  await saveMessage(userId, '/start', false, 'command');
  
  // Обновляем информацию о пользователе
  await updateUser(userId, {
    username: user.username,
    first_name: user.first_name,
    last_name: user.last_name,
    last_activity: new Date().toISOString(),
    message_count: 1
  });

  const welcomeMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;

  const keyboard = {
    inline_keyboard: [
      [
        { text: '💳 Оплатить подписку', callback_data: 'pay_subscription' },
        { text: '📋 О канале', callback_data: 'about_channel' }
      ],
      [
        { text: '💬 Поддержка', url: 'https://t.me/support_firstpunch' }
      ]
    ]
  };

  try {
    await bot.sendMessage(userId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    // Сохраняем ответ бота
    await saveMessage(userId, welcomeMessage, true, 'text');
  } catch (error) {
    console.error('Ошибка отправки приветственного сообщения:', error);
  }
});

// Обработчик callback запросов
bot.on('callback_query', async (callbackQuery) => {
  const userId = callbackQuery.from.id;
  const data = callbackQuery.data;
  
  console.log(`🔘 Callback от пользователя ${userId}: ${data}`);
  
  // Сохраняем действие пользователя
  await saveMessage(userId, `Нажата кнопка: ${data}`, false, 'button');
  
  // Обновляем активность пользователя
  const users = await readJsonFile(USERS_FILE, { users: [] });
  const userIndex = users.users.findIndex(u => u.id === userId);
  if (userIndex !== -1) {
    users.users[userIndex].last_activity = new Date().toISOString();
    users.users[userIndex].message_count += 1;
    await writeJsonFile(USERS_FILE, users);
  }

  let responseMessage = '';
  let keyboard = null;

  switch (data) {
    case 'about_channel':
      responseMessage = `📋 *Подробнее о канале*

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

      keyboard = {
        inline_keyboard: [
          [
            { text: '💳 Оплатить подписку', callback_data: 'pay_subscription' }
          ],
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      };
      break;

    case 'pay_subscription':
      responseMessage = `💳 *Оплата подписки*

Стоимость: *10 рублей* на 30 дней

Выберите способ оплаты:`;

      keyboard = {
        inline_keyboard: [
          [
            { text: '💳 ЮKassa (карты)', callback_data: 'pay_yukassa' },
            { text: '₿ Криптовалюта', callback_data: 'pay_crypto' }
          ],
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      };
      break;

    case 'main_menu':
      responseMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;

      keyboard = {
        inline_keyboard: [
          [
            { text: '💳 Оплатить подписку', callback_data: 'pay_subscription' },
            { text: '📋 О канале', callback_data: 'about_channel' }
          ],
          [
            { text: '💬 Поддержка', url: 'https://t.me/support_firstpunch' }
          ]
        ]
      };
      break;

    default:
      responseMessage = 'Функция в разработке 🚧';
      keyboard = {
        inline_keyboard: [
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      };
  }

  try {
    await bot.editMessageText(responseMessage, {
      chat_id: userId,
      message_id: callbackQuery.message.message_id,
      parse_mode: 'Markdown',
      reply_markup: keyboard
    });
    
    // Сохраняем ответ бота
    await saveMessage(userId, responseMessage, true, 'text');
  } catch (error) {
    console.error('Ошибка обработки callback:', error);
  }

  // Подтверждаем callback
  await bot.answerCallbackQuery(callbackQuery.id);
});

// Обработчик заявок на вступление в канал
bot.on('chat_join_request', async (joinRequest) => {
  console.log('📝 Новая заявка на вступление:', joinRequest);
  
  const requests = await readJsonFile(JOIN_REQUESTS_FILE, { requests: [] });
  
  const request = {
    id: Date.now() + Math.random(),
    chatId: joinRequest.chat.id,
    chatTitle: joinRequest.chat.title,
    userId: joinRequest.from.id,
    username: joinRequest.from.username,
    first_name: joinRequest.from.first_name,
    last_name: joinRequest.from.last_name,
    date: new Date(joinRequest.date * 1000).toISOString(),
    status: 'pending',
    timestamp: new Date().toISOString()
  };
  
  requests.requests.push(request);
  await writeJsonFile(JOIN_REQUESTS_FILE, requests);
  
  console.log('✅ Заявка сохранена');
});

// Обработчик всех сообщений
bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return; // Пропускаем команды
  
  const userId = msg.from.id;
  const user = msg.from;
  
  console.log(`💬 Сообщение от пользователя ${userId}: ${msg.text || 'медиафайл'}`);
  
  // Сохраняем сообщение
  await saveMessage(userId, msg.text || 'Медиафайл', false, 'text');
  
  // Обновляем информацию о пользователе
  const users = await readJsonFile(USERS_FILE, { users: [] });
  const userIndex = users.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    users.users[userIndex].last_activity = new Date().toISOString();
    users.users[userIndex].message_count += 1;
  } else {
    const newUser = {
      id: userId,
      username: user.username,
      first_name: user.first_name,
      last_name: user.last_name,
      first_seen: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      is_blocked: false,
      message_count: 1,
      payment_status: 'unpaid'
    };
    users.users.push(newUser);
  }
  
  await writeJsonFile(USERS_FILE, users);
});

// API маршруты

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bot: 'active'
  });
});

// Получение пользователей
app.get('/api/users', async (req, res) => {
  try {
    const users = await readJsonFile(USERS_FILE, { users: [] });
    const subscriptions = await readJsonFile(SUBSCRIPTIONS_FILE, { subscriptions: [] });
    
    // Добавляем информацию о подписках к пользователям
    const usersWithSubscriptions = users.users.map(user => {
      const activeSubscription = subscriptions.subscriptions.find(sub => 
        sub.user_id === user.id && 
        sub.status === 'active' && 
        new Date(sub.end_date) > new Date()
      );
      
      return {
        ...user,
        subscription_active: !!activeSubscription
      };
    });
    
    res.json({ users: usersWithSubscriptions });
  } catch (error) {
    console.error('Ошибка получения пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение статистики
app.get('/api/stats', async (req, res) => {
  try {
    const users = await readJsonFile(USERS_FILE, { users: [] });
    const messages = await readJsonFile(MESSAGES_FILE, { messages: [] });
    const joinRequests = await readJsonFile(JOIN_REQUESTS_FILE, { requests: [] });
    const subscriptions = await readJsonFile(SUBSCRIPTIONS_FILE, { subscriptions: [] });
    const payments = await readJsonFile(PAYMENTS_FILE, { payments: [] });

    const totalUsers = users.users.length;
    const activeUsers = users.users.filter(u => !u.is_blocked).length;
    const blockedUsers = users.users.filter(u => u.is_blocked).length;
    const totalMessages = messages.messages.length;
    
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsers = users.users.filter(u => new Date(u.last_activity) > dayAgo).length;
    
    const totalJoinRequests = joinRequests.requests.length;
    const pendingJoinRequests = joinRequests.requests.filter(r => r.status === 'pending').length;
    const approvedJoinRequests = joinRequests.requests.filter(r => r.status === 'approved').length;
    const declinedJoinRequests = joinRequests.requests.filter(r => r.status === 'declined').length;
    
    const now = new Date();
    const activeSubscriptions = subscriptions.subscriptions.filter(s => {
      const endDate = new Date(s.end_date);
      return s.status === 'active' && endDate > now;
    }).length;
    
    const expiredSubscriptions = subscriptions.subscriptions.filter(s => {
      const endDate = new Date(s.end_date);
      return s.status === 'active' && endDate <= now;
    }).length;
    
    const totalSubscriptions = subscriptions.subscriptions.length;
    const totalPayments = payments.payments.length;
    const successfulPayments = payments.payments.filter(p => p.status === 'succeeded').length;
    const pendingPayments = payments.payments.filter(p => p.status === 'pending').length;
    const totalRevenue = payments.payments.filter(p => p.status === 'succeeded').reduce((sum, p) => sum + Number(p.amount), 0);

    res.json({
      totalUsers,
      activeUsers,
      blockedUsers,
      totalMessages,
      recentUsers,
      totalJoinRequests,
      pendingJoinRequests,
      approvedJoinRequests,
      declinedJoinRequests,
      paidUsers: activeSubscriptions,
      unpaidUsers: totalUsers - activeSubscriptions,
      totalSubscriptions,
      activeSubscriptions,
      expiredSubscriptions,
      totalPayments,
      successfulPayments,
      pendingPayments,
      totalRevenue
    });
  } catch (error) {
    console.error('Ошибка получения статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение сообщений пользователя
app.get('/api/messages/:userId', async (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const messages = await readJsonFile(MESSAGES_FILE, { messages: [] });
    
    const userMessages = messages.messages.filter(m => m.userId === userId);
    res.json({ messages: userMessages });
  } catch (error) {
    console.error('Ошибка получения сообщений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Отправка сообщения пользователю
app.post('/api/send-message', upload.single('media'), async (req, res) => {
  try {
    const { userId, message, mediaCaption, inlineKeyboard, isVideoNote } = req.body;
    const file = req.file;
    
    console.log('📨 Запрос на отправку сообщения:', { 
      userId, 
      message, 
      hasFile: !!file,
      isVideoNote: isVideoNote === 'true'
    });
    
    if (!userId) {
      return res.status(400).json({ error: 'userId обязателен' });
    }

    const userIdNum = parseInt(userId);
    const isVideoNoteFlag = isVideoNote === 'true';
    let keyboard = null;
    
    // Парсим инлайн клавиатуру если есть (не для кружков)
    if (inlineKeyboard && !isVideoNoteFlag) {
      try {
        keyboard = JSON.parse(inlineKeyboard);
      } catch (e) {
        console.warn('Ошибка парсинга инлайн клавиатуры:', e);
      }
    }

    if (file) {
      // Отправляем медиафайл
      await sendMediaToTelegram(userIdNum, file, mediaCaption || '', isVideoNoteFlag, keyboard);
    } else if (message) {
      // Отправляем текстовое сообщение
      const options = {};
      if (keyboard) {
        options.reply_markup = { inline_keyboard: keyboard };
      }
      
      await bot.sendMessage(userIdNum, message, options);
    } else {
      return res.status(400).json({ error: 'Необходимо указать сообщение или прикрепить файл' });
    }

    // Сохраняем сообщение в базу
    await saveMessage(userIdNum, message || (isVideoNoteFlag ? 'Видеокружок' : 'Медиафайл'), true, file ? 'media' : 'text');

    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отправки сообщения:', error);
    res.status(500).json({ error: error.message });
  }
});

// Рассылка сообщений
app.post('/api/broadcast', upload.single('media'), async (req, res) => {
  try {
    const { userIds, message, mediaCaption, inlineKeyboard, isVideoNote } = req.body;
    const file = req.file;
    
    console.log('📢 Запрос на рассылку:', { 
      userIds: userIds ? JSON.parse(userIds).length : 0, 
      message, 
      hasFile: !!file,
      isVideoNote: isVideoNote === 'true'
    });
    
    if (!userIds) {
      return res.status(400).json({ error: 'userIds обязателен' });
    }

    const userIdsList = JSON.parse(userIds);
    const isVideoNoteFlag = isVideoNote === 'true';
    let keyboard = null;
    
    // Парсим инлайн клавиатуру если есть (не для кружков)
    if (inlineKeyboard && !isVideoNoteFlag) {
      try {
        keyboard = JSON.parse(inlineKeyboard);
      } catch (e) {
        console.warn('Ошибка парсинга инлайн клавиатуры:', e);
      }
    }

    let successCount = 0;
    let errorCount = 0;

    // Для кружков создаем копии файла для каждого пользователя
    if (file && isVideoNoteFlag) {
      console.log('🎥 Рассылка видеокружков - создание копий файла...');
      
      for (const userId of userIdsList) {
        try {
          // Создаем копию файла для каждого пользователя
          const originalBuffer = await fs.readFile(file.path);
          const tempFilePath = `${file.path}_${userId}`;
          await fs.writeFile(tempFilePath, originalBuffer);
          
          const fileCopy = {
            ...file,
            path: tempFilePath
          };
          
          // Отправляем видеокружок
          await sendMediaToTelegram(userId, fileCopy, '', true, null);
          
          // Сохраняем сообщение в базу
          await saveMessage(userId, 'Видеокружок', true, 'video_note');
          
          successCount++;
          
          // Небольшая задержка между отправками
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
          console.error(`❌ Ошибка отправки кружка пользователю ${userId}:`, error.message);
          errorCount++;
        }
      }
    } else {
      // Обычная рассылка для других типов медиа и текста
      for (const userId of userIdsList) {
        try {
          if (file) {
            // Создаем копию файла для каждого пользователя
            const originalBuffer = await fs.readFile(file.path);
            const tempFilePath = `${file.path}_${userId}`;
            await fs.writeFile(tempFilePath, originalBuffer);
            
            const fileCopy = {
              ...file,
              path: tempFilePath
            };
            
            // Отправляем медиафайл
            await sendMediaToTelegram(userId, fileCopy, mediaCaption || '', false, keyboard);
          } else if (message) {
            // Отправляем текстовое сообщение
            const options = {};
            if (keyboard) {
              options.reply_markup = { inline_keyboard: keyboard };
            }
            
            await bot.sendMessage(userId, message, options);
          }

          // Сохраняем сообщение в базу
          await saveMessage(userId, message || 'Медиафайл', true, file ? 'media' : 'text');
          
          successCount++;
          
          // Небольшая задержка между отправками
          await new Promise(resolve => setTimeout(resolve, 100));
        } catch (error) {
          console.error(`❌ Ошибка отправки пользователю ${userId}:`, error.message);
          errorCount++;
        }
      }
    }

    // Удаляем оригинальный файл
    if (file) {
      try {
        await fs.unlink(file.path);
      } catch (unlinkError) {
        console.warn('⚠️ Не удалось удалить оригинальный файл:', unlinkError.message);
      }
    }

    console.log(`📊 Рассылка завершена: отправлено ${successCount}, ошибок ${errorCount}`);
    res.json({ 
      success: true, 
      sent: successCount, 
      errors: errorCount 
    });
  } catch (error) {
    console.error('❌ Ошибка рассылки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение заявок на вступление
app.get('/api/join-requests', async (req, res) => {
  try {
    const requests = await readJsonFile(JOIN_REQUESTS_FILE, { requests: [] });
    res.json(requests);
  } catch (error) {
    console.error('Ошибка получения заявок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Одобрение заявки на вступление
app.post('/api/approve-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    
    console.log(`✅ Одобрение заявки: chatId=${chatId}, userId=${userId}`);
    
    // Одобряем заявку в Telegram
    await bot.approveChatJoinRequest(chatId, userId);
    
    // Обновляем статус в файле
    const requests = await readJsonFile(JOIN_REQUESTS_FILE, { requests: [] });
    const requestIndex = requests.requests.findIndex(r => r.chatId === chatId && r.userId === userId && r.status === 'pending');
    
    if (requestIndex !== -1) {
      requests.requests[requestIndex].status = 'approved';
      requests.requests[requestIndex].processed_at = new Date().toISOString();
      await writeJsonFile(JOIN_REQUESTS_FILE, requests);
    }
    
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
    
    console.log(`❌ Отклонение заявки: chatId=${chatId}, userId=${userId}`);
    
    // Отклоняем заявку в Telegram
    await bot.declineChatJoinRequest(chatId, userId);
    
    // Обновляем статус в файле
    const requests = await readJsonFile(JOIN_REQUESTS_FILE, { requests: [] });
    const requestIndex = requests.requests.findIndex(r => r.chatId === chatId && r.userId === userId && r.status === 'pending');
    
    if (requestIndex !== -1) {
      requests.requests[requestIndex].status = 'declined';
      requests.requests[requestIndex].processed_at = new Date().toISOString();
      await writeJsonFile(JOIN_REQUESTS_FILE, requests);
    }
    
    res.json({ success: true });
  } catch (error) {
    console.error('Ошибка отклонения заявки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Получение подписок
app.get('/api/subscriptions', async (req, res) => {
  try {
    const subscriptions = await readJsonFile(SUBSCRIPTIONS_FILE, { subscriptions: [] });
    const users = await readJsonFile(USERS_FILE, { users: [] });
    
    // Добавляем информацию о пользователях к подпискам
    const subscriptionsWithUsers = subscriptions.subscriptions.map(subscription => {
      const user = users.users.find(u => u.id === subscription.user_id);
      return {
        ...subscription,
        user: user ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        } : null
      };
    });
    
    res.json({ subscriptions: subscriptionsWithUsers });
  } catch (error) {
    console.error('Ошибка получения подписок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Получение платежей
app.get('/api/payments', async (req, res) => {
  try {
    const payments = await readJsonFile(PAYMENTS_FILE, { payments: [] });
    const users = await readJsonFile(USERS_FILE, { users: [] });
    
    // Добавляем информацию о пользователях к платежам
    const paymentsWithUsers = payments.payments.map(payment => {
      const user = users.users.find(u => u.id === payment.user_id);
      return {
        ...payment,
        user: user ? {
          username: user.username,
          first_name: user.first_name,
          last_name: user.last_name
        } : null
      };
    });
    
    res.json({ payments: paymentsWithUsers });
  } catch (error) {
    console.error('Ошибка получения платежей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновление статуса подписки
app.post('/api/update-subscription-status', async (req, res) => {
  try {
    const { subscriptionId, userId, status } = req.body;
    
    console.log(`🔄 Обновление статуса подписки: ${subscriptionId} -> ${status}`);
    
    const subscriptions = await readJsonFile(SUBSCRIPTIONS_FILE, { subscriptions: [] });
    const subscriptionIndex = subscriptions.subscriptions.findIndex(s => s.id === subscriptionId);
    
    if (subscriptionIndex !== -1) {
      subscriptions.subscriptions[subscriptionIndex].status = status;
      subscriptions.subscriptions[subscriptionIndex].updated_at = new Date().toISOString();
      await writeJsonFile(SUBSCRIPTIONS_FILE, subscriptions);
      
      // Если подписка отменена или истекла, исключаем пользователя из канала
      if (status === 'cancelled' || status === 'expired') {
        try {
          await bot.banChatMember(CHAT_ID, userId);
          await bot.unbanChatMember(CHAT_ID, userId);
          console.log(`👤 Пользователь ${userId} исключен из канала`);
        } catch (error) {
          console.error(`Ошибка исключения пользователя ${userId}:`, error.message);
        }
      }
      
      res.json({ success: true });
    } else {
      res.status(404).json({ error: 'Подписка не найдена' });
    }
  } catch (error) {
    console.error('Ошибка обновления статуса подписки:', error);
    res.status(500).json({ error: error.message });
  }
});

// Инициализация
async function init() {
  await ensureDataDir();
  
  app.listen(PORT, () => {
    console.log(`🚀 Сервер запущен на порту ${PORT}`);
    console.log(`🤖 Бот активен`);
  });
}

init().catch(console.error);
