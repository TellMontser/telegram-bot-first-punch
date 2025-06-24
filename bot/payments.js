import { addPayment, addPaymentMethod, enableAutoPayments } from './lib/supabase.js';
import { createYukassaPayment, createSimpleYukassaPayment } from './yukassa.js';
import { createCryptoCloudInvoice, createSimpleCryptoCloudPayment } from './cryptocloud.js';

// Минимальные суммы для разных платежных систем
const MIN_AMOUNTS = {
  yukassa: 10,    // 10 рублей для ЮKassa
  cryptocloud: 50 // 50 рублей для CryptoCloud (минимум для криптоплатежей)
};

export async function createSubscriptionPayment(userId, user, paymentSystem = 'yukassa', enableAuto = false) {
  try {
    console.log(`💳 Создание платежа подписки для пользователя ${userId} через ${paymentSystem}, автоплатеж: ${enableAuto}`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }

    // Определяем сумму в зависимости от платежной системы
    const amount = MIN_AMOUNTS[paymentSystem] || MIN_AMOUNTS.yukassa;
    const description = enableAuto 
      ? `Автоподписка на канал "Первый Панч" (каждые 5 минут)`
      : `Подписка на канал "Первый Панч" на 30 дней`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'subscription',
      paymentSystem: paymentSystem,
      autoPayment: enableAuto.toString()
    };
    
    console.log('🔄 Отправка запроса в платежную систему...');
    console.log('📋 Метаданные:', metadata);
    console.log('💰 Сумма:', amount, 'рублей');
    console.log('🔄 Автоплатеж:', enableAuto);
    
    let payment;
    
    if (paymentSystem === 'cryptocloud') {
      // CryptoCloud не поддерживает автоплатежи
      if (enableAuto) {
        throw new Error('CryptoCloud не поддерживает автоплатежи. Используйте ЮKassa.');
      }
      payment = await createSimpleCryptoCloudPayment(amount, description, 'https://t.me/firstpunch_bot', metadata);
    } else {
      // Создаем платеж в ЮKassa с сохранением способа оплаты для автоплатежей
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
      autoPayment: enableAuto,
      paymentMethodId: payment.paymentMethodId || null
    };
  } catch (error) {
    console.error('❌ Ошибка при создании платежа подписки:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось создать платеж: ${error.message}`);
  }
}

// Функция для создания автоплатежа (используется планировщиком)
export async function createAutoSubscriptionPayment(userId, paymentMethodId, amount = 10) {
  try {
    console.log(`🔄 Создание автоплатежа для пользователя ${userId} с методом ${paymentMethodId}`);
    
    const { createAutoPayment } = await import('./yukassa.js');
    
    const description = `Автоплатеж подписки "Первый Панч"`;
    const metadata = {
      userId: userId.toString(),
      type: 'auto_subscription',
      paymentSystem: 'yukassa'
    };
    
    const payment = await createAutoPayment(paymentMethodId, amount, description, metadata);
    
    // Сохраняем автоплатеж в базу данных
    const supabasePayment = await addPayment(
      userId,
      payment.paymentId,
      payment.amount,
      payment.status,
      null, // Нет confirmation_url для автоплатежей
      'yukassa'
    );
    
    console.log('✅ Автоплатеж создан и сохранен:', payment.paymentId);
    
    return {
      paymentId: payment.paymentId,
      amount: payment.amount,
      status: payment.status,
      paymentSystem: 'yukassa'
    };
  } catch (error) {
    console.error('❌ Ошибка при создании автоплатежа:', error);
    throw error;
  }
}

// Функция для обработки успешного платежа и сохранения способа оплаты
export async function handleSuccessfulPayment(payment, enableAutoPayments = false) {
  try {
    console.log('✅ Обработка успешного платежа:', payment.id);
    
    const userId = parseInt(payment.metadata.userId);
    
    // Если платеж содержит способ оплаты и нужно включить автоплатежи
    if (payment.payment_method && payment.payment_method.id && enableAutoPayments) {
      console.log('💳 Сохранение способа оплаты для автоплатежей:', payment.payment_method.id);
      
      // Определяем маску карты
      let cardMask = null;
      if (payment.payment_method.card) {
        cardMask = `**** **** **** ${payment.payment_method.card.last4}`;
      }
      
      // Сохраняем способ оплаты
      await addPaymentMethod(
        userId,
        payment.payment_method.id,
        payment.payment_method.type || 'card',
        cardMask,
        true // Включаем автоплатежи
      );
      
      console.log('✅ Способ оплаты сохранен с включенными автоплатежами');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при обработке успешного платежа:', error);
    return false;
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
      supportsAutoPayments: true
    },
    {
      id: 'cryptocloud',
      name: 'CryptoCloud',
      description: 'Bitcoin, Ethereum, USDT и другие криптовалюты',
      minAmount: MIN_AMOUNTS.cryptocloud,
      currency: '₽',
      icon: '₿',
      recommended: false,
      supportsAutoPayments: false
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