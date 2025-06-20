import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createYukassaPayment } from './yukassa.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PAYMENTS_FILE = path.join(__dirname, 'data', 'payments.json');

// Создаем директорию для данных если её нет
const dataDir = path.dirname(PAYMENTS_FILE);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Инициализируем файл платежей если его нет
if (!fs.existsSync(PAYMENTS_FILE)) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ payments: [] }, null, 2));
}

// Функции для работы с платежами
export function loadPayments() {
  try {
    const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке платежей:', error);
    return { payments: [] };
  }
}

export function savePayments(paymentsData) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении платежей:', error);
  }
}

// Создание платежа для подписки
export async function createSubscriptionPayment(userId, userInfo) {
  try {
    console.log(`💳 Создание платежа для пользователя ${userId}`);
    
    const amount = 10; // 10 рублей
    const description = `Подписка на канал "Первый Панч" на 30 дней`;
    const metadata = {
      userId: userId.toString(),
      username: userInfo.username || '',
      first_name: userInfo.first_name || '',
      subscription_days: '30'
    };

    // Создаем платеж в ЮKassa
    const yukassaPayment = await createYukassaPayment(amount, description, metadata);
    
    // Сохраняем платеж в нашей базе
    const paymentsData = loadPayments();
    
    const payment = {
      id: Date.now() + Math.random(),
      userId: userId,
      paymentId: yukassaPayment.paymentId,
      amount: amount,
      status: 'pending',
      description: description,
      confirmationUrl: yukassaPayment.confirmationUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: metadata
    };
    
    paymentsData.payments.push(payment);
    savePayments(paymentsData);
    
    console.log('✅ Платеж сохранен в базе:', payment.id);
    
    return payment;
  } catch (error) {
    console.error('❌ Ошибка создания платежа:', error);
    throw error;
  }
}

// Обновление статуса платежа
export function updatePaymentStatus(paymentId, status) {
  try {
    console.log(`🔄 Обновление статуса платежа ${paymentId} на ${status}`);
    
    const paymentsData = loadPayments();
    const paymentIndex = paymentsData.payments.findIndex(p => p.paymentId === paymentId);
    
    if (paymentIndex !== -1) {
      paymentsData.payments[paymentIndex].status = status;
      paymentsData.payments[paymentIndex].updatedAt = new Date().toISOString();
      
      if (status === 'succeeded') {
        paymentsData.payments[paymentIndex].paidAt = new Date().toISOString();
      } else if (status === 'cancelled') {
        paymentsData.payments[paymentIndex].cancelledAt = new Date().toISOString();
      }
      
      savePayments(paymentsData);
      console.log('✅ Статус платежа обновлен');
      return paymentsData.payments[paymentIndex];
    } else {
      console.warn('⚠️ Платеж не найден:', paymentId);
      return null;
    }
  } catch (error) {
    console.error('❌ Ошибка обновления статуса платежа:', error);
    return null;
  }
}

// Получение платежа по ID ЮKassa
export function getPaymentByPaymentId(paymentId) {
  try {
    const paymentsData = loadPayments();
    return paymentsData.payments.find(p => p.paymentId === paymentId);
  } catch (error) {
    console.error('❌ Ошибка поиска платежа:', error);
    return null;
  }
}

// Получение всех платежей пользователя
export function getUserPayments(userId) {
  try {
    const paymentsData = loadPayments();
    return paymentsData.payments.filter(p => p.userId === userId);
  } catch (error) {
    console.error('❌ Ошибка получения платежей пользователя:', error);
    return [];
  }
}

// Получение успешных платежей
export function getSuccessfulPayments() {
  try {
    const paymentsData = loadPayments();
    return paymentsData.payments.filter(p => p.status === 'succeeded');
  } catch (error) {
    console.error('❌ Ошибка получения успешных платежей:', error);
    return [];
  }
}

// Получение общей суммы доходов
export function getTotalRevenue() {
  try {
    const successfulPayments = getSuccessfulPayments();
    return successfulPayments.reduce((total, payment) => total + payment.amount, 0);
  } catch (error) {
    console.error('❌ Ошибка подсчета доходов:', error);
    return 0;
  }
}

// Получение статистики платежей
export function getPaymentsStats() {
  try {
    const paymentsData = loadPayments();
    const payments = paymentsData.payments;
    
    const total = payments.length;
    const pending = payments.filter(p => p.status === 'pending').length;
    const succeeded = payments.filter(p => p.status === 'succeeded').length;
    const cancelled = payments.filter(p => p.status === 'cancelled').length;
    const revenue = getTotalRevenue();
    
    return {
      total,
      pending,
      succeeded,
      cancelled,
      revenue
    };
  } catch (error) {
    console.error('❌ Ошибка получения статистики платежей:', error);
    return {
      total: 0,
      pending: 0,
      succeeded: 0,
      cancelled: 0,
      revenue: 0
    };
  }
}