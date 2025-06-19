import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import TelegramBot from 'node-telegram-bot-api';
import { fileURLToPath } from 'url';

// Получаем __dirname для ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Импортируем функции из bot файлов
import { approveJoinRequest, declineJoinRequest, kickUserFromChannel } from './index.js';
import { getAllSubscriptions, isSubscriptionActive, deactivateSubscription } from './subscriptions.js';
import { getAllPayments } from './payments.js';
import { verifyWebhookSignature } from './yukassa.js';
import { updatePaymentStatus } from './payments.js';
import { addSubscription } from './subscriptions.js';

const DATA_FILE = path.join(__dirname, 'data', 'users.json');
const MESSAGES_FILE = path.join(__dirname, 'data', 'messages.json');
const JOIN_REQUESTS_FILE = path.join(__dirname, 'data', 'join_requests.json');
const BOT_TOKEN = '7604320716:AAFK-L72uch_OF2gliQacoPVz4RjlqvZXlc';

const bot = new TelegramBot(BOT_TOKEN);

app.use(cors());
app.use(express.json());

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

function loadJoinRequests() {
  try {
    const data = fs.readFileSync(JOIN_REQUESTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке запросов на вступление:', error);
    return { requests: [] };
  }
}

function saveMessages(messagesData) {
  try {
    fs.writeFileSync(MESSAGES_FILE, JSON.stringify(messagesData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении сообщений:', error);
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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API endpoints
app.get('/api/users', (req, res) => {
  try {
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
    
    res.json({ users: usersWithSubscriptionStatus });
  } catch (error) {
    console.error('Ошибка при получении пользователей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/stats', (req, res) => {
  try {
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
    console.error('Ошибка при получении статистики:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/messages/:userId', (req, res) => {
  try {
    const userId = parseInt(req.params.userId);
    const messagesData = loadMessages();
    const userMessages = messagesData.messages
      .filter(msg => msg.userId === userId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    
    res.json({ messages: userMessages });
  } catch (error) {
    console.error('Ошибка при получении сообщений:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/send-message', async (req, res) => {
  try {
    const { userId, message } = req.body;
    
    if (!userId || !message) {
      return res.status(400).json({ error: 'Не указан userId или message' });
    }
    
    await bot.sendMessage(userId, message);
    addMessage(userId, message, true, 'admin');
    
    res.json({ success: true, message: 'Сообщение отправлено' });
  } catch (error) {
    console.error('Ошибка при отправке сообщения:', error);
    
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
        console.error(`Ошибка при отправке сообщения пользователю ${userId}:`, error);
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
    
    res.json({ 
      success: true, 
      sent, 
      errors, 
      total: userIds.length,
      message: `Рассылка завершена. Отправлено: ${sent}, ошибок: ${errors}` 
    });
  } catch (error) {
    console.error('Ошибка при рассылке:', error);
    res.status(500).json({ error: 'Ошибка при рассылке' });
  }
});

// Остальные API endpoints...
app.get('/api/join-requests', (req, res) => {
  try {
    const requestsData = loadJoinRequests();
    const sortedRequests = requestsData.requests.sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
    res.json({ requests: sortedRequests });
  } catch (error) {
    console.error('Ошибка при получении запросов на вступление:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.post('/api/approve-join-request', async (req, res) => {
  try {
    const { chatId, userId } = req.body;
    
    if (!chatId || !userId) {
      return res.status(400).json({ error: 'Не указан chatId или userId' });
    }
    
    await approveJoinRequest(chatId, userId);
    res.json({ success: true, message: 'Запрос одобрен' });
  } catch (error) {
    console.error('Ошибка при одобрении запроса:', error);
    res.status(500).json({ error: 'Ошибка при одобрении запроса' });
  }
});

app.get('/api/subscriptions', (req, res) => {
  try {
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
    
    res.json({ subscriptions: subscriptionsWithUsers });
  } catch (error) {
    console.error('Ошибка при получении подписок:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.get('/api/payments', (req, res) => {
  try {
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
    
    res.json({ payments: paymentsWithUsers });
  } catch (error) {
    console.error('Ошибка при получении платежей:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обработка 404
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Endpoint не найден' });
});

app.listen(PORT, () => {
  console.log(`🌐 API сервер запущен на порту ${PORT}`);
  console.log(`🤖 Бот "Первый Панч" работает`);
  console.log(`📊 API доступен по адресу: /api`);
});