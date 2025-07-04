import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export class YookassaService {
  constructor() {
    this.shopId = process.env.YUKASSA_SHOP_ID || '1103466';
    this.secretKey = process.env.YUKASSA_SECRET_KEY || 'live_WljytTzIIcSMRniFfGBdcSpbMw3ajbhomTEAXduTCxo';
    this.apiUrl = process.env.YUKASSA_API_URL || 'https://api.yookassa.ru/v3';
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      auth: {
        username: this.shopId,
        password: this.secretKey
      },
      headers: {
        'Content-Type': 'application/json'
      }
    });
  }

  async createPayment(amount, description, returnUrl, savePaymentMethod = false) {
    const idempotencyKey = uuidv4();
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      confirmation: {
        type: 'redirect',
        return_url: returnUrl
      },
      description,
      save_payment_method: savePaymentMethod,
      receipt: {
        customer: {
          email: 'customer@example.com'
        },
        items: [
          {
            description: description,
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1
          }
        ]
      }
    };

    try {
      const response = await this.client.post('/payments', paymentData, {
        headers: {
          'Idempotence-Key': idempotencyKey
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Ошибка создания платежа:', error.response?.data || error.message);
      throw error;
    }
  }

  async createRecurringPayment(amount, description, paymentMethodId) {
    const idempotencyKey = uuidv4();
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      payment_method_id: paymentMethodId,
      description,
      receipt: {
        customer: {
          email: 'customer@example.com'
        },
        items: [
          {
            description: description,
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1
          }
        ]
      }
    };

    try {
      const response = await this.client.post('/payments', paymentData, {
        headers: {
          'Idempotence-Key': idempotencyKey
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Ошибка создания рекуррентного платежа:', error.response?.data || error.message);
      throw error;
    }
  }

  async getPayment(paymentId) {
    try {
      const response = await this.client.get(`/payments/${paymentId}`);
      return response.data;
    } catch (error) {
      console.error('Ошибка получения платежа:', error.response?.data || error.message);
      throw error;
    }
  }

  async capturePayment(paymentId, amount) {
    try {
      const response = await this.client.post(`/payments/${paymentId}/capture`, {
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB'
        }
      });
      
      return response.data;
    } catch (error) {
      console.error('Ошибка подтверждения платежа:', error.response?.data || error.message);
      throw error;
    }
  }

  async cancelPayment(paymentId) {
    try {
      const response = await this.client.post(`/payments/${paymentId}/cancel`);
      return response.data;
    } catch (error) {
      console.error('Ошибка отмены платежа:', error.response?.data || error.message);
      throw error;
    }
  }
}