import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import crypto from 'crypto';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

// Получаем __dirname для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
// Render автоматически назначает порт
const PORT = process.env.PORT || 10000;

// Константы для ЮKassa
const YUKASSA_SHOP_ID = '1103466';
const YUKASSA_SECRET_KEY = 'live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo';
const YUKASSA_API_URL = 'https://api.yookassa.ru/v3';

const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const JOIN_REQUESTS_FILE = path.join(__dirname, 'data', 'join_requests.json');
const SUBSCRIPTIONS_FILE = path.join(__dirname, 'data', 'subscriptions.json');
const PAYMENTS_FILE = path.join(__dirname, 'data', 'payments.json');
const BOT_TOKEN = '7604320716:AAFK-L72uch_OF2gliQacoPVz4RjlqvZXlc';

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// МАКСИМАЛЬНО ОТКРЫТЫЕ CORS настройки для админки
app.use(cors({
  origin: '*', // Разрешаем ВСЕ домены
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'HEAD', 'PATCH'],
  allowedHeaders: '*', // Разрешаем ВСЕ заголовки
  credentials: false,
  optionsSuccessStatus: 200
}));

// Дополнительные CORS заголовки для гарантии
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', '*');
  res.header('Access-Control-Allow-Headers', '*');
  res.header('Access-Control-Max-Age', '86400');
  
  // Логируем все запросы
  console.log(`📨 ${req.method} ${req.url} from ${req.get('Origin') || 'unknown'}`);
  
  // Отвечаем на preflight запросы
  if (req.method === 'OPTIONS') {
    console.log('✅ Preflight request handled');
    return res.status(200).end();
  }
  
  next();
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.raw({ type: 'application/json', limit: '10mb' }));

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

if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify({ subscriptions: [] }, null, 2));
}

if (!fs.existsSync(PAYMENTS_FILE)) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ payments: [] }, null, 2));
}

// Функции для работы с данными
function loadUsers() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке пользователей:', error);
    return { users: [] };
  }
}

function saveUsers(usersData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(usersData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении пользователей:', error);
  }
}

function loadMessages() {
  try {
    const data = fs.readFileSync(MESSAGES_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке сообщений:', error);
    return { messages: [] };
  }
}

function saveMessages(messagesData) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении сообщений:', error);
  }
}

function loadJoinRequests() {
  try {
    const data = fs.readFileSync(JOIN_REQUESTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке запросов на вступление:', error);
    return { requests: [] };
  }
}

function saveJoinRequests(requestsData) {
  try {
    fs.writeFileSync(JOIN_REQUESTS_FILE, JSON.stringify(requestsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении запросов на вступление:', error);
  }
}

function loadSubscriptions() {
  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке подписок:', error);
    return { subscriptions: [] };
  }
}

function saveSubscriptions(subscriptionsData) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptionsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении подписок:', error);
  }
}

function loadPayments() {
  try {
    const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке платежей:', error);
    return { payments: [] };
  }
}

function savePayments(paymentsData) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении платежей:', error);
  }
}

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

function addOrUpdateUser(userInfo) {
  const usersData = loadUsers();
  const existingUserIndex = usersData.users.findIndex(u => u.id === userInfo.id);
  
  if (existingUserIndex === -1) {
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
    usersData.users[existingUserIndex].last_activity = new Date().toISOString();
    usersData.users[existingUserIndex].message_count += 1;
    usersData.users[existingUserIndex].is_blocked = false;
    if (!usersData.users[existingUserIndex].payment_status) {
      usersData.users[existingUserIndex].payment_status = 'unpaid';
    }
  }
  
  saveUsers(usersData);
}

function markUserAsBlocked(userId) {
  const usersData = loadUsers();
  const userIndex = usersData.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    usersData.users[userIndex].is_blocked = true;
    saveUsers(usersData);
  }
}

function updateUserPaymentStatus(userId, status) {
  const usersData = loadUsers();
  const userIndex = usersData.users.findIndex(u => u.id === userId);
  
  if (userIndex !== -1) {
    usersData.users[userIndex].payment_status = status;
    saveUsers(usersData);
  }
}

// Функции для подписок
function addSubscription(userId, paymentId, amount, duration = 30) {
  const subscriptionsData = loadSubscriptions();
  
  const subscription = {
    id: Date.now() + Math.random(),
    userId: userId,
    paymentId: paymentId,
    amount: amount,
    duration: duration,
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  subscriptionsData.subscriptions.push(subscription);
  saveSubscriptions(subscriptionsData);
  
  return subscription;
}

function isSubscriptionActive(userId) {
  const subscriptionsData = loadSubscriptions();
  const userSubscriptions = subscriptionsData.subscriptions.filter(
    sub => sub.userId === userId && sub.status === 'active'
  );
  
  if (userSubscriptions.length === 0) return false;
  
  const now = new Date();
  const activeSubscription = userSubscriptions.find(sub => {
    const endDate = new Date(sub.endDate);
    return endDate > now;
  });
  
  if (!activeSubscription) {
    userSubscriptions.forEach(sub => {
      const endDate = new Date(sub.endDate);
      if (endDate <= now) {
        sub.status = 'expired';
      }
    });
    saveSubscriptions(subscriptionsData);
    return false;
  }
  
  return true;
}

function getUserSubscription(userId) {
  const subscriptionsData = loadSubscriptions();
  const userSubscriptions = subscriptionsData.subscriptions.filter(
    sub => sub.userId === userId
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return userSubscriptions[0] || null;
}

function getAllSubscriptions() {
  const subscriptionsData = loadSubscriptions();
  return subscriptionsData.subscriptions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function deactivateSubscription(userId) {
  const subscriptionsData = loadSubscriptions();
  const subscriptionIndex = subscriptionsData.subscriptions.findIndex(
    sub => sub.userId === userId && sub.status === 'active'
  );
  
  if (subscriptionIndex !== -1) {
    subscriptionsData.subscriptions[subscriptionIndex].status = 'cancelled';
    subscriptionsData.subscriptions[subscriptionIndex].cancelledAt = new Date().toISOString();
    saveSubscriptions(subscriptionsData);
    return true;
  }
  
  return false;
}

// Функции для платежей
function addPayment(userId, paymentId, amount, status = 'pending') {
  const paymentsData = loadPayments();
  
  const payment = {
    id: Date.now() + Math.random(),
    userId: userId,
    paymentId: paymentId,
    amount: amount,
    status: status,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  paymentsData.payments.push(payment);
  savePayments(paymentsData);
  
  return payment;
}

function updatePaymentStatus(paymentId, status) {
  const paymentsData = loadPayments();
  const paymentIndex = paymentsData.payments.findIndex(p => p.paymentId === paymentId);
  
  if (paymentIndex !== -1) {
    paymentsData.payments[paymentIndex].status = status;
    paymentsData.payments[paymentIndex].updatedAt = new Date().toISOString();
    savePayments(paymentsData);
    return paymentsData.payments[paymentIndex];
  }
  
  return null;
}

function getAllPayments() {
  const paymentsData = loadPayments();
  return paymentsData.payments.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Функции для ЮKassa
async function createPayment(amount, description, userId, returnUrl = null) {
  const idempotenceKey = crypto.randomUUID();
  
  const paymentData = {
    amount: {
      value: amount.toFixed(2),
      currency: 'RUB'
    },
    confirmation: {
      type: 'redirect',
      return_url: returnUrl || 'https://resonant-pithivier-ac150a.netlify.app/'
    },
    capture: true,
    description: description,
    metadata: {
      user_id: userId.toString()
    }
  };

  try {
    const response = await fetch(`${YUKASSA_API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        'Authorization': `Basic ${Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64')}`
      },
      body: JSON.stringify(paymentData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`ЮKassa API error: ${errorData.description || response.statusText}`);
    }

    const payment = await response.json();
    return payment;
  } catch (error) {
    console.error('Ошибка создания платежа:', error);
    throw error;
  }
}

async function getPaymentStatus(paymentId) {
  try {
    const response = await fetch(`${YUKASSA_API_URL}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64')}`
      }
    });

    if (!response.ok) {
      throw new Error(`ЮKassa API error: ${response.statusText}`);
    }

    const payment = await response.json();
    return payment;
  } catch (error) {
    console.error('Ошибка получения статуса платежа:', error);
    throw error;
  }
}

function verifyWebhookSignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', YUKASSA_SECRET_KEY)
    .update(body)
    .digest('hex');
  
  return hash === signature;
}

// Функции для работы с заявками
function approveJoinRequest(chatId, userId) {
  return new Promise((resolve, reject) => {
    bot.approveChatJoinRequest(chatId, userId)
      .then(() => {
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

function declineJoinRequest(chatId, userId) {
  return new Promise((resolve, reject) => {
    bot.declineChatJoinRequest(chatId, userId)
      .then(() => {
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

// ГЛАВНЫЙ Health check endpoint - ДОЛЖЕН БЫТЬ ПЕРВЫМ!
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
      memory: process.memoryUsage()
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
    endpoints: {
      health: '/health',
      api: '/api/*'
    }
  });
});

// API endpoints
app.get('/api/users', (req, res) => {
  try {
    console.log('👥 Запрос пользователей');
    const usersData = loadUsers();
    const subscriptions = getAllSubscriptions();
    
    const usersWithSubscriptionStatus = usersData.users.map(user => {
      const hasActiveSubscription = isSubscriptionActive(user.id);
      return {
        ...user,
        payment_status: hasActiveSubscription ? 'paid' : 'unpaid',
        subscription_active: hasActiveSubscription
      };
    });
    
    console.log(`✅ Отправлено ${usersWithSubscriptionStatus.length} пользователей`);
    res.json({ users: usersWithSubscriptionStatus });
  } catch (error) {
    console.error('❌ Ошибка при получении пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
    console.log('📊 Запрос статистики');
    const usersData = loadUsers();
    const requestsData = loadJoinRequests();
    const subscriptions = getAllSubscriptions();
    const payments = getAllPayments();
    
    const users = usersData.users;
    const requests = requestsData.requests;
    
    const totalUsers = users.length;
    const activeUsers = users.filter(user => !user.is_blocked).length;
    const blockedUsers = users.filter(user => user.is_blocked).length;
    const totalMessages = users.reduce((sum, user) => sum + (user.message_count || 0), 0);
    
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentUsers = users.filter(user => 
      new Date(user.last_activity) > dayAgo
    ).length;
    
    const totalJoinRequests = requests.length;
    const pendingJoinRequests = requests.filter(req => req.status === 'pending').length;
    const approvedJoinRequests = requests.filter(req => req.status === 'approved').length;
    const declinedJoinRequests = requests.filter(req => req.status === 'declined').length;
    
    const activeSubscriptions = subscriptions.filter(sub => {
      const endDate = new Date(sub.endDate);
      return sub.status === 'active' && endDate > new Date();
    }).length;
    
    const expiredSubscriptions = subscriptions.filter(sub => {
      const endDate = new Date(sub.endDate);
      return sub.status === 'active' && endDate <= new Date();
    }).length;
    
    const totalSubscriptions = subscriptions.length;
    
    const totalPayments = payments.length;
    const successfulPayments = payments.filter(p => p.status === 'succeeded').length;
    const pendingPayments = payments.filter(p => p.status === 'pending').length;
    const totalRevenue = payments
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + p.amount, 0);
    
    const stats = {
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
    };
    
    console.log('✅ Статистика отправлена:', stats);
    res.json(stats);
  } catch (error) {
    console.error('❌ Ошибка при получении статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/messages/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    console.log(`💬 Запрос сообщений для пользователя ${userId}`);
    const messagesData = loadMessages();
    const userMessages = messagesData.messages
      .filter(msg => msg.userId === userId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    console.log(`✅ Отправлено ${userMessages.length} сообщений`);
    res.json({ messages: userMessages });
  } catch (error) {
    console.error('❌ Ошибка при получении сообщений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { userId, message } = req.body;
    console.log(`📤 Отправка сообщения пользователю ${userId}: ${message}`);
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'Не указан userId или message' });
    }
    
    await bot.sendMessage(userId, message);
    addMessage(userId, message, true, 'admin');
    
    console.log('✅ Сообщение отправлено');
    res.json({ success: true, message: 'Сообщение отправлено' });
  } catch (error) {
    console.error('❌ Ошибка при отправке сообщения:', error);
    
    if (error.code === 403) {
      const usersData = loadUsers();
      const userIndex = usersData.users.findIndex(u => u.id === parseInt(userId));
      if (userIndex !== -1) {
        usersData.users[userIndex].is_blocked = true;
        saveUsers(usersData);
      }
      res.status(403).json({ error: 'Пользователь заблокировал бота' });
    } else {
      res.status(500).json({ error: 'Ошибка при отправке сообщения' });
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
        addMessage(userId, message, true, 'admin');
        sent++;
        
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`❌ Ошибка при отправке сообщения пользователю ${userId}:`, error);
        errors++;
        
        if (error.code === 403) {
          const usersData = loadUsers();
          const userIndex = usersData.users.findIndex(u => u.id === userId);
          if (userIndex !== -1) {
            usersData.users[userIndex].is_blocked = true;
            saveUsers(usersData);
          }
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

app.get('/api/join-requests', (req, res) => {
  try {
    console.log('📋 Запрос заявок на вступление');
    const requestsData = loadJoinRequests();
    const sortedRequests = requestsData.requests.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    console.log(`✅ Отправлено ${sortedRequests.length} заявок`);
    res.json({ requests: sortedRequests });
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

app.get('/api/subscriptions', (req, res) => {
  try {
    console.log('💳 Запрос подписок');
    const subscriptions = getAllSubscriptions();
    const usersData = loadUsers();
    
    const subscriptionsWithUsers = subscriptions.map(subscription => {
      const user = usersData.users.find(u => u.id === subscription.userId);
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

app.get('/api/payments', (req, res) => {
  try {
    console.log('💰 Запрос платежей');
    const payments = getAllPayments();
    const usersData = loadUsers();
    
    const paymentsWithUsers = payments.map(payment => {
      const user = usersData.users.find(u => u.id === payment.userId);
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

app.post('/api/deactivate-subscription', (req, res) => {
  try {
    const { userId } = req.body;
    console.log(`🚫 Деактивация подписки для пользователя ${userId}`);
    
    if (!userId) {
      return res.status(400).json({ error: 'Не указан userId' });
    }
    
    const success = deactivateSubscription(userId);
    
    if (success) {
      const usersData = loadUsers();
      const userIndex = usersData.users.findIndex(u => u.id === userId);
      if (userIndex !== -1) {
        usersData.users[userIndex].payment_status = 'unpaid';
        saveUsers(usersData);
      }
      
      console.log('✅ Подписка деактивирована');
      res.json({ success: true, message: 'Подписка деактивирована' });
    } else {
      res.status(404).json({ error: 'Активная подписка не найдена' });
    }
  } catch (error) {
    console.error('❌ Ошибка при деактивации подписки:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обработка запросов на вступление в канал
bot.on('chat_join_request', async (joinRequest) => {
  console.log('📥 Получен запрос на вступление:', joinRequest);
  
  const requestsData = loadJoinRequests();
  
  const existingPendingRequest = requestsData.requests.find(
    r => r.chatId === joinRequest.chat.id && 
         r.userId === joinRequest.from.id && 
         r.status === 'pending'
  );
  
  if (existingPendingRequest) {
    console.log(`⚠️ Запрос от пользователя ${joinRequest.from.id} уже существует и ожидает обработки`);
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
  
  addOrUpdateUser(joinRequest.from);
  
  const hasActiveSubscription = isSubscriptionActive(joinRequest.from.id);
  
  if (hasActiveSubscription) {
    try {
      await bot.approveChatJoinRequest(joinRequest.chat.id, joinRequest.from.id);
      newRequest.status = 'approved';
      newRequest.processed_at = new Date().toISOString();
      console.log(`✅ Запрос автоматически одобрен для пользователя с активной подпиской ${joinRequest.from.first_name} (ID: ${joinRequest.from.id})`);
    } catch (error) {
      console.error('❌ Ошибка при автоматическом одобрении запроса:', error);
    }
  } else {
    console.log(`⏳ Новый запрос на вступление от ${joinRequest.from.first_name} (ID: ${joinRequest.from.id}) - подписка неактивна`);
  }
  
  requestsData.requests.push(newRequest);
  saveJoinRequests(requestsData);
});

// Обработка команды /start
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const user = msg.from;
  
  addOrUpdateUser(user);
  addMessage(chatId, '/start', false, 'command');
  
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
        const payment = await createPayment(
          10,
          'Подписка на канал "Первый Панч" на 30 дней',
          user.id
        );
        
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
      if (data.startsWith('check_payment_')) {
        const paymentId = data.replace('check_payment_', '');
        
        try {
          const paymentStatus = await getPaymentStatus(paymentId);
          
          if (paymentStatus.status === 'succeeded') {
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

// Запуск сервера - КРИТИЧЕСКИ ВАЖНО: слушаем на всех интерфейсах!
app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 =================================');
  console.log(`🌐 API сервер запущен на порту ${PORT}`);
  console.log(`🤖 Бот "Первый Панч" работает`);
  console.log(`📊 API доступен по адресу: /api`);
  console.log(`🏥 Health check: /health`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'production'}`);
  console.log(`🔗 URL: https://telegram-bot-first-punch.onrender.com`);
  console.log('🚀 =================================');
});
