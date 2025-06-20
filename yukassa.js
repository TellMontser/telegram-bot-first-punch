import crypto from 'crypto';

// Конфигурация ЮKassa
export const YUKASSA_CONFIG = {
  shopId: '1103466',
  secretKey: 'live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo',
  apiUrl: 'https://api.yookassa.ru/v3'
};

// Функция для создания платежа в ЮKassa
export async function createYukassaPayment(amount, description, metadata = {}) {
  try {
    console.log('💳 Создание платежа в ЮKassa:', { amount, description, metadata });
    
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
      metadata: metadata
    };

    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': crypto.randomUUID()
      },
      body: JSON.stringify(paymentData)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ошибка ЮKassa API:', response.status, errorText);
      throw new Error(`ЮKassa API error: ${response.status} ${errorText}`);
    }

    const payment = await response.json();
    console.log('✅ Платеж создан в ЮKassa:', payment.id);
    
    return {
      paymentId: payment.id,
      status: payment.status,
      amount: parseFloat(payment.amount.value),
      confirmationUrl: payment.confirmation.confirmation_url,
      createdAt: payment.created_at
    };
  } catch (error) {
    console.error('❌ Ошибка создания платежа в ЮKassa:', error);
    throw error;
  }
}

// Функция для получения информации о платеже
export async function getYukassaPayment(paymentId) {
  try {
    console.log('🔍 Получение информации о платеже:', paymentId);
    
    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ошибка получения платежа:', response.status, errorText);
      throw new Error(`ЮKassa API error: ${response.status} ${errorText}`);
    }

    const payment = await response.json();
    console.log('✅ Информация о платеже получена:', payment.id);
    
    return payment;
  } catch (error) {
    console.error('❌ Ошибка получения платежа:', error);
    throw error;
  }
}

// Функция для проверки подписи webhook (опционально)
export function verifyWebhookSignature(body, signature) {
  try {
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
    
    const auth = Buffer.from(`${YUKASSA_CONFIG.shopId}:${YUKASSA_CONFIG.secretKey}`).toString('base64');
    
    const response = await fetch(`${YUKASSA_CONFIG.apiUrl}/payments/${paymentId}/cancel`, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Content-Type': 'application/json',
        'Idempotence-Key': crypto.randomUUID()
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Ошибка отмены платежа:', response.status, errorText);
      throw new Error(`ЮKassa API error: ${response.status} ${errorText}`);
    }

    const payment = await response.json();
    console.log('✅ Платеж отменен:', payment.id);
    
    return payment;
  } catch (error) {
    console.error('❌ Ошибка отмены платежа:', error);
    throw error;
  }
}
