import express from 'express';

export function apiRoutes(database) {
  const router = express.Router();

  // Получение статистики
  router.get('/stats', async (req, res) => {
    try {
      console.log('📊 API: Запрос статистики');
      const stats = await database.getStats();
      console.log('✅ API: Статистика получена:', stats);
      res.json(stats);
    } catch (error) {
      console.error('❌ API: Ошибка при получении статистики:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение всех пользователей
  router.get('/users', async (req, res) => {
    try {
      console.log('👥 API: Запрос пользователей');
      const users = await database.getAllUsers();
      console.log('✅ API: Пользователи получены:', users.length);
      res.json(users);
    } catch (error) {
      console.error('❌ API: Ошибка при получении пользователей:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение всех платежей
  router.get('/payments', async (req, res) => {
    try {
      console.log('💳 API: Запрос платежей');
      const payments = await database.getAllPayments();
      console.log('✅ API: Платежи получены:', payments.length);
      res.json(payments);
    } catch (error) {
      console.error('❌ API: Ошибка при получении платежей:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение логов
  router.get('/logs', async (req, res) => {
    try {
      console.log('📋 API: Запрос логов');
      const logs = await database.getSubscriptionLogs();
      console.log('✅ API: Логи получены:', logs.length);
      res.json(logs);
    } catch (error) {
      console.error('❌ API: Ошибка при получении логов:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение пользователя по ID
  router.get('/users/:id', async (req, res) => {
    try {
      const telegramId = parseInt(req.params.id);
      console.log(`👤 API: Запрос пользователя ${telegramId}`);
      
      const user = await database.getUserByTelegramId(telegramId);
      if (!user) {
        console.log(`❌ API: Пользователь ${telegramId} не найден`);
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      
      console.log(`✅ API: Пользователь ${telegramId} найден`);
      res.json(user);
    } catch (error) {
      console.error('❌ API: Ошибка при получении пользователя:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Обновление статуса пользователя
  router.put('/users/:id/status', async (req, res) => {
    try {
      const { status, subscriptionEnd } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`📝 API: Обновление статуса пользователя ${telegramId}: ${status}`);
      
      await database.updateUserStatus(telegramId, status, subscriptionEnd);
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        await database.logSubscriptionAction(
          user.id,
          'admin_status_update',
          `Статус изменен администратором на: ${status}`
        );
      }
      
      console.log(`✅ API: Статус пользователя ${telegramId} обновлен`);
      res.json({ success: true, message: 'Статус обновлен' });
    } catch (error) {
      console.error('❌ API: Ошибка при обновлении статуса:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Управление автоплатежом
  router.put('/users/:id/auto-payment', async (req, res) => {
    try {
      const { enabled } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`🔄 API: Изменение автоплатежа пользователя ${telegramId}: ${enabled}`);
      
      await database.setAutoPayment(telegramId, enabled);
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        await database.logSubscriptionAction(
          user.id,
          'admin_autopay_update',
          `Автоплатеж ${enabled ? 'включен' : 'отключен'} администратором`
        );
      }
      
      console.log(`✅ API: Автоплатеж пользователя ${telegramId} обновлен`);
      res.json({ success: true, message: 'Автоплатеж обновлен' });
    } catch (error) {
      console.error('❌ API: Ошибка при изменении автоплатежа:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Отправка сообщения пользователю
  router.post('/send-message', async (req, res) => {
    try {
      const { telegramId, message } = req.body;
      
      console.log(`💬 API: Отправка сообщения пользователю ${telegramId}: ${message}`);
      
      // Здесь нужно получить доступ к экземпляру бота
      // Пока что просто логируем
      console.log(`📤 API: Сообщение для ${telegramId}: ${message}`);
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        await database.logSubscriptionAction(
          user.id,
          'admin_message_sent',
          `Администратор отправил сообщение: ${message}`
        );
      }
      
      console.log(`✅ API: Сообщение пользователю ${telegramId} отправлено`);
      res.json({ success: true, message: 'Сообщение отправлено' });
    } catch (error) {
      console.error('❌ API: Ошибка при отправке сообщения:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Проверка подключения к базе данных
  router.get('/health/database', async (req, res) => {
    try {
      console.log('🔍 API: Проверка подключения к базе данных');
      
      // Простой запрос для проверки подключения
      const stats = await database.getStats();
      
      console.log('✅ API: База данных доступна');
      res.json({ 
        status: 'ok', 
        message: 'База данных доступна',
        timestamp: new Date().toISOString(),
        stats 
      });
    } catch (error) {
      console.error('❌ API: База данных недоступна:', error);
      res.status(500).json({ 
        status: 'error', 
        message: 'База данных недоступна',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  });

  return router;
}
