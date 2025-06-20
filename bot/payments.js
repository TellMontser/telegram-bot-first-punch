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

// Инициализируем файл с платежами если его нет
if (!fs.existsSync(PAYMENTS_FILE)) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ payments: [] }, null, 2));
}

// Функции для работы с платежами
export function loadPayments() {
  try {
    const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('❌ Ошибка при загрузке платежей:', error);
    return { payments: [] };
  }
}

export function savePayments(paymentsData) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentsData, null, 2));
    console.log('✅ Платежи сохранены');
  } catch (error) {
    console.error('❌ Ошибка при сохранении платежей:', error);
  }
}

export function addPayment(userId, paymentId, amount, status = 'pending', confirmationUrl = null) {
  try {
    const paymentsData = loadPayments();
    
    const payment = {
      id: Date.now() + Math.random(),
      userId: userId,
      paymentId: paymentId,
      amount: amount,
      status: status,
      confirmationUrl: confirmationUrl,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    paymentsData.payments.push(payment);
    savePayments(paymentsData);
    
    console.log(`✅ Платеж добавлен: ${paymentId} для пользователя ${userId}`);
    return payment;
  } catch (error) {
    console.error('❌ Ошибка при добавлении платежа:', error);
    throw error;
  }
}

export function updatePaymentStatus(paymentId, status) {
  try {
    const paymentsData = loadPayments();
    const paymentIndex = paymentsData.payments.findIndex(p => p.paymentId === paymentId);
    
    if (paymentIndex !== -1) {
      paymentsData.payments[paymentIndex].status = status;
      paymentsData.payments[paymentIndex].updatedAt = new Date().toISOString();
      savePayments(paymentsData);
      
      console.log(`✅ Статус платежа ${paymentId} обновлен на ${status}`);
      return paymentsData.payments[paymentIndex];
    } else {
      console.log(`⚠️ Платеж ${paymentId} не найден для обновления статуса`);
      return null;
    }
  } catch (error) {
    console.error('❌ Ошибка при обновлении статуса платежа:', error);
    throw error;
  }
}

export function getPaymentByPaymentId(paymentId) {
  try {
    const paymentsData = loadPayments();
    const payment = paymentsData.payments.find(p => p.paymentId === paymentId);
    
    if (payment) {
      console.log(`✅ Платеж найден: ${paymentId}`);
    } else {
      console.log(`⚠️ Платеж не найден: ${paymentId}`);
    }
    
    return payment || null;
  } catch (error) {
    console.error('❌ Ошибка при поиске платежа:', error);
    return null;
  }
}

export async function createSubscriptionPayment(userId, user) {
  try {
    console.log(`💳 Создание платежа подписки для пользователя ${userId}`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }
    
    const amount = 10; // 10 рублей
    const description = `Подписка на канал "Первый Панч" на 30 дней`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'subscription'
    };
    
    console.log('🔄 Отправка запроса в ЮKassa...');
    console.log('📋 Метаданные:', metadata);
    
    // Создаем платеж в ЮKassa
    const yukassaPayment = await createYukassaPayment(amount, description, metadata);
    
    console.log('✅ Платеж создан в ЮKassa:', yukassaPayment);
    
    if (!yukassaPayment.confirmationUrl) {
      console.error('❌ Не получена ссылка для оплаты от ЮKassa');
      throw new Error('Не получена ссылка для оплаты от ЮKassa');
    }
    
    // Сохраняем платеж в локальной базе
    const localPayment = addPayment(
      userId, 
      yukassaPayment.paymentId, 
      yukassaPayment.amount, 
      yukassaPayment.status,
      yukassaPayment.confirmationUrl
    );
    
    console.log('✅ Платеж сохранен локально:', localPayment);
    
    return {
      paymentId: yukassaPayment.paymentId,
      confirmationUrl: yukassaPayment.confirmationUrl,
      amount: yukassaPayment.amount,
      status: yukassaPayment.status
    };
  } catch (error) {
    console.error('❌ Ошибка при создании платежа подписки:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось создать платеж: ${error.message}`);
  }
}