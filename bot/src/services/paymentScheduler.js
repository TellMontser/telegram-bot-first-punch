import cron from 'node-cron';

export class PaymentScheduler {
  constructor(database, yookassaService, telegramBot = null) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.telegramBot = telegramBot; // Добавляем ссылку на бота для управления каналом
    this.task = null;
    this.auditTask = null;
  }

  start() {
    // Запуск каждые 3 минуты для автоплатежей
    this.task = cron.schedule('*/3 * * * *', async () => {
      console.log('🔄 Запуск автоматических платежей...');
      await this.processAutoPayments();
    });

    // Запуск каждые 10 минут для аудита канала
    this.auditTask = cron.schedule('*/10 * * * *', async () => {
      console.log('🔍 Запуск аудита закрытого канала...');
      if (this.telegramBot) {
        await this.telegramBot.performChannelAudit();
      }
    });

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
      console.log(`💳 Обработка автоплатежа для пользователя ${user.telegram_id}, сумма: ${user.auto_payment_amount} руб, интервал: ${user.auto_payment_interval}`);
      
      const payment = await this.yookassaService.createRecurringPayment(
        parseFloat(user.auto_payment_amount),
        `Автоматическое продление подписки (${user.auto_payment_amount} руб)`,
        user.payment_method_id
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        parseFloat(user.auto_payment_amount),
        payment.status,
        user.payment_method_id
      );

      // Обновляем дату последнего платежа
      await this.database.updateLastPaymentDate(user.telegram_id);

      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_created',
        `Создан автоплатеж на ${user.auto_payment_amount} руб (интервал: ${user.auto_payment_interval}). Payment ID: ${payment.id}`
      );

      // Если платеж успешен, продлеваем подписку
      if (payment.status === 'succeeded') {
        // Рассчитываем время окончания подписки на основе интервала
        const subscriptionEnd = this.calculateSubscriptionEnd(user.auto_payment_interval);
        
        await this.database.updateUserStatus(user.telegram_id, 'active', subscriptionEnd.toISOString());
        
        await this.database.logSubscriptionAction(
          user.id,
          'subscription_renewed',
          `Подписка продлена до ${subscriptionEnd.toISOString()}`
        );

        console.log(`✅ Подписка продлена для пользователя ${user.telegram_id}`);
      }

      console.log(`✅ Автоплатеж ${user.auto_payment_amount} руб создан для пользователя ${user.telegram_id}: ${payment.id}`);
    } catch (error) {
      console.error(`❌ Ошибка при создании автоплатежа для пользователя ${user.telegram_id}:`, error);
      
      // Отключаем автоплатеж при ошибке
      await this.database.setAutoPayment(user.telegram_id, false);
      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_disabled',
        `Автоплатеж отключен из-за ошибки: ${error.message}`
      );

      // Уведомляем пользователя об ошибке автоплатежа
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
💳 Для возобновления подписки: /subscribe

⚠️ Доступ к закрытому каналу будет отозван при истечении текущего периода.
          `);
        } catch (notifyError) {
          console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об ошибке автоплатежа:`, notifyError);
        }
      }
    }
  }

  // Рассчитываем время окончания подписки на основе интервала
  calculateSubscriptionEnd(interval) {
    const now = new Date();
    
    switch (interval) {
      case '3_minutes':
        return new Date(now.getTime() + 3 * 60 * 1000);
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case 'monthly':
        return new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() + 3 * 60 * 1000);
    }
  }
  // Метод для проверки истекших подписок
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
            
            // Деактивируем пользователя
            await this.database.updateUserStatus(user.telegram_id, 'inactive');
            await this.database.setAutoPayment(user.telegram_id, false);
            
            await this.database.logSubscriptionAction(
              user.id,
              'subscription_expired',
              'Подписка истекла'
            );

            // Уведомляем пользователя
            if (this.telegramBot && this.telegramBot.bot) {
              try {
                await this.telegramBot.bot.sendMessage(user.telegram_id, `
⏰ Ваша подписка истекла

🔒 Доступ к закрытому каналу отозван
❌ Автоплатеж отключен

Для возобновления подписки:
💳 Оформить новую подписку: /subscribe
📊 Проверить статус: /status
                `);
              } catch (notifyError) {
                console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об истечении подписки:`, notifyError);
              }
            }

            // Проверяем участие в канале и удаляем при необходимости
            if (this.telegramBot) {
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