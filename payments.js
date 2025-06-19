import fs from 'fs';
import path from 'path';

const PAYMENTS_FILE = path.join(process.cwd(), 'data', 'payments.json');

// Инициализируем файл платежей если его нет
if (!fs.existsSync(PAYMENTS_FILE)) {
  fs.writeFileSync(PAYMENTS_FILE, JSON.stringify({ payments: [] }, null, 2));
}

// Функция для загрузки платежей
export function loadPayments() {
  try {
    const data = fs.readFileSync(PAYMENTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Ошибка при загрузке платежей:', error);
    return { payments: [] };
  }
}

// Функция для сохранения платежей
export function savePayments(paymentsData) {
  try {
    fs.writeFileSync(PAYMENTS_FILE, JSON.stringify(paymentsData, null, 2));
  } catch (error) {
    console.error('Ошибка при сохранении платежей:', error);
  }
}

// Добавление нового платежа
export function addPayment(userId, paymentId, amount, status = 'pending') {
  const paymentsData = loadPayments();
  
  const payment = {
    id: Date.now() + Math.random(),
    userId: userId,
    paymentId: paymentId,
    amount: amount,
    status: status, // pending, succeeded, cancelled
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  
  paymentsData.payments.push(payment);
  savePayments(paymentsData);
  
  return payment;
}

// Обновление статуса платежа
export function updatePaymentStatus(paymentId, status) {
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

// Получение платежа по ID
export function getPayment(paymentId) {
  const paymentsData = loadPayments();
  return paymentsData.payments.find(p => p.paymentId === paymentId) || null;
}

// Получение всех платежей пользователя
export function getUserPayments(userId) {
  const paymentsData = loadPayments();
  return paymentsData.payments.filter(p => p.userId === userId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

// Получение всех платежей для админ панели
export function getAllPayments() {
  const paymentsData = loadPayments();
  return paymentsData.payments.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}