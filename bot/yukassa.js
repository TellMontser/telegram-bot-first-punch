import crypto from 'crypto';

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

// Функция для создания простого платежа без чека
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
    
    // Проверяем конфигурацию
    if (!YUKASSA_CONFIG.shopId || !YUKASSA_CONFIG.secretKey) {
      throw new Error('Не настроены данные для подключения к ЮKassa');
    }
    
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
      metadata: metadata
      // НЕ добавляем receipt - это и есть простой платеж
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
      createdAt: payment.created_at
    };
  } catch (error) {
    console.error('❌ Ошибка создания простого платежа в ЮKassa:', error.message);
    console.error('❌ Полная ошибка:', error);
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
    
    // Проверяем конфигурацию
    if (!YUKASSA_CONFIG.shopId || !YUKASSA_CONFIG.secretKey) {
      throw new Error('Не настроены данные для подключения к ЮKassa');
    }
    
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
      receipt: {
        customer: {
          full_name: 'Тестовый Пользователь',
          email: 'test@firstpunch.ru',
          phone: '+79991234567'
        },
        items: [
          {
            description: 'Подписка на канал "Первый Панч" на 30 дней',
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