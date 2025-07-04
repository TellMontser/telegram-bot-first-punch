import TelegramBot from 'node-telegram-bot-api';

export class TelegramBotService {
  constructor(database, yookassaService, paymentScheduler) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.paymentScheduler = paymentScheduler;
    this.bot = new TelegramBot(process.env.BOT_TOKEN, { polling: false });
    this.isStarted = false;
  }

  async start() {
    if (this.isStarted) return;
    
    this.setupCommands();
    this.setupCallbacks();
    
    if (process.env.WEBHOOK_URL) {
      await this.bot.setWebHook(`${process.env.WEBHOOK_URL}/webhook/telegram`);
      console.log('Webhook установлен');
    } else {
      await this.bot.startPolling();
      console.log('Polling запущен');
    }
    
    this.isStarted = true;
    console.log('Telegram бот запущен');
  }

  async stop() {
    if (!this.isStarted) return;
    
    await this.bot.stopPolling();
    this.isStarted = false;
    console.log('Telegram бот остановлен');
  }

  setupCommands() {
    this.bot.onText(/\/start/, async (msg) => {
      const chatId = msg.chat.id;
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
    });

    this.bot.onText(/\/subscribe/, async (msg) => {
      await this.handleSubscribe(msg.chat.id);
    });

    this.bot.onText(/\/status/, async (msg) => {
      await this.handleStatus(msg.chat.id);
    });

    this.bot.onText(/\/cancel/, async (msg) => {
      await this.handleCancelAutoPayment(msg.chat.id);
    });

    this.bot.onText(/\/help/, async (msg) => {
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
  }

  setupCallbacks() {
    this.bot.on('callback_query', async (callbackQuery) => {
      const chatId = callbackQuery.message.chat.id;
      const data = callbackQuery.data;

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
      }
    });
  }

  async handleSubscribe(chatId) {
    try {
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user.status === 'active' && user.auto_payment_enabled) {
        await this.bot.sendMessage(chatId, '✅ У вас уже есть активная подписка с автоплатежом!');
        return;
      }

      const payment = await this.yookassaService.createPayment(
        10.00,
        'Подписка на сервис - первый платеж',
        `${process.env.WEBHOOK_URL}/webhook/payment-success`,
        true
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        10.00,
        payment.status
      );

      await this.bot.sendMessage(chatId, 
        `💳 Для оформления подписки перейдите по ссылке:\n\n${payment.confirmation.confirmation_url}\n\n💰 Сумма: 10 руб\n⏰ После первого платежа каждые 3 минуты будет списываться 10 руб автоматически`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Оплатить', url: payment.confirmation.confirmation_url }]
            ]
          }
        }
      );
    } catch (error) {
      console.error('Ошибка при создании подписки:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при создании платежа. Попробуйте позже.');
    }
  }

  async handleStatus(chatId) {
    try {
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
      console.error('Ошибка при получении статуса:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при получении статуса.');
    }
  }

  async handleCancelAutoPayment(chatId) {
    try {
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
    } catch (error) {
      console.error('Ошибка при отмене автоплатежа:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при отмене автоплатежа.');
    }
  }

  async handlePaymentSuccess(paymentId) {
    try {
      const payment = await this.database.getPaymentByPaymentId(paymentId);
      if (!payment) {
        console.error('Платеж не найден в базе данных:', paymentId);
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
        `✅ Платеж успешно обработан!\n\n💰 Сумма: ${payment.amount} руб\n🔄 Автоплатеж активирован\n⏰ Следующий платеж через 3 минуты`
      );
    } catch (error) {
      console.error('Ошибка при обработке успешного платежа:', error);
    }
  }

  async processWebhook(req, res) {
    try {
      const update = req.body;
      await this.bot.processUpdate(update);
      res.status(200).send('OK');
    } catch (error) {
      console.error('Ошибка при обработке webhook:', error);
      res.status(500).send('Error');
    }
  }
}