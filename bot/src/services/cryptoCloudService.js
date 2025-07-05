import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';

export class CryptoCloudService {
  constructor() {
    this.apiKey = process.env.CRYPTOCLOUD_API_KEY || 'eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJ1dWlkIjoiTmpBeE1UVT0iLCJ0eXBlIjoicHJvamVjdCIsInYiOiIyNDJlZjFiZjRmYWIxODIwNDQyZjZhMjliOGJjNDI3NDRiNmUzMzYwNGU4OTU5NTFjMWRkODFkM2ZkNTBiZjMzIiwiZXhwIjo4ODE1MDQyMDM2NH0.vU7V3x_i0l62iRTvF0t42hqa_5wldaYHoKqCn_n0w7U';
    this.shopId = process.env.CRYPTOCLOUD_SHOP_ID || 'aWVLYZybDtoiSLKK';
    this.secret = process.env.CRYPTOCLOUD_SECRET || 'lRdeN9aONpcHMy2l9znKeGAuYIjq5770karQA';
    
    // Попробуем разные варианты API URL
    this.apiUrls = [
      'https://api.cryptocloud.plus/v2',
      'https://api.cryptocloud.plus/v1',
      'https://cryptocloud.plus/api/v2',
      'https://app.cryptocloud.plus/api/v2'
    ];
    
    this.currentApiUrl = this.apiUrls[0];
    
    console.log('💰 Инициализация CryptoCloud сервиса:', {
      shopId: this.shopId,
      apiKey: this.apiKey ? this.apiKey.substring(0, 20) + '...' : 'НЕ НАЙДЕН',
      apiUrls: this.apiUrls
    });
    
    this.client = axios.create({
      timeout: 10000,
      headers: {
        'Authorization': `Token ${this.apiKey}`,
        'Content-Type': 'application/json',
        'User-Agent': 'TelegramBot/1.0',
        'Accept': 'application/json'
      }
    });
  }

  // Попробовать разные API URL
  async tryApiUrls(requestFn) {
    let lastError = null;
    
    for (const apiUrl of this.apiUrls) {
      try {
        console.log(`🔄 Пробуем API URL: ${apiUrl}`);
        this.client.defaults.baseURL = apiUrl;
        this.currentApiUrl = apiUrl;
        
        const result = await requestFn();
        console.log(`✅ Успешно подключились к: ${apiUrl}`);
        return result;
      } catch (error) {
        console.log(`❌ Ошибка с ${apiUrl}:`, error.response?.status || error.message);
        lastError = error;
        continue;
      }
    }
    
    throw lastError;
  }

  async createInvoice(amount, description, orderId = null, currency = 'RUB') {
    const invoiceId = orderId || `tg_${Date.now()}_${uuidv4().substring(0, 8)}`;
    
    console.log('💰 Создание CryptoCloud инвойса:', {
      amount,
      description,
      invoiceId,
      currency
    });
    
    // Проверяем минимальную сумму
    const minAmount = this.getMinimumAmount(currency);
    if (amount < minAmount) {
      throw new Error(`Минимальная сумма для ${currency}: ${minAmount}`);
    }
    
    const invoiceData = {
      shop_id: this.shopId,
      amount: amount,
      currency: currency,
      order_id: invoiceId,
      name: description,
      description: description,
      success_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/webhook/successful-payment`,
      fail_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/webhook/failed-payment`,
      notification_url: `${process.env.WEBHOOK_URL || 'https://telegram-bot-first-punch.onrender.com'}/webhook/callback`
    };

    return await this.tryApiUrls(async () => {
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
    });
  }

  async getInvoice(invoiceId) {
    return await this.tryApiUrls(async () => {
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
    });
  }

  // Проверка статуса API с разными методами
  async checkApiStatus() {
    console.log('🔍 Проверка статуса CryptoCloud API...');
    
    // Пробуем разные эндпоинты для проверки
    const testMethods = [
      // Метод 1: Получение баланса
      async () => {
        const response = await this.client.post('/shop/balance');
        return { method: 'balance', data: response.data };
      },
      // Метод 2: Получение информации о магазине
      async () => {
        const response = await this.client.get('/shop/info');
        return { method: 'shop_info', data: response.data };
      },
      // Метод 3: Получение валют
      async () => {
        const response = await this.client.get('/currencies');
        return { method: 'currencies', data: response.data };
      },
      // Метод 4: Простой GET запрос
      async () => {
        const response = await this.client.get('/');
        return { method: 'root', data: response.data };
      }
    ];

    return await this.tryApiUrls(async () => {
      let lastError = null;
      
      for (const testMethod of testMethods) {
        try {
          const result = await testMethod();
          console.log(`✅ CryptoCloud API работает (${result.method}):`, result.data);
          return true;
        } catch (error) {
          console.log(`❌ Метод ${testMethod.name} не работает:`, error.response?.status || error.message);
          lastError = error;
          continue;
        }
      }
      
      throw lastError;
    });
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

  // Получение доступных валют
  async getAvailableCurrencies() {
    try {
      console.log('💱 Получение доступных валют CryptoCloud...');
      
      const response = await this.client.get('/currencies');
      
      console.log('✅ Доступные валюты получены:', response.data.result?.length || 0);
      
      return response.data.result || [];
    } catch (error) {
      console.error('❌ Ошибка получения валют CryptoCloud:', error);
      // Возвращаем стандартный список валют
      return [
        { code: 'BTC', name: 'Bitcoin' },
        { code: 'ETH', name: 'Ethereum' },
        { code: 'USDT', name: 'Tether' },
        { code: 'USDC', name: 'USD Coin' },
        { code: 'LTC', name: 'Litecoin' },
        { code: 'BCH', name: 'Bitcoin Cash' },
        { code: 'BNB', name: 'Binance Coin' },
        { code: 'TRX', name: 'TRON' },
        { code: 'DOGE', name: 'Dogecoin' }
      ];
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
      'RUB': 50, // Увеличиваем минимальную сумму
      'USD': 1,
      'EUR': 1,
      'BTC': 0.00001,
      'ETH': 0.0001,
      'USDT': 1,
      'USDC': 1,
      'LTC': 0.001,
      'BCH': 0.001,
      'BNB': 0.001,
      'TRX': 10,
      'DOGE': 10
    };
    
    return minimums[currency] || 50;
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

  // Получение информации о текущем API URL
  getCurrentApiInfo() {
    return {
      currentUrl: this.currentApiUrl,
      allUrls: this.apiUrls,
      shopId: this.shopId,
      hasApiKey: !!this.apiKey
    };
  }
}
