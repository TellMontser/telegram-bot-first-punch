import { addPayment, addPaymentMethod, getPaymentMethodByUserId, getUser } from './lib/supabase.js';
import { createRecurringPayment, createAutoPayment } from './yukassa.js';

// Настройки рекуррентных платежей
export const RECURRING_CONFIG = {
  initialAmount: 10,        // Стартовое списание 10 рублей
  recurringAmount: 10,      // Каждое списание 10 рублей
  intervalMinutes: 10,      // Интервал 10 минут
  paymentSystem: 'yukassa'  // Только ЮKassa
};

export async function createRecurringSubscription(userId, user) {
  try {
    console.log(`💳 Создание рекуррентной подписки для пользователя ${userId}`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }

    // Проверяем, есть ли уже активный способ оплаты
    const existingPaymentMethod = await getPaymentMethodByUserId(userId);
    if (existingPaymentMethod && existingPaymentMethod.auto_payments_enabled) {
      throw new Error('У пользователя уже есть активная рекуррентная подписка');
    }

    const amount = RECURRING_CONFIG.initialAmount;
    const description = `Рекуррентная подписка на канал "Первый Панч" - стартовый платеж`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'recurring_subscription',
      paymentSystem: RECURRING_CONFIG.paymentSystem
    };
    
    console.log('🔄 Создание стартового рекуррентного платежа...');
    console.log('📋 Метаданные:', metadata);
    console.log('💰 Сумма:', amount, 'рублей');
    
    // Создаем стартовый рекуррентный платеж с сохранением способа оплаты
    const payment = await createRecurringPayment(amount, description, user, metadata);
    
    console.log('✅ Рекуррентный платеж создан:', payment);
    
    if (!payment.confirmationUrl) {
      console.error('❌ Не получена ссылка для оплаты');
      throw new Error('Не получена ссылка для оплаты');
    }
    
    // Сохраняем платеж в Supabase
    const supabasePayment = await addPayment(
      userId, 
      payment.paymentId, 
      payment.amount, 
      payment.status,
      payment.confirmationUrl,
      RECURRING_CONFIG.paymentSystem
    );
    
    console.log('✅ Рекуррентный платеж сохранен в Supabase:', supabasePayment);
    
    return {
      paymentId: payment.paymentId,
      confirmationUrl: payment.confirmationUrl,
      amount: payment.amount,
      status: payment.status,
      paymentSystem: RECURRING_CONFIG.paymentSystem,
      isRecurring: true
    };
  } catch (error) {
    console.error('❌ Ошибка при создании рекуррентной подписки:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось создать рекуррентную подписку: ${error.message}`);
  }
}

// Функция для создания автоплатежа
export async function processAutoPayment(paymentMethodId, userId) {
  try {
    console.log(`🔄 Обработка автоплатежа для пользователя ${userId} с методом ${paymentMethodId}`);
    
    const user = await getUser(userId);
    if (!user) {
      throw new Error('Пользователь не найден');
    }

    const amount = RECURRING_CONFIG.recurringAmount;
    const description = `Автоплатеж за подписку "Первый Панч" - ${amount}₽`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'auto_payment',
      paymentSystem: RECURRING_CONFIG.paymentSystem
    };
    
    console.log('💳 Создание автоплатежа...');
    
    // Создаем автоплатеж с сохраненным способом оплаты
    const payment = await createAutoPayment(paymentMethodId, amount, description, user, metadata);
    
    console.log('✅ Автоплатеж создан:', payment);
    
    // Сохраняем платеж в Supabase
    const supabasePayment = await addPayment(
      userId, 
      payment.paymentId, 
      payment.amount, 
      payment.status,
      null, // Нет URL подтверждения для автоплатежей
      RECURRING_CONFIG.paymentSystem
    );
    
    console.log('✅ Автоплатеж сохранен в Supabase:', supabasePayment);
    
    return {
      paymentId: payment.paymentId,
      amount: payment.amount,
      status: payment.status,
      paymentSystem: RECURRING_CONFIG.paymentSystem,
      isAutoPayment: true
    };
  } catch (error) {
    console.error('❌ Ошибка при обработке автоплатежа:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось обработать автоплатеж: ${error.message}`);
  }
}

// Функция для получения информации о рекуррентных платежах
export function getRecurringConfig() {
  return {
    ...RECURRING_CONFIG,
    intervalMs: RECURRING_CONFIG.intervalMinutes * 60 * 1000, // Интервал в миллисекундах
    description: `Автоплатежи каждые ${RECURRING_CONFIG.intervalMinutes} минут по ${RECURRING_CONFIG.recurringAmount}₽`
  };
}

// Функция для проверки, нужно ли создать автоплатеж
export function shouldCreateAutoPayment(lastPaymentDate, intervalMinutes = RECURRING_CONFIG.intervalMinutes) {
  if (!lastPaymentDate) return true;
  
  const now = new Date();
  const lastPayment = new Date(lastPaymentDate);
  const diffMinutes = (now - lastPayment) / (1000 * 60);
  
  return diffMinutes >= intervalMinutes;
}

// Функция для валидации рекуррентного платежа
export function validateRecurringPayment(amount, paymentSystem) {
  if (amount < RECURRING_CONFIG.initialAmount) {
    return false;
  }
  
  if (paymentSystem !== RECURRING_CONFIG.paymentSystem) {
    return false;
  }
  
  return true;
}