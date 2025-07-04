import TelegramBot from 'node-telegram-bot-api';

export class TelegramBotService {
  constructor(database, yookassaService, paymentScheduler) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.paymentScheduler = paymentScheduler;
    
    // Проверяем наличие токена
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('BOT_TOKEN не найден в переменных среды');
    }
    
    console.log('🤖 Инициализация бота с токеном:', botToken.substring(0, 15) + '...');
    
    // Создаем бота без polling по умолчанию
    this.bot = new TelegramBot(botToken, { 
      polling: false,
      webHook: false
    });
    this.isStarted = false;
  }

  async start() {
    if (this.isStarted) {
      console.log('⚠️ Бот уже запущен');
      return;
    }
    
    try {
      console.log('🔍 Проверяем авторизацию бота...');
      
      // Сначала проверим, что бот работает
      const me = await this.bot.getMe();
      console.log('✅ Бот успешно авторизован:', me.username, `(ID: ${me.id})`);
      
      this.setupCommands();
      this.setupCallbacks();
      
      if (process.env.WEBHOOK_URL) {
        const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/telegram`;
        console.log('🔗 Настраиваем webhook:', webhookUrl);
        
        try {
          // Сначала удаляем старый webhook
          console.log('🗑️ Удаляем старый webhook...');
          await this.bot.deleteWebHook();
          
          // Небольшая пауза
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Устанавливаем новый webhook
          console.log('📡 Устанавливаем новый webhook...');
          const result = await this.bot.setWebHook(webhookUrl, {
            drop_pending_updates: true
          });
          
          if (result) {
            console.log('✅ Webhook успешно установлен');
            
            // Проверяем информацию о webhook
            const webhookInfo = await this.bot.getWebHookInfo();
            console.log('📋 Информация о webhook:', {
              url: webhookInfo.url,
              has_custom_certificate: webhookInfo.has_custom_certificate,
              pending_update_count: webhookInfo.pending_update_count,
              last_error_date: webhookInfo.last_error_date,
              last_error_message: webhookInfo.last_error_message
            });
          } else {
            throw new Error('Не удалось установить webhook');
          }
        } catch (webhookError) {
          console.error('❌ Ошибка при установке webhook:', webhookError);
          console.log('🔄 Переключаемся на polling...');
          
          await this.bot.startPolling({
            restart: true,
            polling: {
              interval: 1000,
              autoStart: true,
              params: {
                timeout: 10
              }
            }
          });
          console.log('✅ Polling запущен');
        }
      } else {
        console.log('⚠️ WEBHOOK_URL не найден, запускаем polling');
        await this.bot.startPolling({
          restart: true,
          polling: {
            interval: 1000,
            autoStart: true,
            params: {
              timeout: 10
            }
          }
        });
        console.log('✅ Polling запущен');
      }
      
      this.isStarted = true;
      console.log('🎉 Telegram бот успешно запущен!');
      
    } catch (error) {
      console.error('❌ Ошибка при запуске Telegram бота:', error);
      
      // Дополнительная информация об ошибке
      if (error.response) {
        console.error('📄 Ответ сервера:', error.response.body);
      }
      
      throw error;
    }
  }

  async stop() {
    if (!this.isStarted) return;
    
    try {
      console.log('⏹️ Останавливаем Telegram бота...');
      
      // Останавливаем polling если он запущен
      if (this.bot.isPolling()) {
        await this.bot.stopPolling();
        console.log('✅ Polling остановлен');
      }
      
      // Удаляем webhook если он установлен
      try {
        await this.bot.deleteWebHook();
        console.log('✅ Webhook удален');
      } catch (error) {
        console.log('⚠️ Ошибка при удалении webhook (возможно, он не был установлен)');
      }
      
      this.isStarted = false;
      console.log('✅ Telegram бот остановлен');
    } catch (error) {
      console.error('❌ Ошибка при остановке бота:', error);
    }
  }

  setupCommands() {
    console.log('⚙️ Настраиваем команды бота...');
    
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
      console.log(`📨 Получена команда /start от пользователя ${chatId}`);
      
      try {
        const user = await this.database.createUser(
          chatId,
          msg.from.username,
          msg.from.first_name,
          msg.from.last_name
        );

        const welcomeMessage = `
🎉 Добро пожаловать в наш бот!

👤 Ваш статус: ${user.status === 'active' ? 'Активный' : 'Неактивный'}

Доступные команды:
/subscribe - Оформить подписку
/status - Проверить статус подписки
/cancel - Отменить автоплатеж
/help - Помощь
        `;

        await this.bot.sendMessage(chatId, welcomeMessage, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Оформить подписку', callback_data: 'subscribe' }],
              [{ text: '📊 Мой статус', callback_data: 'status' }]
            ]
          }
        });
        
        console.log(`✅ Приветственное сообщение отправлено пользователю ${chatId}`);
      } catch (error) {
        console.error('❌ Ошибка в команде /start:', error);
        await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
      }
    });

    this.bot.onText(/\/subscribe/, async (msg) => {
      console.log(`📨 Получена команда /subscribe от пользователя ${msg.chat.id}`);
      await this.handleSubscribe(msg.chat.id);
    });

    this.bot.onText(/\/status/, async (msg) => {
      console.log(`📨 Получена команда /status от пользователя ${msg.chat.id}`);
      await this.handleStatus(msg.chat.id);
    });

    this.bot.onText(/\/cancel/, async (msg) => {
      console.log(`📨 Получена команда /cancel от пользователя ${msg.chat.id}`);
      await this.handleCancelAutoPayment(msg.chat.id);
    });

    this.bot.onText(/\/help/, async (msg) => {
      console.log(`📨 Получена команда /help от пользователя ${msg.chat.id}`);
      
      const helpMessage = `
📋 Доступные команды:

/start - Начать работу с ботом
/subscribe - Оформить подписку за 10 руб
/status - Проверить статус подписки
/cancel - Отменить автоплатеж
/help - Показать это сообщение

💡 Как это работает:
1. Первый платеж - 10 руб
2. Затем каждые 3 минуты автоматически списывается 10 руб
3. Вы можете отменить автоплатеж в любой момент
      `;

      await this.bot.sendMessage(msg.chat.id, helpMessage);
    });
    
    console.log('✅ Команды настроены');
  }

  setupCallbacks() {
    console.log('⚙️ Настраиваем callback queries...');
    
    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;
      
      console.log(`📨 Получен callback query: ${data} от пользователя ${chatId}`);

      try {
        await this.bot.answerCallbackQuery(callbackQuery.id);

        switch (data) {
          case 'subscribe':
            await this.handleSubscribe(chatId);
            break;
          case 'status':
            await this.handleStatus(chatId);
            break;
          case 'cancel_auto':
            await this.handleCancelAutoPayment(chatId);
            break;
          default:
            console.log(`⚠️ Неизвестный callback query: ${data}`);
        }
      } catch (error) {
        console.error('❌ Ошибка в callback query:', error);
      }
    });
    
    console.log('✅ Callback queries настроены');
  }

  async handleSubscribe(chatId) {
    try {
      console.log(`💳 Обработка подписки для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user.status === 'active' && user.auto_payment_enabled) {
        await this.bot.sendMessage(chatId, '✅ У вас уже есть активная подписка с автоплатежом!');
        return;
      }

      // Создаем платеж БЕЗ return_url - будет использована стандартная страница ЮКассы
      const payment = await this.yookassaService.createPayment(
        10.00,
        'Подписка на сервис - первый платеж',
        null, // Убираем return_url для использования стандартной страницы
        true
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        10.00,
        payment.status
      );

      await this.bot.sendMessage(chatId, 
        `💳 Для оформления подписки перейдите по ссылке:\n\n${payment.confirmation.confirmation_url}\n\n💰 Сумма: 10 руб\n⏰ После первого платежа каждые 3 минуты будет списываться 10 руб автоматически\n\n📱 Оплата будет проходить на стандартной странице ЮКассы`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Оплатить через ЮКассу', url: payment.confirmation.confirmation_url }]
            ]
          }
        }
      );
      
      console.log(`✅ Платеж создан для пользователя ${chatId}: ${payment.id}`);
    } catch (error) {
      console.error('❌ Ошибка при создании подписки:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при создании платежа. Попробуйте позже.');
    }
  }

  async handleStatus(chatId) {
    try {
      console.log(`📊 Проверка статуса для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      let statusMessage = `📊 Ваш статус подписки:\n\n`;
      statusMessage += `👤 Статус: ${user.status === 'active' ? '✅ Активен' : '❌ Неактивен'}\n`;
      statusMessage += `🔄 Автоплатеж: ${user.auto_payment_enabled ? '✅ Включен' : '❌ Отключен'}\n`;
      
      if (user.subscription_end) {
        statusMessage += `⏰ Действует до: ${new Date(user.subscription_end).toLocaleString('ru')}\n`;
      }

      const keyboard = [];
      
      if (user.status !== 'active') {
        keyboard.push([{ text: '💳 Оформить подписку', callback_data: 'subscribe' }]);
      }
      
      if (user.auto_payment_enabled) {
        keyboard.push([{ text: '❌ Отменить автоплатеж', callback_data: 'cancel_auto' }]);
      }

      await this.bot.sendMessage(chatId, statusMessage, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } catch (error) {
      console.error('❌ Ошибка при получении статуса:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при получении статуса.');
    }
  }

  async handleCancelAutoPayment(chatId) {
    try {
      console.log(`❌ Отмена автоплатежа для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (!user.auto_payment_enabled) {
        await this.bot.sendMessage(chatId, '❌ У вас не включен автоплатеж.');
        return;
      }

      await this.database.setAutoPayment(chatId, false);
      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_cancelled',
        'Пользователь отменил автоплатеж'
      );

      await this.bot.sendMessage(chatId, '✅ Автоплатеж отменен. Ваша подписка останется активной до окончания оплаченного периода.');
      
      console.log(`✅ Автоплатеж отменен для пользователя ${chatId}`);
    } catch (error) {
      console.error('❌ Ошибка при отмене автоплатежа:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при отмене автоплатежа.');
    }
  }

  async handlePaymentSuccess(paymentId) {
    try {
      console.log(`💰 Обработка успешного платежа: ${paymentId}`);
      
      const payment = await this.database.getPaymentByPaymentId(paymentId);
      if (!payment) {
        console.error('❌ Платеж не найден в базе данных:', paymentId);
        return;
      }

      await this.database.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
      
      // Активируем пользователя
      const subscriptionEnd = new Date();
      subscriptionEnd.setMinutes(subscriptionEnd.getMinutes() + 3);
      
      await this.database.updateUserStatus(payment.telegram_id, 'active', subscriptionEnd.toISOString());
      await this.database.setAutoPayment(payment.telegram_id, true);

      // Сохраняем payment method для рекуррентных платежей
      const yookassaPayment = await this.yookassaService.getPayment(paymentId);
      if (yookassaPayment.payment_method && yookassaPayment.payment_method.id) {
        await this.database.updateUserPaymentMethod(payment.telegram_id, yookassaPayment.payment_method.id);
      }

      await this.database.logSubscriptionAction(
        payment.user_id,
        'payment_success',
        `Платеж успешно обработан. Сумма: ${payment.amount} руб`
      );

      await this.bot.sendMessage(
        payment.telegram_id,
        `✅ Платеж успешно обработан!\n\n💰 Сумма: ${payment.amount} руб\n🔄 Автоплатеж активирован\n⏰ Следующий платеж через 3 минуты\n\n🎉 Спасибо за использование нашего сервиса!`
      );
      
      console.log(`✅ Платеж успешно обработан для пользователя ${payment.telegram_id}`);
    } catch (error) {
      console.error('❌ Ошибка при обработке успешного платежа:', error);
    }
  }

  async processWebhook(req, res) {
    try {
      const update = req.body;
      console.log('📨 Получен webhook от Telegram:', JSON.stringify(update, null, 2));
      
      await this.bot.processUpdate(update);
      res.status(200).send('OK');
      
      console.log('✅ Webhook обработан успешно');
    } catch (error) {
      console.error('❌ Ошибка при обработке webhook:', error);
      res.status(500).send('Error');
    }
  }
}