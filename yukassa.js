import crypto from 'crypto';
import fetch from 'node-fetch';

const YUKASSA_SHOP_ID = '1103466';
const YUKASSA_SECRET_KEY = 'live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo';
const YUKASSA_API_URL = 'https://api.yookassa.ru/v3';

// Создание платежа
export async function createPayment(amount, description, userId, returnUrl = null) {
  const idempotenceKey = crypto.randomUUID();
  
  const paymentData = {
    amount: {
      value: amount.toFixed(2),
      currency: 'RUB'
    },
    confirmation: {
      type: 'redirect',
      return_url: returnUrl || 'https://resonant-pithivier-ac150a.netlify.app/'
    },
    capture: true,
    description: description,
    metadata: {
      user_id: userId.toString()
    }
  };

  try {
    const response = await fetch(`${YUKASSA_API_URL}/payments`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotence-Key': idempotenceKey,
        'Authorization': `Basic ${Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64')}`
      },
      body: JSON.stringify(paymentData)
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(`ЮKassa API error: ${errorData.description || response.statusText}`);
    }

    const payment = await response.json();
    return payment;
  } catch (error) {
    console.error('Ошибка создания платежа:', error);
    throw error;
  }
}

// Проверка статуса платежа
export async function getPaymentStatus(paymentId) {
  try {
    const response = await fetch(`${YUKASSA_API_URL}/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${Buffer.from(`${YUKASSA_SHOP_ID}:${YUKASSA_SECRET_KEY}`).toString('base64')}`
      }
    });

    if (!response.ok) {
      throw new Error(`ЮKassa API error: ${response.statusText}`);
    }

    const payment = await response.json();
    return payment;
  } catch (error) {
    console.error('Ошибка получения статуса платежа:', error);
    throw error;
  }
}

// Проверка подписи webhook
export function verifyWebhookSignature(body, signature) {
  const hash = crypto
    .createHmac('sha256', YUKASSA_SECRET_KEY)
    .update(body)
    .digest('hex');
  
  return hash === signature;
}