import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export class YookassaService {
  constructor() {
    this.shopId = process.env.YUKASSA_SHOP_ID;
    this.secretKey = process.env.YUKASSA_SECRET_KEY;
    this.apiUrl = process.env.YUKASSA_API_URL;
    
    if (!this.shopId || !this.secretKey || !this.apiUrl) {
      throw new Error('ЮКасса настройки не найдены в переменных среды');
    }
    
    console.log('💳 Инициализация ЮКасса сервиса:', {
      shopId: this.shopId,
      apiUrl: this.apiUrl,
      secretKey: this.secretKey ? this.secretKey.substring(0, 10) + '...' : 'НЕ НАЙДЕН'
    });
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      auth: {
        username: this.shopId,
        password: this.secretKey
      },
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0'
      }
    });
  }

  async createPayment(amount, description, returnUrl = null, savePaymentMethod = false, customerEmail = null) {
    const idempotencyKey = uuidv4();
    
    // Если returnUrl не указан, используем базовый URL сервера
    const finalReturnUrl = returnUrl || `${process.env.WEBHOOK_URL}/webhook/payment-success`;
    
    console.log('💰 Создание платежа:', {
      amount,
      description,
      savePaymentMethod,
      customerEmail,
      idempotencyKey,
      returnUrl: finalReturnUrl
    });
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      description,
      save_payment_method: savePaymentMethod,
      capture: true, // Автоматическое подтверждение платежа
      payment_method_data: {
        type: 'sbp'
      },
      confirmation: {
        type: 'redirect',
        return_url: finalReturnUrl
      }
    };

    // Добавляем чек только если указан email
    if (customerEmail) {
      paymentData.receipt = {
        customer: {
          email: customerEmail
        },
        items: [
          {
            description: description,
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1, // НДС 20%
            payment_subject: 'service', // Услуга
            payment_mode: 'full_payment' // Полная оплата
          }
        ]
      };
    }

    try {
      console.log('📤 Отправка запроса в ЮКассу:', JSON.stringify(paymentData, null, 2));
      
      const response = await this.client.post('/payments', paymentData, {
        headers: {
          'Idempotence-Key': idempotencyKey
        }
      });
      
      console.log('✅ Платеж успешно создан:', {
        id: response.data.id,
        status: response.data.status,
        confirmation_url: response.data.confirmation?.confirmation_url,
        amount: response.data.amount,
        created_at: response.data.created_at
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Детальная ошибка создания платежа:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        headers: error.response?.headers,
        data: error.response?.data,
        message: error.message,
        config: {
          url: error.config?.url,
          method: error.config?.method,
          data: error.config?.data
        }
      });
      
      if (error.response?.data) {
        console.error('📋 Подробности ошибки от ЮКассы:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw error;
    }
  }

  async createRecurringPayment(amount, description, paymentMethodId, customerEmail = null) {
    const idempotencyKey = uuidv4();
    
    console.log('🔄 Создание рекуррентного платежа:', {
      amount,
      description,
      paymentMethodId,
      customerEmail,
      idempotencyKey
    });
    
    const paymentData = {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      payment_method_id: paymentMethodId,
      description,
      capture: true // Автоматическое подтверждение
    };

    // Добавляем чек только если указан email
    if (customerEmail) {
      paymentData.receipt = {
        customer: {
          email: customerEmail
        },
        items: [
          {
            description: description,
            quantity: '1.00',
            amount: {
              value: amount.toFixed(2),
              currency: 'RUB'
            },
            vat_code: 1, // НДС 20%
            payment_subject: 'service', // Услуга
            payment_mode: 'full_payment' // Полная оплата
          }
        ]
      };
    }

    try {
      console.log('📤 Отправка рекуррентного запроса в ЮКассу:', JSON.stringify(paymentData, null, 2));
      
      const response = await this.client.post('/payments', paymentData, {
        headers: {
          'Idempotence-Key': idempotencyKey
        }
      });
      
      console.log('✅ Рекуррентный платеж успешно создан:', {
        id: response.data.id,
        status: response.data.status,
        amount: response.data.amount,
        created_at: response.data.created_at
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Детальная ошибка создания рекуррентного платежа:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
        paymentMethodId
      });
      
      if (error.response?.data) {
        console.error('📋 Подробности ошибки от ЮКассы:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw error;
    }
  }

  async getPayment(paymentId) {
    try {
      console.log('🔍 Получение информации о платеже:', paymentId);
      
      const response = await this.client.get(`/payments/${paymentId}`);
      
      console.log('✅ Информация о платеже получена:', {
        id: response.data.id,
        status: response.data.status,
        amount: response.data.amount,
        payment_method: response.data.payment_method?.id || 'не найден'
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Ошибка получения платежа:', {
        paymentId,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  async capturePayment(paymentId, amount) {
    try {
      console.log('✅ Подтверждение платежа:', { paymentId, amount });
      
      const response = await this.client.post(`/payments/${paymentId}/capture`, {
        amount: {
          value: amount.toFixed(2),
          currency: 'RUB'
        }
      });
      
      console.log('✅ Платеж успешно подтвержден:', {
        id: response.data.id,
        status: response.data.status,
        amount: response.data.amount
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Ошибка подтверждения платежа:', {
        paymentId,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  async cancelPayment(paymentId) {
    try {
      console.log('❌ Отмена платежа:', paymentId);
      
      const response = await this.client.post(`/payments/${paymentId}/cancel`);
      
      console.log('✅ Платеж успешно отменен:', {
        id: response.data.id,
        status: response.data.status
      });
      
      return response.data;
    } catch (error) {
      console.error('❌ Ошибка отмены платежа:', {
        paymentId,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  async checkApiStatus() {
    try {
      console.log('🔍 Проверка статуса API ЮКассы...');
      
      const response = await this.client.get('/me');
      
      console.log('✅ API ЮКассы работает:', {
        account_id: response.data.account_id,
        status: response.data.status
      });
      
      return true;
    } catch (error) {
      console.error('❌ API ЮКассы недоступен:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }
}
