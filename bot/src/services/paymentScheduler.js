import cron from 'node-cron';

export class PaymentScheduler {
  constructor(database, yookassaService) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.task = null;
  }

  start() {
    // Запуск каждые 3 минуты
    this.task = cron.schedule('*/3 * * * *', async () => {
      console.log('Запуск автоматических платежей...');
      await this.processAutoPayments();
    });

    console.log('Планировщик платежей запущен');
  }

  stop() {
    if (this.task) {
      this.task.stop();
      console.log('Планировщик платежей остановлен');
    }
  }

  async processAutoPayments() {
    try {
      const users = await this.database.getActiveUsersWithAutoPayment();
      
      for (const user of users) {
        await this.processUserAutoPayment(user);
      }
    } catch (error) {
      console.error('Ошибка при обработке автоплатежей:', error);
    }
  }

  async processUserAutoPayment(user) {
    try {
      console.log(`Обработка автоплатежа для пользователя ${user.telegram_id}`);
      
      const payment = await this.yookassaService.createRecurringPayment(
        10.00,
        'Автоматическое продление подписки',
        user.payment_method_id
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        10.00,
        payment.status,
        user.payment_method_id
      );

      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_created',
        `Создан автоплатеж на 10 руб. Payment ID: ${payment.id}`
      );

      console.log(`Автоплатеж создан для пользователя ${user.telegram_id}: ${payment.id}`);
    } catch (error) {
      console.error(`Ошибка при создании автоплатежа для пользователя ${user.telegram_id}:`, error);
      
      // Отключаем автоплатеж при ошибке
      await this.database.setAutoPayment(user.telegram_id, false);
      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_disabled',
        `Автоплатеж отключен из-за ошибки: ${error.message}`
      );
    }
  }
}