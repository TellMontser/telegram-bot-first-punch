import crypto from 'crypto';
import { getUserPaymentData } from './lib/supabase.js';

// Конфигурация ЮKassa с использованием переменных окружения
export const YUKASSA_CONFIG = {
  shopId: process.env.YUKASSA_SHOP_ID || '1103466',
  secretKey: process.env.YUKASSA_SECRET_KEY || 'live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo',
  apiUrl: 'https://api.yookassa.ru/v3'
};

// Проверка наличия необходимых переменных окружения
if (!YUKASSA_CONFIG.shopId || !YUKASSA_CONFIG.secretKey) {
  console.error('❌ КРИТИЧЕСКАЯ ОШИБКА: Не заданы переменные окружения YUKASSA_SHOP_ID или YUKASSA_SECRET_KEY');
}

// Функция для создания правильного чека
async function createReceiptData(userId, amount, description) {
  try {
    // Получаем платежные данные пользователя
    const paymentData = await getUserPaymentData(userId);
    
    if (!paymentData || (!paymentData.email && !paymentData.phone)) {
      throw new Error('Не заполнены данные для чека. Необходимо указать email или телефон.');
    }

    const customer = {};
    
    // Добавляем email если есть
    if (paymentData.email) {
      customer.email = paymentData.email;
    }
    
    // Добавляем телефон если есть
    if (paymentData.phone) {
      customer.phone = paymentData.phone;
    }
    
    // Добавляем ФИО если есть
    if (paymentData.full_name) {
      customer.full_name = paymentData.full_name;
    } else if (paymentData.first_name || paymentData.last_name) {
      customer.full_name = `${paymentData.first_name || ''} ${paymentData.last_name || ''}`.trim();
    }

    const receipt = {
      customer: customer,
      items: [
        {
          description: description || 'Подписка на канал "Первый Панч"',
          quantity: '1.00',
          amount: {
            value: amount.toFixed(2),
            currency: 'RUB'
          },
          vat_code: 1, // без НДС
          payment_mode: 'full_payment',
          payment_subject: 'service'
        }
      ],
      tax_system_code: 1 // ОСН (общая система налогообложения)
    };

    console.log('📋 Создан чек для ЮKassa:', JSON.stringify(receipt, null, 2));
    return receipt;
  } catch (error) {
    console.error('❌ Ошибка создания чека:', error);
    throw error;
  }
}

// Функция для создания простого платежа с правильным чеком
export async function createSimpleYukassaPayment(amount, description, returnUrl, metadata = {}) {
  try {
    console.log('💳 Создание простого платежа в ЮKassa:', { amount, description, returnUrl, metadata });
    
    // Проверяем наличие необходимых данных
    if (!amount || amount <= 0) {
      throw new Error('Некорректная сумма платежа');
    }
    
    if (!description) {
      throw new Error('Не указано описание платежа');
    }
    
    if (!metadata.userId) {
      throw new Error('Не указан ID пользователя в метаданных');
    }
    
    // Проверяем конфигурацию
    if (!YUKASSA_CONFIG.shopId || !YUKASSA_CONFIG.secretKey) {
      throw new Error('Не настроены данные для подключения к ЮKassa');
    }
    
    // Создаем чек с данными пользователя
    const receipt = await createReceiptData(metadata.userId, amount, description);
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      confirmation: {
        type: 'redirect',
        return_url: returnUrl || 'https://t.me/firstpunch_bot'
      },
      capture: true,
      description: description,
      metadata: metadata,
      save_payment_method: true, // Сохраняем способ оплаты для автоплатежей
      receipt: receipt // Добавляем правильный чек
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    const idempotenceKey = crypto.randomUUID();
    
    console.log('🔐 Отправка простого запроса в ЮKassa API...');
    console.log('📦 Данные простого платежа:', JSON.stringify(paymentData, null, 2));
    
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
        console.error('❌ Детали ошибки ЮKassa:', errorJson);
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки, используем текст как есть');
      }
      
      console.error('❌ Ошибка ЮKassa API:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Простой платеж создан в ЮKassa:', payment.id);
    console.log('🔗 Ссылка для оплаты:', payment.confirmation?.confirmation_url);
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      confirmationUrl: payment.confirmation?.confirmation_url,
      createdAt: payment.created_at,
      paymentMethodId: payment.payment_method?.id || null
    };
  } catch (error) {
    console.error('❌ Ошибка создания простого платежа в ЮKassa:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw error;
  }
}

// Функция для создания автоплатежа с правильным чеком
export async function createAutoPayment(paymentMethodId, amount, description, metadata = {}) {
  try {
    console.log('🔄 Создание автоплатежа в ЮKassa:', { paymentMethodId, amount, description, metadata });
    
    if (!paymentMethodId) {
      throw new Error('Не указан ID способа оплаты');
    }
    
    if (!amount || amount <= 0) {
      throw new Error('Некорректная сумма платежа');
    }
    
    if (!metadata.userId) {
      throw new Error('Не указан ID пользователя в метаданных');
    }
    
    // Создаем чек с данными пользователя
    const receipt = await createReceiptData(metadata.userId, amount, description);
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      payment_method_id: paymentMethodId,
      capture: true,
      description: description,
      metadata: metadata,
      receipt: receipt // Добавляем правильный чек для автоплатежа
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    const idempotenceKey = crypto.randomUUID();
    
    console.log('🔐 Отправка запроса автоплатежа в ЮKassa API...');
    console.log('📦 Данные автоплатежа:', JSON.stringify(paymentData, null, 2));
    
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
    console.log(`📡 Ответ ЮKassa API для автоплатежа (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
        console.error('❌ Детали ошибки автоплатежа ЮKassa:', errorJson);
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      console.error('❌ Ошибка автоплатежа ЮKassa API:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа автоплатежа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Автоплатеж создан в ЮKassa:', payment.id);
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      createdAt: payment.created_at
    };
  } catch (error) {
    console.error('❌ Ошибка создания автоплатежа в ЮKassa:', error.message);
    throw error;
  }
}

// Функция для получения информации о способе оплаты
export async function getPaymentMethod(paymentMethodId) {
  try {
    console.log('🔍 Получение информации о способе оплаты:', paymentMethodId);
    
    if (!paymentMethodId) {
      throw new Error('Не указан ID способа оплаты');
    }
    
    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payment_methods/${paymentMethodId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    const responseText = await response.text();
    console.log(`📡 Ответ ЮKassa API для способа оплаты ${paymentMethodId} (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      console.error('❌ Ошибка получения способа оплаты:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let paymentMethod;
    try {
      paymentMethod = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Информация о способе оплаты получена:', paymentMethod.id);
    
    return paymentMethod;
  } catch (error) {
    console.error('❌ Ошибка получения способа оплаты:', error.message);
    throw error;
  }
}

// Функция для создания платежа в ЮKassa (с чеком - оставляем для совместимости)
export async function createYukassaPayment(amount, description, metadata = {}) {
  try {
    console.log('💳 Создание платежа в ЮKassa:', { amount, description, metadata });
    
    // Проверяем наличие необходимых данных
    if (!amount || amount <= 0) {
      throw new Error('Некорректная сумма платежа');
    }
    
    if (!description) {
      throw new Error('Не указано описание платежа');
    }
    
    if (!metadata.userId) {
      throw new Error('Не указан ID пользователя в метаданных');
    }
    
    // Проверяем конфигурацию
    if (!YUKASSA_CONFIG.shopId || !YUKASSA_CONFIG.secretKey) {
      throw new Error('Не настроены данные для подключения к ЮKassa');
    }
    
    // Создаем чек с данными пользователя
    const receipt = await createReceiptData(metadata.userId, amount, description);
    
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
      receipt: receipt
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    const idempotenceKey = crypto.randomUUID();
    
    console.log('🔐 Отправка запроса в ЮKassa API...');
    console.log('📦 Данные платежа:', JSON.stringify(paymentData, null, 2));
    
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
        console.error('❌ Детали ошибки ЮKassa:', errorJson);
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки, используем текст как есть');
      }
      
      console.error('❌ Ошибка ЮKassa API:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Платеж создан в ЮKassa:', payment.id);
    console.log('🔗 Ссылка для оплаты:', payment.confirmation?.confirmation_url);
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      confirmationUrl: payment.confirmation?.confirmation_url,
      createdAt: payment.created_at
    };
  } catch (error) {
    console.error('❌ Ошибка создания платежа в ЮKassa:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw error;
  }
}

// Функция для получения информации о платеже
export async function getYukassaPayment(paymentId) {
  try {
    console.log('🔍 Получение информации о платеже:', paymentId);
    
    if (!paymentId) {
      throw new Error('Не указан ID платежа');
    }
    
    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    const responseText = await response.text();
    console.log(`📡 Ответ ЮKassa API для платежа ${paymentId} (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      console.error('❌ Ошибка получения платежа:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Информация о платеже получена:', payment.id);
    
    return payment;
  } catch (error) {
    console.error('❌ Ошибка получения платежа:', error.message);
    throw error;
  }
}

// Функция для проверки подписи webhook (опционально)
export function verifyWebhookSignature(body, signature) {
  try {
    if (!signature) {
      console.log('⚠️ Подпись webhook не предоставлена');
      return false;
    }
    
    const expectedSignature = crypto
      .createHmac('sha256', YUKASSA_CONFIG.secretKey)
      .update(body)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch (error) {
    console.error('❌ Ошибка проверки подписи:', error);
    return false;
  }
}

// Функция для отмены платежа
export async function cancelYukassaPayment(paymentId) {
  try {
    console.log('❌ Отмена платежа:', paymentId);
    
    if (!paymentId) {
      throw new Error('Не указан ID платежа');
    }
    
    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': crypto.randomUUID()
      }
    });

    const responseText = await response.text();
    console.log(`📡 Ответ ЮKassa API для отмены платежа ${paymentId} (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.description || errorJson.error_description || errorJson.message || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      console.error('❌ Ошибка отмены платежа:', response.status, errorDetails);
      throw new Error(`ЮKassa API error (${response.status}): ${errorDetails}`);
    }

    let payment;
    try {
      payment = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа ЮKassa:', parseError);
      throw new Error('Некорректный ответ от ЮKassa API');
    }
    
    console.log('✅ Платеж отменен:', payment.id);
    
    return payment;
  } catch (error) {
    console.error('❌ Ошибка отмены платежа:', error.message);
    throw error;
  }
}