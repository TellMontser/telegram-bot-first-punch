import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export class CryptoCloudService {
  constructor() {
    this.apiKey = process.env.CRYPTOCLOUD_API_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTmpBeE1UVT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiIyNDJlZjFiZjRmYWIxODIwNDQyZjZhMjliOGJjNDI3NDRiNmUzMzYwNGU4OTU5NTFjMWRkODFkM2ZkNTBiZjMzIiwiZXhwIjo4ODE1MDQyMDM2NH0.vU7V3x_i0l62iRTvF0t42hqa_5wldaYHoKqCn_n0w7U';
    this.shopId = process.env.CRYPTOCLOUD_SHOP_ID || 'aWVLYZybDtoiSLKK';
    this.secret = process.env.CRYPTOCLOUD_SECRET || 'lRdeN9aONpcHMy2l9znKeGAuYIjq5770karQA';
    this.apiUrl = 'https://api.cryptocloud.plus/v2';
    
    console.log('💰 Инициализация CryptoCloud сервиса:', {
      shopId: this.shopId,
      apiUrl: this.apiUrl,
      apiKey: this.apiKey ? this.apiKey.substring(0, 20) + '...' : 'НЕ НАЙДЕН'
    });
    
    this.client = axios.create({
      baseURL: this.apiUrl,
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0'
      }
    });
  }

  async createInvoice(amount, description, orderId = null, currency = 'RUB') {
    const invoiceId = orderId || uuidv4();
    
    console.log('💰 Создание CryptoCloud инвойса:', {
      amount,
      description,
      invoiceId,
      currency
    });
    
    const invoiceData = {
      shop_id: this.shopId,
      amount: amount,
      currency: currency,
      order_id: invoiceId,
      name: description,
      description: description,
      success_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/successful-payment`,
      fail_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/failed-payment`,
      notification_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/callback`
    };

    try {
      console.log('📤 Отправка запроса в CryptoCloud:', JSON.stringify(invoiceData, null, 2));
      
      const response = await this.client.post('/invoice/create', invoiceData);
      
      console.log('✅ CryptoCloud инвойс успешно создан:', {
        id: response.data.result?.uuid,
        status: response.data.status,
        pay_url: response.data.result?.link,
        amount: response.data.result?.amount,
        currency: response.data.result?.currency
      });
      
      return {
        id: response.data.result.uuid,
        status: 'created',
        pay_url: response.data.result.link,
        amount: response.data.result.amount,
        currency: response.data.result.currency,
        order_id: invoiceId,
        created_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('❌ Детальная ошибка создания CryptoCloud инвойса:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message
      });
      
      if (error.response?.data) {
        console.error('📋 Подробности ошибки от CryptoCloud:', JSON.stringify(error.response.data, null, 2));
      }
      
      throw error;
    }
  }

  async getInvoice(invoiceId) {
    try {
      console.log('🔍 Получение информации о CryptoCloud инвойсе:', invoiceId);
      
      const response = await this.client.post('/invoice/info', {
        uuid: invoiceId
      });
      
      console.log('✅ Информация о CryptoCloud инвойсе получена:', {
        id: response.data.result?.uuid,
        status: response.data.result?.status,
        amount: response.data.result?.amount,
        currency: response.data.result?.currency
      });
      
      return {
        id: response.data.result.uuid,
        status: response.data.result.status,
        amount: response.data.result.amount,
        currency: response.data.result.currency,
        order_id: response.data.result.order_id,
        created_at: response.data.result.created_at,
        paid_at: response.data.result.paid_at
      };
    } catch (error) {
      console.error('❌ Ошибка получения CryptoCloud инвойса:', {
        invoiceId,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      throw error;
    }
  }

  async createRecurringInvoice(amount, description, orderId = null, currency = 'RUB') {
    // CryptoCloud пока не поддерживает автоматические рекуррентные платежи
    // Создаем обычный инвойс, рекуррентность будем обрабатывать на нашей стороне
    console.log('🔄 Создание рекуррентного CryptoCloud инвойса (эмуляция):', {
      amount,
      description,
      orderId,
      currency
    });
    
    return await this.createInvoice(amount, description, orderId, currency);
  }

  // Проверка статуса API
  async checkApiStatus() {
    try {
      console.log('🔍 Проверка статуса CryptoCloud API...');
      
      // Пробуем получить баланс магазина
      const response = await this.client.post('/shop/balance');
      
      console.log('✅ CryptoCloud API работает:', {
        balance: response.data.result
      });
      
      return true;
    } catch (error) {
      console.error('❌ CryptoCloud API недоступен:', {
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });
      return false;
    }
  }

  // Получение доступных валют
  async getAvailableCurrencies() {
    try {
      console.log('💱 Получение доступных валют CryptoCloud...');
      
      const response = await this.client.get('/currencies');
      
      console.log('✅ Доступные валюты получены:', response.data.result?.length || 0);
      
      return response.data.result || [];
    } catch (error) {
      console.error('❌ Ошибка получения валют CryptoCloud:', error);
      return [];
    }
  }

  // Проверка подписи webhook'а
  verifyWebhookSignature(data, signature) {
    try {
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', this.secret)
        .update(JSON.stringify(data))
        .digest('hex');
      
      return signature === expectedSignature;
    } catch (error) {
      console.error('❌ Ошибка проверки подписи CryptoCloud:', error);
      return false;
    }
  }

  // Получение минимальной суммы для валюты
  getMinimumAmount(currency = 'RUB') {
    const minimums = {
      'RUB': 10,
      'USD': 0.15,
      'EUR': 0.13,
      'BTC': 0.00001,
      'ETH': 0.0001,
      'USDT': 0.15,
      'USDC': 0.15,
      'LTC': 0.001,
      'BCH': 0.001,
      'BNB': 0.001,
      'TRX': 1,
      'DOGE': 1
    };
    
    return minimums[currency] || 10;
  }

  // Форматирование суммы для отображения
  formatAmount(amount, currency = 'RUB') {
    const symbols = {
      'RUB': '₽',
      'USD': '$',
      'EUR': '€',
      'BTC': '₿',
      'ETH': 'Ξ',
      'USDT': 'USDT',
      'USDC': 'USDC',
      'LTC': 'Ł',
      'BCH': 'BCH',
      'BNB': 'BNB',
      'TRX': 'TRX',
      'DOGE': 'Ð'
    };
    
    const symbol = symbols[currency] || currency;
    const decimals = ['BTC', 'ETH', 'LTC', 'BCH'].includes(currency) ? 8 : 2;
    
    return `${Number(amount).toFixed(decimals)} ${symbol}`;
  }
}