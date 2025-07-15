import cron from 'node-cron';

export class PaymentScheduler {
  constructor(database, yookassaService, telegramBot = null) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.telegramBot = telegramBot;
    this.task = null;
    this.auditTask = null;
  }

  start() {
    // Запуск каждый месяц для автоплатежей (изменено с 3 минут на месяц)
    this.task = cron.schedule('0 0 1 * *', async () => {
      console.log('🔄 Запуск ежемесячных автоплатежей...');
      await this.processAutoPayments();
    });

    // Запуск каждые 10 минут для аудита канала
    if (this.telegramBot && this.telegramBot.PRIVATE_CHANNEL_ID) {
      this.auditTask = cron.schedule('*/10 * * * *', async () => {
        console.log('🔍 Запуск аудита закрытого канала...');
        await this.telegramBot.performChannelAudit();
      });
    }

    console.log('✅ Планировщик платежей и аудита запущен');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('⏹️ Планировщик платежей остановлен');
    }
    
    if (this.auditTask) {
      this.auditTask.stop();
      console.log('⏹️ Планировщик аудита остановлен');
    }
  }

  async processAutoPayments() {
    try {
      console.log('🔍 Получаем пользователей готовых к автоплатежу...');
      const users = await this.database.getUsersReadyForAutoPayment();
      
      console.log(`💳 Найдено ${users.length} пользователей готовых к автоплатежу`);
      
      for (const user of users) {
        await this.processUserAutoPayment(user);
      }
    } catch (error) {
      console.error('❌ Ошибка при обработке автоплатежей:', error);
    }
  }

  async processUserAutoPayment(user) {
    try {
      // Получаем текущую сумму подписки
      const subscriptionAmount = await this.database.getSubscriptionAmount();
      console.log(`💳 Обработка автоплатежа для пользователя ${user.telegram_id}, сумма: ${subscriptionAmount} руб`);
      
      if (!user.payment_method_id) {
        console.log(`⚠️ У пользователя ${user.telegram_id} нет payment_method_id, пропускаем автоплатеж`);
        
        await this.database.setAutoPayment(user.telegram_id, false);
        await this.database.logSubscriptionAction(
          user.id,
          'auto_payment_disabled',
          'Автоплатеж отключен: отсутствует payment_method_id'
        );
        
        if (this.telegramBot && this.telegramBot.bot) {
          try {
            await this.telegramBot.bot.sendMessage(user.telegram_id, `
⚠️ Автоплатеж отключен

Автоматическое продление подписки недоступно.

Для продления подписки:
💳 Оформите новую подписку: /start
📊 Проверьте статус: /profile

⚠️ Доступ к закрытому каналу будет отозван при истечении текущего периода.
            `);
          } catch (notifyError) {
            console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об отключении автоплатежа:`, notifyError);
          }
        }
        
        return;
      }

      // Рекуррентный платеж через ЮКассу с email пользователя
      const payment = await this.yookassaService.createRecurringPayment(
        subscriptionAmount,
        'Автоматическое продление подписки на Первый Панч',
        user.payment_method_id,
        user.email // Передаем email для чека
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        subscriptionAmount,
        payment.status,
        user.payment_method_id
      );

      await this.database.updateLastPaymentDate(user.telegram_id);

      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_created',
        `Создан автоплатеж на ${subscriptionAmount} руб. Payment ID: ${payment.id}`
      );

      // Если платеж успешен, продлеваем подписку на месяц
      if (payment.status === 'succeeded') {
        const subscriptionEnd = new Date();
        subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
        
        await this.database.updateUserStatus(user.telegram_id, 'active', subscriptionEnd.toISOString());
        
        await this.database.logSubscriptionAction(
          user.id,
          'subscription_renewed',
          `Подписка продлена до ${subscriptionEnd.toISOString()}`
        );

        console.log(`✅ Подписка продлена для пользователя ${user.telegram_id}`);
      }

      console.log(`✅ Автоплатеж ${subscriptionAmount} руб создан для пользователя ${user.telegram_id}: ${payment.id}`);
    } catch (error) {
      console.error(`❌ Ошибка при создании автоплатежа для пользователя ${user.telegram_id}:`, error);
      
      await this.database.setAutoPayment(user.telegram_id, false);
      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_disabled',
        `Автоплатеж отключен из-за ошибки: ${error.message}`
      );

      if (this.telegramBot && this.telegramBot.bot) {
        try {
          await this.telegramBot.bot.sendMessage(user.telegram_id, `
⚠️ Ошибка автоплатежа

Не удалось списать средства для продления подписки.

Возможные причины:
• Недостаточно средств на карте
• Карта заблокирована или просрочена
• Технические проблемы банка

🔄 Автоплатеж автоматически отключен
💳 Для возобновления подписки: /start

⚠️ Доступ к закрытому каналу будет отозван при истечении текущего периода.
          `);
        } catch (notifyError) {
          console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об ошибке автоплатежа:`, notifyError);
        }
      }
    }
  }

  async checkExpiredSubscriptions() {
    try {
      console.log('⏰ Проверяем истекшие подписки...');
      
      const users = await this.database.getAllUsers();
      const now = new Date();
      
      for (const user of users) {
        if (user.status === 'active' && user.subscription_end) {
          const subscriptionEnd = new Date(user.subscription_end);
          
          if (now > subscriptionEnd) {
            console.log(`⏰ Подписка пользователя ${user.telegram_id} истекла`);
            
            await this.database.updateUserStatus(user.telegram_id, 'inactive');
            await this.database.setAutoPayment(user.telegram_id, false);
            
            await this.database.logSubscriptionAction(
              user.id,
              'subscription_expired',
              'Подписка истекла'
            );

            if (this.telegramBot && this.telegramBot.bot) {
              try {
                await this.telegramBot.bot.sendMessage(user.telegram_id, `
⏰ Ваша подписка истекла

🔒 Доступ к закрытому каналу отозван
❌ Автоплатеж отключен

Для возобновления подписки:
💳 Оформить новую подписку: /start
📊 Проверить статус: /profile
                `);
              } catch (notifyError) {
                console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об истечении подписки:`, notifyError);
              }
            }

            if (this.telegramBot && this.telegramBot.PRIVATE_CHANNEL_ID) {
              await this.telegramBot.checkAndManageChannelMember(
                this.telegramBot.PRIVATE_CHANNEL_ID, 
                user.telegram_id
              );
            }
          }
        }
      }
      
      console.log('✅ Проверка истекших подписок завершена');
    } catch (error) {
      console.error('❌ Ошибка при проверке истекших подписок:', error);
    }
  }
}