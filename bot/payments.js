import { addPayment } from './lib/supabase.js';
import { createYukassaPayment, createSimpleYukassaPayment, createAutoPayment } from './yukassa.js';
import { createCryptoCloudInvoice, createSimpleCryptoCloudPayment } from './cryptocloud.js';

// Минимальные суммы для разных платежных систем
const MIN_AMOUNTS = {
  yukassa: 10,    // 10 рублей для ЮKassa
  yukassa_auto: 10, // 10 рублей для автоплатежей ЮKassa
  cryptocloud: 50 // 50 рублей для CryptoCloud (минимум для криптоплатежей)
};

export async function createSubscriptionPayment(userId, user, paymentSystem = 'yukassa') {
  try {
    console.log(`💳 Создание платежа подписки для пользователя ${userId} через ${paymentSystem}`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }

    // Определяем сумму в зависимости от платежной системы
    const amount = MIN_AMOUNTS[paymentSystem] || MIN_AMOUNTS.yukassa;
    const description = paymentSystem === 'yukassa_auto' 
      ? `Автоподписка на канал "Первый Панч" (каждые 5 минут для теста)`
      : `Подписка на канал "Первый Панч" на 30 дней`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      email: `user${userId}@firstpunch.ru`, // Генерируем email для чека
      type: paymentSystem === 'yukassa_auto' ? 'auto_subscription' : 'subscription',
      paymentSystem: paymentSystem
    };
    
    console.log('🔄 Отправка запроса в платежную систему...');
    console.log('📋 Метаданные:', metadata);
    console.log('💰 Сумма:', amount, 'рублей');
    
    let payment;
    
    if (paymentSystem === 'yukassa_auto') {
      // Создаем автоплатеж в ЮKassa с сохранением способа оплаты
      payment = await createAutoPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
    } else if (paymentSystem === 'cryptocloud') {
      // Создаем платеж в CryptoCloud
      payment = await createSimpleCryptoCloudPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
    } else {
      // Создаем обычный платеж в ЮKassa (по умолчанию)
      payment = await createSimpleYukassaPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
    }
    
    console.log('✅ Платеж создан:', payment);
    
    if (!payment.confirmationUrl) {
      console.error('❌ Не получена ссылка для оплаты');
      throw new Error('Не получена ссылка для оплаты');
    }
    
    // Сохраняем платеж в Supabase с указанием платежной системы
    const supabasePayment = await addPayment(
      userId, 
      payment.paymentId, 
      payment.amount, 
      payment.status,
      payment.confirmationUrl,
      paymentSystem
    );
    
    console.log('✅ Платеж сохранен в Supabase:', supabasePayment);
    
    return {
      paymentId: payment.paymentId,
      confirmationUrl: payment.confirmationUrl,
      amount: payment.amount,
      status: payment.status,
      paymentSystem: paymentSystem,
      minAmount: MIN_AMOUNTS[paymentSystem],
      paymentMethodId: payment.paymentMethodId || null
    };
  } catch (error) {
    console.error('❌ Ошибка при создании платежа подписки:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось создать платеж: ${error.message}`);
  }
}

// Функция для получения доступных платежных систем с их минимальными суммами
export function getAvailablePaymentSystems() {
  return [
    {
      id: 'yukassa',
      name: 'ЮKassa (разовый)',
      description: 'Банковские карты, электронные кошельки - разовый платеж',
      minAmount: MIN_AMOUNTS.yukassa,
      currency: '₽',
      icon: '💳',
      recommended: false
    },
    {
      id: 'yukassa_auto',
      name: 'ЮKassa (автоплатеж)',
      description: 'Банковские карты - автоматическое продление каждые 5 минут (тест)',
      minAmount: MIN_AMOUNTS.yukassa_auto,
      currency: '₽',
      icon: '🔄',
      recommended: true
    },
    {
      id: 'cryptocloud',
      name: 'CryptoCloud',
      description: 'Bitcoin, Ethereum, USDT и другие криптовалюты',
      minAmount: MIN_AMOUNTS.cryptocloud,
      currency: '₽',
      icon: '₿',
      recommended: false
    }
  ];
}

// Функция для проверки минимальной суммы
export function validatePaymentAmount(amount, paymentSystem) {
  const minAmount = MIN_AMOUNTS[paymentSystem] || MIN_AMOUNTS.yukassa;
  return amount >= minAmount;
}

// Функция для получения рекомендуемой платежной системы на основе суммы
export function getRecommendedPaymentSystem(amount) {
  if (amount >= MIN_AMOUNTS.yukassa_auto) {
    return 'yukassa_auto'; // Рекомендуем автоплатеж
  } else if (amount >= MIN_AMOUNTS.yukassa && amount < MIN_AMOUNTS.cryptocloud) {
    return 'yukassa';
  } else if (amount >= MIN_AMOUNTS.cryptocloud) {
    return 'yukassa_auto'; // Автоплатеж остается рекомендуемым
  } else {
    return 'yukassa'; // По умолчанию ЮKassa
  }
}