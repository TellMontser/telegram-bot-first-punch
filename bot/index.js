import TelegramBot from 'node-telegram-bot-api';
import fs from 'fs';
import path from 'path';
import { createPayment, getPaymentStatus } from './yukassa.js';
import { addSubscription, isSubscriptionActive, getUserSubscription } from './subscriptions.js';
import { addPayment, updatePaymentStatus } from './payments.js';

const BOT_TOKEN = '7604320716:AAFK-L72uch_OF2gliQacoPVz4RjlqvZXlc';
const DATA_FILE = path.join(process.cwd(), 'data', 'users.json');
const MESSAGES_FILE = path.join(process.cwd(), 'data', 'messages.json');
const JOIN_REQUESTS_FILE = path.join(process.cwd(), 'data', 'join_requests.json');

// Создаем директорию для данных если её нет
const dataDir = path.dirname(DATA_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Инициализируем файлы с данными если их нет
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify({ users: [] }, null, 2));
}

if (!fs.existsSync(MESSAGES_FILE)) {
  fs.writeFileSync(MESSAGES_FILE, JSON.stringify({ messages: [] }, null, 2));
}

if (!fs.existsSync(JOIN_REQUESTS_FILE)) {
  fs.writeFileSync(JOIN_REQUESTS_FILE, JSON.stringify({ requests: [] }, null, 2));
}

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// Функция для загрузки пользователей
function loadUsers() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке пользователей:', error);
    return { users: [] };
  }
}

// Функция для сохранения пользователей
function saveUsers(usersData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(usersData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении пользователей:', error);
  }
}

// Функция для загрузки сообщений
function loadMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке сообщений:', error);
    return { messages: [] };
  }
}

// Функция для сохранения сообщений
function saveMessages(messagesData) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении сообщений:', error);
  }
}

// Функция для загрузки запросов на вступление
function loadJoinRequests() {
  try {
    const data = fs.readFileSync(JOIN_REQUESTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке запросов на вступление:', error);
    return { requests: [] };
  }
}

// Функция для сохранения запросов на вступление
function saveJoinRequests(requestsData) {
  try {
    fs.writeFileSync(JOIN_REQUESTS_FILE, JSON.stringify(requestsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении запросов на вступление:', error);
  }
}

// Функция для добавления сообщения в историю
function addMessage(userId, text, isFromBot = false, messageType = 'text') {
  const messagesData = loadMessages();
  const message = {
    id: Date.now() + Math.random(),
    userId: userId,
    text: text,
    isFromBot: isFromBot,
    messageType: messageType,
    timestamp: new Date().toISOString()
  };
  
  messagesData.messages.push(message);
  saveMessages(messagesData);
}

// Функция для добавления или обновления пользователя
function addOrUpdateUser(userInfo) {
  const usersData = loadUsers();
  const existingUserIndex = usersData.users.findIndex(u => u.id === userInfo.id);
  
  if (existingUserIndex === -1) {
    // Новый пользователь
    const newUser = {
      id: userInfo.id,
      username: userInfo.username || null,
      first_name: userInfo.first_name || null,
      last_name: userInfo.last_name || null,
      first_seen: new Date().toISOString(),
      last_activity: new Date().toISOString(),
      is_blocked: false,
      message_count: 1,
      payment_status: 'unpaid'
    };
    usersData.users.push(newUser);
  } else {
    // Обновляем существующего пользователя
    usersData.users[existingUserIndex].last_activity = new Date().toISOString();
    usersData.users[existingUserIndex].message_count += 1;
    usersData.users[existingUserIndex].is_blocked = false;
    // Добавляем статус оплаты если его нет
    if (!usersData.users[existingUserIndex].payment_status) {
      usersData.users[existingUserIndex].payment_status = 'unpaid';
    }
  }
  
  saveUsers(usersData);
}

// Функция для отметки пользователя как заблокированного
function markUserAsBlocked(userId) {
  const usersData = loadUsers();
  const userIndex = usersData.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    usersData.users[userIndex].is_blocked = true;
    saveUsers(usersData);
  }
}

// Функция для обновления статуса оплаты пользователя
function updateUserPaymentStatus(userId, status) {
  const usersData = loadUsers();
  const userIndex = usersData.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    usersData.users[userIndex].payment_status = status;
    saveUsers(usersData);
  }
}

// Обработка запросов на вступление в канал
bot.on('chat_join_request', async (joinRequest) => {
  console.log('Получен запрос на вступление:', joinRequest);
  
  const requestsData = loadJoinRequests();
  
  // Проверяем, есть ли уже pending запрос от этого пользователя для этого канала
  const existingPendingRequest = requestsData.requests.find(
    r => r.chatId === joinRequest.chat.id && 
         r.userId === joinRequest.from.id && 
         r.status === 'pending'
  );
  
  // Если уже есть pending запрос, не создаем новый
  if (existingPendingRequest) {
    console.log(`Запрос от пользователя ${joinRequest.from.id} уже существует и ожидает обработки`);
    return;
  }
  
  const newRequest = {
    id: Date.now() + Math.random(),
    chatId: joinRequest.chat.id,
    chatTitle: joinRequest.chat.title,
    userId: joinRequest.from.id,
    username: joinRequest.from.username || null,
    first_name: joinRequest.from.first_name || null,
    last_name: joinRequest.from.last_name || null,
    date: new Date(joinRequest.date * 1000).toISOString(),
    status: 'pending',
    timestamp: new Date().toISOString()
  };
  
  // Добавляем пользователя в базу если его нет
  addOrUpdateUser(joinRequest.from);
  
  // Проверяем активность подписки пользователя
  const hasActiveSubscription = isSubscriptionActive(joinRequest.from.id);
  
  if (hasActiveSubscription) {
    // Автоматически одобряем запрос для пользователей с активной подпиской
    try {
      await bot.approveChatJoinRequest(joinRequest.chat.id, joinRequest.from.id);
      newRequest.status = 'approved';
      newRequest.processed_at = new Date().toISOString();
      console.log(`Запрос автоматически одобрен для пользователя с активной подпиской ${joinRequest.from.first_name} (ID: ${joinRequest.from.id})`);
    } catch (error) {
      console.error('Ошибка при автоматическом одобрении запроса:', error);
    }
  } else {
    console.log(`Новый запрос на вступление от ${joinRequest.from.first_name} (ID: ${joinRequest.from.id}) - подписка неактивна`);
  }
  
  requestsData.requests.push(newRequest);
  saveJoinRequests(requestsData);
});

// Функция для одобрения запроса на вступление
export function approveJoinRequest(chatId, userId) {
  return new Promise((resolve, reject) => {
    bot.approveChatJoinRequest(chatId, userId)
      .then(() => {
        // Обновляем статус запроса
        const requestsData = loadJoinRequests();
        const requestIndex = requestsData.requests.findIndex(
          r => r.chatId === chatId && r.userId === userId && r.status === 'pending'
        );
        
        if (requestIndex !== -1) {
          requestsData.requests[requestIndex].status = 'approved';
          requestsData.requests[requestIndex].processed_at = new Date().toISOString();
          saveJoinRequests(requestsData);
        }
        
        console.log(`Запрос на вступление одобрен для пользователя ${userId}`);
        resolve();
      })
      .catch((error) => {
        console.error('Ошибка при одобрении запроса:', error);
        reject(error);
      });
  });
}

// Функция для отклонения запроса на вступление
export function declineJoinRequest(chatId, userId) {
  return new Promise((resolve, reject) => {
    bot.declineChatJoinRequest(chatId, userId)
      .then(() => {
        // Обновляем статус запроса
        const requestsData = loadJoinRequests();
        const requestIndex = requestsData.requests.findIndex(
          r => r.chatId === chatId && r.userId === userId && r.status === 'pending'
        );
        
        if (requestIndex !== -1) {
          requestsData.requests[requestIndex].status = 'declined';
          requestsData.requests[requestIndex].processed_at = new Date().toISOString();
          saveJoinRequests(requestsData);
        }
        
        console.log(`Запрос на вступление отклонен для пользователя ${userId}`);
        resolve();
      })
      .catch((error) => {
        console.error('Ошибка при отклонении запроса:', error);
        reject(error);
      });
  });
}

// Функция для кика пользователя из канала
export function kickUserFromChannel(chatId, userId) {
  return new Promise((resolve, reject) => {
    // Сначала проверяем, является ли пользователь администратором
    bot.getChatMember(chatId, userId)
      .then((member) => {
        if (member.status === 'administrator' || member.status === 'creator') {
          reject(new Error('Нельзя кикнуть администратора'));
          return;
        }
        
        // Кикаем пользователя (банним и сразу разбаниваем)
        return bot.banChatMember(chatId, userId);
      })
      .then(() => {
        // Разбаниваем пользователя, чтобы он мог снова подать заявку
        return bot.unbanChatMember(chatId, userId);
      })
      .then(() => {
        console.log(`Пользователь ${userId} кикнут из канала ${chatId}`);
        resolve();
      })
      .catch((error) => {
        console.error('Ошибка при кике пользователя:', error);
        reject(error);
      });
  });
}

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  addOrUpdateUser(user);
  addMessage(chatId, '/start', false, 'command');
  
  // Проверяем активность подписки
  const hasActiveSubscription = isSubscriptionActive(user.id);
  const subscription = getUserSubscription(user.id);
  
  let subscriptionInfo = '';
  if (hasActiveSubscription && subscription) {
    const endDate = new Date(subscription.endDate);
    subscriptionInfo = `\n\n✅ *У вас активная подписка до ${endDate.toLocaleDateString('ru-RU')}*`;
  }
  
  const welcomeMessage = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*${subscriptionInfo}

👇 *Выберите действие* 👇`;

  const options = {
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: hasActiveSubscription ? '✅ Подписка активна' : '💳 Купить подписку (10₽)', callback_data: hasActiveSubscription ? 'subscription_info' : 'buy_subscription' }
        ],
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

  bot.sendMessage(chatId, welcomeMessage, options);
  addMessage(chatId, welcomeMessage, true, 'text');
});

// Обработка текстовых сообщений
bot.on('message', (msg) => {
  if (msg.text && !msg.text.startsWith('/')) {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    addOrUpdateUser(user);
    addMessage(chatId, msg.text, false, 'text');
    
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
    
    bot.sendMessage(chatId, randomResponse, options);
    addMessage(chatId, randomResponse, true, 'text');
  }
});

// Обработка нажатий на кнопки
bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const messageId = query.message.message_id;
  const data = query.data;
  const user = query.from;
  
  addOrUpdateUser(user);
  addMessage(chatId, `Нажата кнопка: ${data}`, false, 'button');
  
  let responseText = '';
  let options = {};
  
  switch (data) {
    case 'buy_subscription':
      try {
        // Создаем платеж через ЮKassa
        const payment = await createPayment(
          10, // 10 рублей
          'Подписка на канал "Первый Панч" на 30 дней',
          user.id
        );
        
        // Сохраняем информацию о платеже
        addPayment(user.id, payment.id, 10);
        
        responseText = `💳 *Оплата подписки*

💰 Стоимость: *10 рублей*
⏰ Срок: *30 дней*

Для оплаты нажмите кнопку ниже и следуйте инструкциям:`;
        
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💳 Оплатить 10₽', url: payment.confirmation.confirmation_url }
              ],
              [
                { text: '🔄 Проверить оплату', callback_data: `check_payment_${payment.id}` }
              ],
              [
                { text: '🔙 Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        };
      } catch (error) {
        console.error('Ошибка создания платежа:', error);
        responseText = `❌ *Ошибка создания платежа*

Попробуйте позже или обратитесь в поддержку.`;
        options = {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '🔙 Назад', callback_data: 'main_menu' }
              ]
            ]
          }
        };
      }
      break;
      
    case 'subscription_info': {
      const subscription = getUserSubscription(user.id);
      if (subscription) {
        const endDate = new Date(subscription.endDate);
        const daysLeft = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
        
        responseText = `✅ *Информация о подписке*

📅 Активна до: *${endDate.toLocaleDateString('ru-RU')}*
⏰ Осталось дней: *${daysLeft}*
💰 Стоимость: *${subscription.amount}₽*

Ваша подписка активна! Вы можете подавать заявки на вступление в канал.`;
      } else {
        responseText = `❌ *Подписка не найдена*

У вас нет активной подписки.`;
      }
      
      options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '💳 Продлить подписку', callback_data: 'buy_subscription' }
            ],
            [
              { text: '🔙 Назад', callback_data: 'main_menu' }
            ]
          ]
        }
      };
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

💰 *Всё это - всего за 10 рублей в месяц.*

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
              { text: '💳 Купить подписку (10₽)', callback_data: 'buy_subscription' }
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
      const hasActiveSubscription = isSubscriptionActive(user.id);
      const subscription = getUserSubscription(user.id);
      
      let subscriptionInfo = '';
      if (hasActiveSubscription && subscription) {
        const endDate = new Date(subscription.endDate);
        subscriptionInfo = `\n\n✅ *У вас активная подписка до ${endDate.toLocaleDateString('ru-RU')}*`;
      }
      
      responseText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*${subscriptionInfo}

👇 *Выберите действие* 👇`;
      options = {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: hasActiveSubscription ? '✅ Подписка активна' : '💳 Купить подписку (10₽)', callback_data: hasActiveSubscription ? 'subscription_info' : 'buy_subscription' }
            ],
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
      
    default: {
      // Проверка оплаты
      if (data.startsWith('check_payment_')) {
        const paymentId = data.replace('check_payment_', '');
        
        try {
          const paymentStatus = await getPaymentStatus(paymentId);
          
          if (paymentStatus.status === 'succeeded') {
            // Платеж успешен - активируем подписку
            updatePaymentStatus(paymentId, 'succeeded');
            const subscription = addSubscription(user.id, paymentId, paymentStatus.amount.value);
            updateUserPaymentStatus(user.id, 'paid');
            
            responseText = `🎉 *Платеж успешно обработан!*

✅ Подписка активирована на 30 дней
📅 Действует до: *${new Date(subscription.endDate).toLocaleDateString('ru-RU')}*

Теперь вы можете подавать заявки на вступление в канал!`;
            
            options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🏠 Главное меню', callback_data: 'main_menu' }
                  ]
                ]
              }
            };
          } else if (paymentStatus.status === 'pending') {
            responseText = `⏳ *Платеж обрабатывается*

Пожалуйста, подождите. Проверьте статус через несколько минут.`;
            
            options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '🔄 Проверить снова', callback_data: `check_payment_${paymentId}` }
                  ],
                  [
                    { text: '🔙 Назад', callback_data: 'main_menu' }
                  ]
                ]
              }
            };
          } else {
            responseText = `❌ *Платеж не найден или отменен*

Попробуйте создать новый платеж.`;
            
            options = {
              parse_mode: 'Markdown',
              reply_markup: {
                inline_keyboard: [
                  [
                    { text: '💳 Создать новый платеж', callback_data: 'buy_subscription' }
                  ],
                  [
                    { text: '🔙 Назад', callback_data: 'main_menu' }
                  ]
                ]
              }
            };
          }
        } catch (error) {
          console.error('Ошибка проверки платежа:', error);
          responseText = `❌ *Ошибка проверки платежа*

Попробуйте позже или обратитесь в поддержку.`;
          
          options = {
            parse_mode: 'Markdown',
            reply_markup: {
              inline_keyboard: [
                [
                  { text: '🔙 Назад', callback_data: 'main_menu' }
                ]
              ]
            }
          };
        }
      }
      break;
    }
  }
  
  if (responseText) {
    bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      ...options
    });
    
    addMessage(chatId, responseText, true, 'text');
  }
  
  bot.answerCallbackQuery(query.id);
});

// Функция для отправки сообщения от админа
export function sendMessageFromAdmin(userId, message) {
  return new Promise((resolve, reject) => {
    bot.sendMessage(userId, message)
      .then((sentMessage) => {
        addMessage(userId, message, true, 'admin');
        resolve(sentMessage);
      })
      .catch((error) => {
        console.error('Ошибка при отправке сообщения от админа:', error);
        if (error.code === 403) {
          markUserAsBlocked(userId);
        }
        reject(error);
      });
  });
}

// Обработка ошибок
bot.on('error', (error) => {
  console.error('Ошибка бота:', error);
});

// Обработка блокировки бота пользователем
bot.on('polling_error', (error) => {
  if (error.code === 'ETELEGRAM' && error.response && error.response.body) {
    let body;
    if (typeof error.response.body === 'string') {
      try {
        body = JSON.parse(error.response.body);
      } catch (parseError) {
        console.error('Ошибка при парсинге JSON:', parseError);
        return;
      }
    } else {
      body = error.response.body;
    }
    
    if (body.description && body.description.includes('blocked')) {
      console.log('Пользователь заблокировал бота');
    }
  }
});

console.log('🚀 Телеграм бот "Первый Панч" запущен!');
console.log('📱 Токен:', BOT_TOKEN.substring(0, 10) + '...');
console.log('🔔 Ожидание запросов на вступление в канал...');
console.log('💳 Интеграция с ЮKassa активна');
console.log('🤖 Автоматическое одобрение для пользователей с активной подпиской включено');