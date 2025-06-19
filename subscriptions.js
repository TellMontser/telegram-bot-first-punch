import fs from 'fs';
import path from 'path';

const SUBSCRIPTIONS_FILE = path.join(process.cwd(), 'data', 'subscriptions.json');

// Инициализируем файл подписок если его нет
if (!fs.existsSync(SUBSCRIPTIONS_FILE)) {
  fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify({ subscriptions: [] }, null, 2));
}

// Функция для загрузки подписок
export function loadSubscriptions() {
  try {
    const data = fs.readFileSync(SUBSCRIPTIONS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке подписок:', error);
    return { subscriptions: [] };
  }
}

// Функция для сохранения подписок
export function saveSubscriptions(subscriptionsData) {
  try {
    fs.writeFileSync(SUBSCRIPTIONS_FILE, JSON.stringify(subscriptionsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении подписок:', error);
  }
}

// Добавление новой подписки
export function addSubscription(userId, paymentId, amount, duration = 30) {
  const subscriptionsData = loadSubscriptions();
  
  const subscription = {
    id: Date.now() + Math.random(),
    userId: userId,
    paymentId: paymentId,
    amount: amount,
    duration: duration, // дни
    startDate: new Date().toISOString(),
    endDate: new Date(Date.now() + duration * 24 * 60 * 60 * 1000).toISOString(),
    status: 'active',
    createdAt: new Date().toISOString()
  };
  
  subscriptionsData.subscriptions.push(subscription);
  saveSubscriptions(subscriptionsData);
  
  return subscription;
}

// Проверка активности подписки
export function isSubscriptionActive(userId) {
  const subscriptionsData = loadSubscriptions();
  const userSubscriptions = subscriptionsData.subscriptions.filter(
    sub => sub.userId === userId && sub.status === 'active'
  );
  
  if (userSubscriptions.length === 0) return false;
  
  // Проверяем, не истекла ли подписка
  const now = new Date();
  const activeSubscription = userSubscriptions.find(sub => {
    const endDate = new Date(sub.endDate);
    return endDate > now;
  });
  
  if (!activeSubscription) {
    // Деактивируем истекшие подписки
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

// Получение подписки пользователя
export function getUserSubscription(userId) {
  const subscriptionsData = loadSubscriptions();
  const userSubscriptions = subscriptionsData.subscriptions.filter(
    sub => sub.userId === userId
  ).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  
  return userSubscriptions[0] || null;
}

// Деактивация подписки
export function deactivateSubscription(userId) {
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

// Получение всех подписок для админ панели
export function getAllSubscriptions() {
  const subscriptionsData = loadSubscriptions();
  return subscriptionsData.subscriptions.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

// Очистка истекших подписок (можно запускать периодически)
export function cleanupExpiredSubscriptions() {
  const subscriptionsData = loadSubscriptions();
  let updated = false;
  
  subscriptionsData.subscriptions.forEach(sub => {
    if (sub.status === 'active') {
      const endDate = new Date(sub.endDate);
      const now = new Date();
      
      if (endDate <= now) {
        sub.status = 'expired';
        updated = true;
      }
    }
  });
  
  if (updated) {
    saveSubscriptions(subscriptionsData);
  }
  
  return updated;
}