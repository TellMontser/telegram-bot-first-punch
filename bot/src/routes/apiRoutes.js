import express from 'express';

export function apiRoutes(database) {
  const router = express.Router();

  // Получение статистики
  router.get('/stats', async (req, res) => {
    try {
      const stats = await database.getStats();
      res.json(stats);
    } catch (error) {
      console.error('Ошибка при получении статистики:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Получение всех пользователей
  router.get('/users', async (req, res) => {
    try {
      const users = await database.getAllUsers();
      res.json(users);
    } catch (error) {
      console.error('Ошибка при получении пользователей:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Получение всех платежей
  router.get('/payments', async (req, res) => {
    try {
      const payments = await database.getAllPayments();
      res.json(payments);
    } catch (error) {
      console.error('Ошибка при получении платежей:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Получение логов
  router.get('/logs', async (req, res) => {
    try {
      const logs = await database.getSubscriptionLogs();
      res.json(logs);
    } catch (error) {
      console.error('Ошибка при получении логов:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Получение пользователя по ID
  router.get('/users/:id', async (req, res) => {
    try {
      const user = await database.getUserByTelegramId(req.params.id);
      if (!user) {
        return res.status(404).json({ error: 'Пользователь не найден' });
      }
      res.json(user);
    } catch (error) {
      console.error('Ошибка при получении пользователя:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Обновление статуса пользователя
  router.put('/users/:id/status', async (req, res) => {
    try {
      const { status, subscriptionEnd } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`📝 Обновление статуса пользователя ${telegramId}: ${status}`);
      
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
      
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка при обновлении статуса:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Управление автоплатежом
  router.put('/users/:id/auto-payment', async (req, res) => {
    try {
      const { enabled } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`🔄 Изменение автоплатежа пользователя ${telegramId}: ${enabled}`);
      
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
      
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка при изменении автоплатежа:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  // Отправка сообщения пользователю
  router.post('/send-message', async (req, res) => {
    try {
      const { telegramId, message } = req.body;
      
      console.log(`💬 Отправка сообщения пользователю ${telegramId}: ${message}`);
      
      // Здесь нужно получить доступ к экземпляру бота
      // Мы добавим это в следующем обновлении
      
      res.json({ success: true });
    } catch (error) {
      console.error('Ошибка при отправке сообщения:', error);
      res.status(500).json({ error: 'Ошибка сервера' });
    }
  });

  return router;
}
