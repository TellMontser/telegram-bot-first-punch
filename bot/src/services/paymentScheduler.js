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
    // Запуск каждые 2 минуты для автоплатежей
    this.task = cron.schedule('*/2 * * * *', async () => {
      console.log('🔄 Запуск автоплатежей каждые 2 минуты...');
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
      console.log('🔍 Получаем пользователей готовых к автоплатежу (каждые 2 минуты)...');
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
      // Получаем актуальную сумму автоплатежа пользователя
      const paymentAmount = 10; // Всегда 10 рублей
      
      // Проверяем что у пользователя есть корректный интервал
      const allowedIntervals = ['2_minutes', '3_minutes', 'hourly', 'daily', 'weekly', 'monthly', 'custom'];
      if (!user.auto_payment_interval || !allowedIntervals.includes(user.auto_payment_interval)) {
        console.warn(`⚠️ У пользователя ${user.telegram_id} некорректный интервал: ${user.auto_payment_interval}, устанавливаем 'monthly'`);
        
        // Обновляем интервал на безопасное значение
        await this.database.supabase
          .from('users')
          .update({ auto_payment_interval: 'monthly' })
          .eq('telegram_id', user.telegram_id);
        
        user.auto_payment_interval = 'monthly'; // Обновляем локально
      }
      
      // Дополнительная проверка времени на стороне приложения
      const now = this.getMoscowTime();
      const shouldProcess = this.shouldProcessAutoPayment(user, now);
      
      if (!shouldProcess.ready) {
        console.log(`⏰ Пользователь ${user.telegram_id} еще не готов к автоплатежу: ${shouldProcess.reason}`);
        return;
      }
      
      console.log(`💳 Обработка автоплатежа для пользователя ${user.telegram_id}, сумма: ${paymentAmount} руб, следующий платеж: ${shouldProcess.nextPaymentTime}`);
      
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
        10, // Всегда 10 рублей
        'Автоматическое продление подписки на Первый Панч',
        user.payment_method_id,
        user.email || 'noreply@firstpunch.ru' // Передаем email для чека или дефолтный
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        10, // Всегда 10 рублей
        payment.status,
        user.payment_method_id
      );

      await this.database.updateLastPaymentDate(user.telegram_id);

      // Очищаем next_payment_date после успешного платежа, чтобы дальше использовался расчет по интервалу
      if (user.next_payment_date) {
        await this.database.supabase
          .from('users')
          .update({ next_payment_date: null })
          .eq('telegram_id', user.telegram_id);
      }

      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_created',
        `Создан автоплатеж на 10 руб. Payment ID: ${payment.id}`
      );

      // Если платеж успешен, продлеваем подписку на месяц
      if (payment.status === 'succeeded') {
        // Рассчитываем период подписки на основе настроек пользователя
        const subscriptionEnd = this.calculateSubscriptionEndMoscow(user.auto_payment_interval, user.custom_interval_minutes);
        
        await this.database.updateUserStatus(user.telegram_id, 'active', subscriptionEnd);
        
        await this.database.logSubscriptionAction(
          user.id,
          'subscription_renewed',
          `Подписка продлена до ${subscriptionEnd}`
        );

        console.log(`✅ Подписка продлена для пользователя ${user.telegram_id} до ${subscriptionEnd}`);
        
        // Уведомляем пользователя об успешном автоплатеже
        if (this.telegramBot && this.telegramBot.bot) {
          try {
            const endDate = new Date(subscriptionEnd);
            const moscowEndDate = new Date(endDate.getTime() + (3 * 60 * 60 * 1000));
            
            await this.telegramBot.bot.sendMessage(user.telegram_id, `
✅ Автоплатеж успешно выполнен!

💰 Списано: 10 рублей
📅 Подписка продлена до: ${moscowEndDate.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🔄 Следующий автоплатеж: через ${this.getIntervalDescription(user.auto_payment_interval)}

📊 Проверить статус: /profile
            `);
          } catch (notifyError) {
            console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об успешном автоплатеже:`, notifyError);
          }
        }
      } else {
        // Уведомляем о неуспешном платеже
        if (this.telegramBot && this.telegramBot.bot) {
          try {
            await this.telegramBot.bot.sendMessage(user.telegram_id, `
❌ Автоплатеж не выполнен

💰 Сумма: 10 рублей
📋 Статус: ${payment.status}

Возможные причины:
• Недостаточно средств на карте
• Карта заблокирована или просрочена
• Технические проблемы банка

🔄 Попробуем снова при следующем автоплатеже
💳 Или оформите новую подписку: /start
            `);
          } catch (notifyError) {
            console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} о неуспешном автоплатеже:`, notifyError);
          }
        }
      }

      console.log(`✅ Автоплатеж 10 руб создан для пользователя ${user.telegram_id}: ${payment.id}`);
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
❌ Критическая ошибка автоплатежа

Не удалось списать средства для продления подписки.

Возможные причины:
• Недостаточно средств на карте
• Карта заблокирована или просрочена
• Технические проблемы банка

⚠️ Автоплатеж автоматически отключен
💳 Для возобновления подписки: /start

🔒 Доступ к закрытому каналу будет отозван при истечении текущего периода.
          `);
        } catch (notifyError) {
          console.error(`❌ Не удалось уведомить пользователя ${user.telegram_id} об ошибке автоплатежа:`, notifyError);
        }
      }
    }
  }

  // Получение московского времени
  getMoscowTime() {
    const now = new Date();
    // Московское время UTC+3
    const moscowTime = new Date(now.getTime() + (3 * 60 * 60 * 1000));
    return moscowTime;
  }

  // Описание интервала для пользователя
  getIntervalDescription(interval) {
    const descriptions = {
      '2_minutes': '2 минуты',
      '3_minutes': '3 минуты', 
      'hourly': '1 час',
      'daily': '1 день',
      'weekly': '1 неделю',
      'monthly': '1 месяц'
    };
    return descriptions[interval] || '1 месяц';
  }

  // Дополнительная проверка готовности к автоплатежу
  shouldProcessAutoPayment(user, currentTime) {
    // Если установлена точная дата следующего платежа
    if (user.next_payment_date) {
      const nextPaymentDate = new Date(user.next_payment_date);
      if (currentTime >= nextPaymentDate) {
        return {
          ready: true,
          reason: 'Достигнута установленная дата платежа',
          nextPaymentTime: nextPaymentDate.toISOString()
        };
      } else {
        return {
          ready: false,
          reason: `Ждем до ${nextPaymentDate.toLocaleString('ru-RU')}`,
          nextPaymentTime: nextPaymentDate.toISOString()
        };
      }
    }

    // Рассчитываем на основе интервала
    const baseTime = user.last_payment_date ? new Date(user.last_payment_date) : new Date(user.created_at);
    const nextPaymentTime = this.calculateNextPaymentTime(baseTime, user.auto_payment_interval, user.custom_interval_minutes);
    
    if (currentTime >= nextPaymentTime) {
      return {
        ready: true,
        reason: 'Прошел интервал с последнего платежа',
        nextPaymentTime: nextPaymentTime.toISOString()
      };
    } else {
      return {
        ready: false,
        reason: `Ждем до ${nextPaymentTime.toLocaleString('ru-RU')}`,
        nextPaymentTime: nextPaymentTime.toISOString()
      };
    }
  }

  // Расчет времени следующего платежа
  calculateNextPaymentTime(baseTime, interval, customMinutes = null) {
    // Конвертируем базовое время в московское если нужно
    const base = new Date(baseTime);
    const moscowBase = new Date(base.getTime() + (3 * 60 * 60 * 1000));
    
    switch (interval) {
      case '2_minutes':
        return new Date(moscowBase.getTime() + 2 * 60 * 1000);
      case '3_minutes':
        return new Date(moscowBase.getTime() + 3 * 60 * 1000);
      case 'hourly':
        return new Date(moscowBase.getTime() + 60 * 60 * 1000);
      case 'daily':
        return new Date(moscowBase.getTime() + 24 * 60 * 60 * 1000);
      case 'weekly':
        return new Date(moscowBase.getTime() + 7 * 24 * 60 * 60 * 1000);
      case 'monthly':
        const monthNext = new Date(moscowBase);
        monthNext.setMonth(monthNext.getMonth() + 1);
        return monthNext;
      case 'custom':
        if (customMinutes) {
          return new Date(moscowBase.getTime() + customMinutes * 60 * 1000);
        }
        // Если кастомный интервал не задан, используем месяц по умолчанию
        const defaultNext = new Date(moscowBase);
        defaultNext.setMonth(defaultNext.getMonth() + 1);
        return defaultNext;
      default:
        // По умолчанию - 2 минуты
        return new Date(moscowBase.getTime() + 2 * 60 * 1000);
    }
  }

  // Вспомогательный метод для расчета окончания подписки в московском времени
  calculateSubscriptionEndMoscow(interval, customMinutes = null) {
    const now = this.getMoscowTime();
    
    switch (interval) {
      case '2_minutes':
        return new Date(now.getTime() + 2 * 60 * 1000).toISOString();
      case '3_minutes':
        return new Date(now.getTime() + 3 * 60 * 1000).toISOString();
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000).toISOString();
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
      case 'monthly':
        const monthEnd = new Date(now);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        return monthEnd.toISOString();
      case 'custom':
        if (customMinutes) {
          return new Date(now.getTime() + customMinutes * 60 * 1000).toISOString();
        }
        // Если кастомный интервал не задан, используем месяц по умолчанию
        const defaultEnd = new Date(now);
        defaultEnd.setMonth(defaultEnd.getMonth() + 1);
        return defaultEnd.toISOString();
      default:
        // По умолчанию - 2 минуты
        return new Date(now.getTime() + 2 * 60 * 1000).toISOString();
    }
  }
  
  // Расчет времени окончания подписки в московском времени
  calculateSubscriptionEnd(interval = '2_minutes', customMinutes = null) {
    const now = this.getMoscowTime();
    
    switch (interval) {
      case '2_minutes':
        return new Date(now.getTime() + 2 * 60 * 1000);
      case '3_minutes':
        return new Date(now.getTime() + 3 * 60 * 1000);
      case 'hourly':
        return new Date(now.getTime() + 60 * 60 * 1000);
      case 'daily':
        return new Date(now.getTime() + 24 * 60 * 60 * 1000);
      case 'weekly':
        return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      case 'monthly':
        const monthEnd = new Date(now);
        monthEnd.setMonth(monthEnd.getMonth() + 1);
        return monthEnd;
      case 'custom':
        if (customMinutes) {
          return new Date(now.getTime() + customMinutes * 60 * 1000);
        }
        // Если кастомный интервал не задан, используем месяц по умолчанию
        const defaultEnd = new Date(now);
        defaultEnd.setMonth(defaultEnd.getMonth() + 1);
        return defaultEnd;
      default:
        // По умолчанию - 2 минуты
        return new Date(now.getTime() + 2 * 60 * 1000);
    }
  }

  async checkExpiredSubscriptions() {
    try {
      console.log('⏰ Проверяем истекшие подписки...');
      
      const users = await this.database.getAllUsers();
      const now = this.getMoscowTime();
      
      for (const user of users) {
        if (user.status === 'active' && user.subscription_end) {
          // Конвертируем время окончания подписки в московское время для сравнения
          const subscriptionEnd = new Date(user.subscription_end);
          const moscowSubscriptionEnd = new Date(subscriptionEnd.getTime() + (3 * 60 * 60 * 1000));
          
          if (now > moscowSubscriptionEnd) {
            console.log(`⏰ Подписка пользователя ${user.telegram_id} истекла. Московское время: ${now.toLocaleString('ru-RU')}, окончание: ${moscowSubscriptionEnd.toLocaleString('ru-RU')}`);
            
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
⏰ Подписка истекла

📅 Время истечения: ${moscowSubscriptionEnd.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
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

            // Кикаем из канала если есть доступ
            if (this.telegramBot && this.telegramBot.PRIVATE_CHANNEL_ID) {
              await this.telegramBot.checkAndManageChannelMember(
                this.telegramBot.PRIVATE_CHANNEL_ID, 
                user.telegram_id
              );
            }
          } else {
            // Логируем что подписка еще активна
            const timeLeft = moscowSubscriptionEnd.getTime() - now.getTime();
            const minutesLeft = Math.floor(timeLeft / (1000 * 60));
            console.log(`✅ Подписка пользователя ${user.telegram_id} активна еще ${minutesLeft} минут`);
          }
        }
      }
      
      console.log('✅ Проверка истекших подписок завершена');
    } catch (error) {
      console.error('❌ Ошибка при проверке истекших подписок:', error);
    }
  }
}
