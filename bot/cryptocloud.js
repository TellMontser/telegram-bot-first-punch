import crypto from 'crypto';

// Конфигурация CryptoCloud
export const CRYPTOCLOUD_CONFIG = {
  apiKey: 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTmpBeE1UVT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiIyNDJlZjFiZjRmYWIxODIwNDQyZjZhMjliOGJjNDI3NDRiNmUzMzYwNGU4OTU5NTFjMWRkODFkM2ZkNTBiZjMzIiwiZXhwIjo4ODE1MDQyMDM2NH0.vU7V3x_i0l62iRTvF0t42hqa_5wldaYHoKqCn_n0w7U',
  shopId: 'aWVLYZybDtoiSLKK',
  secret: 'ftX3MHvoz90F8azxuhPnrSyH27EVP4yWUVyu',
  apiUrl: 'https://api.cryptocloud.plus/v1'
};

// Функция для создания инвойса в CryptoCloud
export async function createCryptoCloudInvoice(amount, description, metadata = {}) {
  try {
    console.log('💰 Создание инвойса в CryptoCloud:', { amount, description, metadata });
    
    // Проверяем наличие необходимых данных
    if (!amount || amount <= 0) {
      throw new Error('Некорректная сумма платежа');
    }
    
    if (!description) {
      throw new Error('Не указано описание платежа');
    }
    
    // Минимальная сумма для криптоплатежей - 50 рублей
    const minAmount = 50;
    if (amount < minAmount) {
      throw new Error(`Минимальная сумма для криптоплатежей: ${minAmount}₽`);
    }
    
    const invoiceData = {
      shop_id: CRYPTOCLOUD_CONFIG.shopId,
      amount: amount.toFixed(2),
      currency: 'RUB',
      order_id: `order_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      description: description,
      success_url: 'https://t.me/firstpunch_bot',
      fail_url: 'https://t.me/firstpunch_bot',
      // Добавляем метаданные как дополнительные поля
      email: metadata.email || 'user@firstpunch.ru',
      // Сохраняем метаданные в описании для webhook
      metadata: JSON.stringify(metadata)
    };

    console.log('🔐 Отправка запроса в CryptoCloud API...');
    console.log('📦 Данные инвойса:', JSON.stringify(invoiceData, null, 2));
    
    const response = await fetch(`${CRYPTOCLOUD_CONFIG.apiUrl}/invoice/create`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${CRYPTOCLOUD_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invoiceData)
    });

    const responseText = await response.text();
    console.log(`📡 Ответ CryptoCloud API (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.message || errorJson.error || errorJson.detail || responseText;
        console.error('❌ Детали ошибки CryptoCloud:', errorJson);
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки, используем текст как есть');
      }
      
      console.error('❌ Ошибка CryptoCloud API:', response.status, errorDetails);
      throw new Error(`CryptoCloud API error (${response.status}): ${errorDetails}`);
    }

    let invoice;
    try {
      invoice = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа CryptoCloud:', parseError);
      throw new Error('Некорректный ответ от CryptoCloud API');
    }
    
    console.log('✅ Инвойс создан в CryptoCloud:', invoice.uuid);
    console.log('🔗 Ссылка для оплаты:', invoice.link);
    
    return {
      invoiceId: invoice.uuid,
      orderId: invoiceData.order_id,
      status: invoice.status || 'created',
      amount: parseFloat(invoiceData.amount),
      paymentUrl: invoice.link,
      createdAt: new Date().toISOString()
    };
  } catch (error) {
    console.error('❌ Ошибка создания инвойса в CryptoCloud:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw error;
  }
}

// Функция для получения информации об инвойсе
export async function getCryptoCloudInvoice(invoiceId) {
  try {
    console.log('🔍 Получение информации об инвойсе:', invoiceId);
    
    if (!invoiceId) {
      throw new Error('Не указан ID инвойса');
    }
    
    const response = await fetch(`${CRYPTOCLOUD_CONFIG.apiUrl}/invoice/info`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${CRYPTOCLOUD_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        uuids: [invoiceId]
      })
    });

    const responseText = await response.text();
    console.log(`📡 Ответ CryptoCloud API для инвойса ${invoiceId} (${response.status}):`, responseText);

    if (!response.ok) {
      let errorDetails = responseText;
      try {
        const errorJson = JSON.parse(responseText);
        errorDetails = errorJson.message || errorJson.error || errorJson.detail || responseText;
      } catch (parseError) {
        console.log('⚠️ Не удалось распарсить JSON ошибки');
      }
      
      console.error('❌ Ошибка получения инвойса:', response.status, errorDetails);
      throw new Error(`CryptoCloud API error (${response.status}): ${errorDetails}`);
    }

    let result;
    try {
      result = JSON.parse(responseText);
    } catch (parseError) {
      console.error('❌ Ошибка парсинга ответа CryptoCloud:', parseError);
      throw new Error('Некорректный ответ от CryptoCloud API');
    }
    
    const invoice = result.result && result.result[0];
    if (!invoice) {
      throw new Error('Инвойс не найден');
    }
    
    console.log('✅ Информация об инвойсе получена:', invoice.uuid);
    
    return invoice;
  } catch (error) {
    console.error('❌ Ошибка получения инвойса:', error.message);
    throw error;
  }
}

// Функция для проверки подписи webhook
export function verifyCryptoCloudWebhook(body, signature) {
  try {
    if (!signature) {
      console.log('⚠️ Подпись webhook не предоставлена');
      return false;
    }
    
    const expectedSignature = crypto
      .createHash('sha256')
      .update(body + CRYPTOCLOUD_CONFIG.secret)
      .digest('hex');
    
    return signature === expectedSignature;
  } catch (error) {
    console.error('❌ Ошибка проверки подписи CryptoCloud:', error);
    return false;
  }
}

// Функция для создания простого криптоплатежа
export async function createSimpleCryptoCloudPayment(amount, description, returnUrl, metadata = {}) {
  try {
    console.log('💰 Создание простого криптоплатежа:', { amount, description, returnUrl, metadata });
    
    // Проверяем минимальную сумму
    const minAmount = 50;
    if (amount < minAmount) {
      throw new Error(`Минимальная сумма для криптоплатежей: ${minAmount}₽. Указано: ${amount}₽`);
    }
    
    const invoice = await createCryptoCloudInvoice(amount, description, metadata);
    
    return {
      paymentId: invoice.invoiceId,
      orderId: invoice.orderId,
      status: invoice.status,
      amount: invoice.amount,
      confirmationUrl: invoice.paymentUrl,
      createdAt: invoice.createdAt,
      paymentSystem: 'cryptocloud'
    };
  } catch (error) {
    console.error('❌ Ошибка создания простого криптоплатежа:', error.message);
    throw error;
  }
}

// Функция для получения списка поддерживаемых криптовалют
export async function getCryptoCloudCurrencies() {
  try {
    const response = await fetch(`${CRYPTOCLOUD_CONFIG.apiUrl}/currencies`, {
      method: 'GET',
      headers: {
        'Authorization': `Token ${CRYPTOCLOUD_CONFIG.apiKey}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    return data.result || [];
  } catch (error) {
    console.error('❌ Ошибка получения списка криптовалют:', error);
    return [];
  }
}