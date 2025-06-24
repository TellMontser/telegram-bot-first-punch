import { addPayment } from './lib/supabase.js';
import { createYukassaPayment, createSimpleYukassaPayment } from './yukassa.js';
import { createCryptoCloudInvoice, createSimpleCryptoCloudPayment } from './cryptocloud.js';
import { createRecurringPayment } from './yukassa-recurring.js';

// Минимальные суммы для разных платежных систем
const MIN_AMOUNTS = {
  yukassa: 10,    // 10 рублей для ЮKassa
  cryptocloud: 50 // 50 рублей для CryptoCloud (минимум для криптоплатежей)
};

export async function createSubscriptionPayment(userId, user, paymentSystem = 'yukassa', isRecurring = false) {
  try {
    console.log(`💳 Создание платежа подписки для пользователя ${userId} через ${paymentSystem} (рекуррентный: ${isRecurring})`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }

    // Определяем сумму в зависимости от платежной системы
    const amount = MIN_AMOUNTS[paymentSystem] || MIN_AMOUNTS.yukassa;
    const description = isRecurring 
      ? `Автоподписка на канал "Первый Панч" на 30 дней`
      : `Подписка на канал "Первый Панч" на 30 дней`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      type: isRecurring ? 'auto_subscription' : 'subscription',
      paymentSystem: paymentSystem,
      email: 'user@firstpunch.ru',
      phone: '+79991234567'
    };
    
    console.log('🔄 Отправка запроса в платежную систему...');
    console.log('📋 Метаданные:', metadata);
    console.log('💰 Сумма:', amount, 'рублей');
    
    let payment;
    
    if (paymentSystem === 'cryptocloud') {
      // Создаем платеж в CryptoCloud
      payment = await createSimpleCryptoCloudPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
    } else {
      // Создаем платеж в ЮKassa
      if (isRecurring) {
        // Рекуррентный платеж с сохранением способа оплаты
        payment = await createRecurringPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
      } else {
        // Обычный платеж
        payment = await createSimpleYukassaPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
      }
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
      paymentMethodId: payment.paymentMethodId, // Для рекуррентных платежей
      isRecurring: isRecurring
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
      name: 'ЮKassa',
      description: 'Банковские карты, электронные кошельки',
      minAmount: MIN_AMOUNTS.yukassa,
      currency: '₽',
      icon: '💳',
      recommended: true,
      supportsRecurring: true
    },
    {
      id: 'cryptocloud',
      name: 'CryptoCloud',
      description: 'Bitcoin, Ethereum, USDT и другие криптовалюты',
      minAmount: MIN_AMOUNTS.cryptocloud,
      currency: '₽',
      icon: '₿',
      recommended: false,
      supportsRecurring: false
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
  if (amount >= MIN_AMOUNTS.yukassa && amount < MIN_AMOUNTS.cryptocloud) {
    return 'yukassa';
  } else if (amount >= MIN_AMOUNTS.cryptocloud) {
    return 'yukassa'; // ЮKassa остается рекомендуемой
  } else {
    return 'yukassa'; // По умолчанию ЮKassa
  }
}