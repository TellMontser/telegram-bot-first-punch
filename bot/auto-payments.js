import { createYukassaPayment, getYukassaPayment, YUKASSA_CONFIG } from './yukassa.js';
import { addPayment, updatePaymentStatus, addSubscription, getUser, updatePaymentMethodStatus } from './lib/supabase.js';
import crypto from 'crypto';

// Конфигурация автоплатежей
export const AUTO_PAYMENT_CONFIG = {
  amount: 10, // 10 рублей за месяц
  intervalMinutes: 5, // Каждые 5 минут для тестирования (в продакшене будет 30 дней)
  description: 'Автоплатеж подписки "Первый Панч"'
};

// Функция для создания автоплатежа с сохранением платежного метода
export async function createAutoPayment(userId, user) {
  try {
    console.log(`💳 Создание автоплатежа для пользователя ${userId}`);
    
    if (!userId || !user) {
      throw new Error('Не указаны данные пользователя');
    }

    const amount = AUTO_PAYMENT_CONFIG.amount;
    const description = AUTO_PAYMENT_CONFIG.description;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'auto_subscription',
      auto_payment: 'true'
    };
    
    // Создаем платеж с сохранением платежного метода
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      confirmation: {
        type: 'redirect',
        return_url: 'https://t.me/firstpunch_bot'
      },
      capture: true,
      description: description,
      metadata: metadata,
      save_payment_method: true, // Сохраняем платежный метод для автоплатежей
      receipt: {
        customer: {
          full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь',
          email: `user${userId}@firstpunch.ru`,
          phone: '+79991234567'
        },
        items: [
          {
            description: 'Подписка на канал "Первый Панч" (автоплатеж)',
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service'
          }
        ],
        tax_system_code: 1
      }
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    const idempotenceKey = crypto.randomUUID();
    
    console.log('🔐 Отправка запроса автоплатежа в ЮKassa API...');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey
      },
      body: JSON.stringify(paymentData)
    });

    const responseText = await response.text();
    console.log(`📡 Ответ ЮKassa API (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Автоплатеж создан в ЮKassa:', payment.id);
    
    // Сохраняем платеж в базе данных
    await addPayment(
      userId, 
      payment.id, 
      parseFloat(payment.amount.value), 
      payment.status,
      payment.confirmation?.confirmation_url,
      'yukassa'
    );
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      confirmationUrl: payment.confirmation?.confirmation_url,
      createdAt: payment.created_at,
      paymentMethod: payment.payment_method
    };
  } catch (error) {
    console.error('❌ Ошибка создания автоплатежа:', error.message);
    throw error;
  }
}

// Функция для создания повторного платежа с сохраненным методом
export async function createRecurringPayment(userId, paymentMethodId, user) {
  try {
    console.log(`🔄 Создание повторного платежа для пользователя ${userId} с методом ${paymentMethodId}`);
    
    const amount = AUTO_PAYMENT_CONFIG.amount;
    const description = AUTO_PAYMENT_CONFIG.description;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'auto_subscription_recurring',
      auto_payment: 'true',
      payment_method_id: paymentMethodId
    };
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      payment_method_id: paymentMethodId,
      capture: true,
      description: description,
      metadata: metadata,
      receipt: {
        customer: {
          full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim() || 'Пользователь',
          email: `user${userId}@firstpunch.ru`,
          phone: '+79991234567'
        },
        items: [
          {
            description: 'Подписка на канал "Первый Панч" (автопродление)',
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1,
            payment_mode: 'full_payment',
            payment_subject: 'service'
          }
        ],
        tax_system_code: 1
      }
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    const idempotenceKey = crypto.randomUUID();
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey
      },
      body: JSON.stringify(paymentData)
    });

    const responseText = await response.text();
    console.log(`📡 Ответ ЮKassa API для повторного платежа (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Повторный платеж создан:', payment.id);
    
    // Сохраняем платеж в базе данных
    await addPayment(
      userId, 
      payment.id, 
      parseFloat(payment.amount.value), 
      payment.status,
      null, // Нет confirmation_url для автоплатежей
      'yukassa'
    );
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      createdAt: payment.created_at
    };
  } catch (error) {
    console.error('❌ Ошибка создания повторного платежа:', error.message);
    throw error;
  }
}

// Функция для отмены автоплатежей (отвязка платежного метода)
export async function cancelAutoPayments(userId) {
  try {
    console.log(`❌ Отмена автоплатежей для пользователя ${userId}`);
    
    // Деактивируем все платежные методы пользователя
    await updatePaymentMethodStatus(userId, false);
    
    console.log(`✅ Автоплатежи отменены для пользователя ${userId}`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка отмены автоплатежей:', error.message);
    throw error;
  }
}

// Функция для обработки успешного платежа и сохранения платежного метода
export async function handleSuccessfulAutoPayment(paymentId, paymentData) {
  try {
    console.log(`✅ Обработка успешного автоплатежа: ${paymentId}`);
    
    const userId = parseInt(paymentData.metadata?.userId);
    if (!userId) {
      throw new Error('Не найден userId в метаданных платежа');
    }
    
    // Обновляем статус платежа
    await updatePaymentStatus(paymentId, 'succeeded');
    
    // Если это первый платеж с сохранением метода
    if (paymentData.payment_method && paymentData.metadata?.auto_payment === 'true') {
      await savePaymentMethod(userId, paymentData.payment_method);
    }
    
    // Создаем или продлеваем подписку на 1 месяц
    const duration = 30; // 30 дней
    await addSubscription(userId, paymentId, AUTO_PAYMENT_CONFIG.amount, duration, 'yukassa');
    
    console.log(`✅ Подписка создана/продлена для пользователя ${userId}`);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка обработки успешного автоплатежа:', error.message);
    throw error;
  }
}

// Функция для сохранения платежного метода
export async function savePaymentMethod(userId, paymentMethod) {
  try {
    console.log(`💾 Сохранение платежного метода для пользователя ${userId}`);
    
    if (!paymentMethod || !paymentMethod.id) {
      throw new Error('Некорректные данные платежного метода');
    }
    
    const { error } = await supabase
      .from('payment_methods')
      .upsert({
        user_id: userId,
        payment_method_id: paymentMethod.id,
        type: paymentMethod.type || 'card',
        card_mask: paymentMethod.card?.last4 ? `****${paymentMethod.card.last4}` : null,
        is_active: true,
        auto_payments_enabled: true,
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'payment_method_id'
      });

    if (error) throw error;
    
    console.log(`✅ Платежный метод сохранен: ${paymentMethod.id}`);
    return true;
  } catch (error) {
    console.error('❌ Ошибка сохранения платежного метода:', error.message);
    throw error;
  }
}

// Функция для получения активных платежных методов пользователя
export async function getUserPaymentMethods(userId) {
  try {
    const { data, error } = await supabase
      .from('payment_methods')
      .select('*')
      .eq('user_id', userId)
      .eq('is_active', true)
      .eq('auto_payments_enabled', true);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('❌ Ошибка получения платежных методов:', error.message);
    return [];
  }
}

// Функция для запуска автоматических списаний (запускается по расписанию)
export async function processAutoPayments() {
  try {
    console.log('🔄 Запуск обработки автоплатежей...');
    
    // Получаем всех пользователей с активными автоплатежами
    const { data: paymentMethods, error } = await supabase
      .from('payment_methods')
      .select(`
        *,
        users (
          id,
          username,
          first_name,
          last_name,
          subscription_status
        )
      `)
      .eq('is_active', true)
      .eq('auto_payments_enabled', true);

    if (error) {
      console.error('❌ Ошибка получения платежных методов:', error);
      return;
    }

    if (!paymentMethods || paymentMethods.length === 0) {
      console.log('ℹ️ Нет активных автоплатежей');
      return;
    }

    console.log(`📋 Найдено ${paymentMethods.length} активных автоплатежей`);

    // Обрабатываем каждый автоплатеж
    for (const paymentMethod of paymentMethods) {
      try {
        const user = paymentMethod.users;
        if (!user) continue;

        console.log(`💳 Обработка автоплатежа для пользователя ${user.id}`);

        // Создаем повторный платеж
        const payment = await createRecurringPayment(
          user.id,
          paymentMethod.payment_method_id,
          user
        );

        // Если платеж успешен сразу (что бывает с сохраненными методами)
        if (payment.status === 'succeeded') {
          await handleSuccessfulAutoPayment(payment.paymentId, {
            metadata: {
              userId: user.id.toString(),
              auto_payment: 'true'
            }
          });
        }

        // Небольшая задержка между запросами
        await new Promise(resolve => setTimeout(resolve, 1000));
        
      } catch (error) {
        console.error(`❌ Ошибка обработки автоплатежа для пользователя ${paymentMethod.user_id}:`, error.message);
        
        // Если платежный метод недействителен, деактивируем его
        if (error.message.includes('payment_method_not_found') || 
            error.message.includes('invalid_payment_method')) {
          await updatePaymentMethodStatus(paymentMethod.user_id, false);
        }
      }
    }

    console.log('✅ Обработка автоплатежей завершена');
  } catch (error) {
    console.error('❌ Ошибка обработки автоплатежей:', error.message);
  }
}

// Экспортируем функции
export {
  AUTO_PAYMENT_CONFIG,
  createAutoPayment,
  createRecurringPayment,
  cancelAutoPayments,
  handleSuccessfulAutoPayment,
  savePaymentMethod,
  getUserPaymentMethods,
  processAutoPayments
};