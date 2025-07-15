import express from 'express';
import multer from 'multer';
import path from 'path';

// Настройка multer для загрузки файлов
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif|mp4|mov|avi|webm/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error('Неподдерживаемый тип файла'));
    }
  }
});

export function apiRoutes(database, telegramBot) {
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

  // Получение криптоплатежей
  router.get('/crypto-payments', async (req, res) => {
    try {
      console.log('₿ API: Запрос криптоплатежей');
      const cryptoPayments = await database.getAllCryptoPayments();
      console.log('✅ API: Криптоплатежи получены:', cryptoPayments.length);
      res.json(cryptoPayments);
    } catch (error) {
      console.error('❌ API: Ошибка при получении криптоплатежей:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение статистики криптоплатежей
  router.get('/crypto-stats', async (req, res) => {
    try {
      console.log('📊 API: Запрос статистики криптоплатежей');
      const cryptoStats = await database.getCryptoStats();
      console.log('✅ API: Статистика криптоплатежей получена:', cryptoStats);
      res.json(cryptoStats);
    } catch (error) {
      console.error('❌ API: Ошибка при получении статистики криптоплатежей:', error);
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

      // Отправляем уведомление пользователю
      if (telegramBot && telegramBot.bot) {
        try {
          const message = status === 'active' 
            ? '✅ Ваша подписка активирована администратором!'
            : '❌ Ваша подписка деактивирована администратором.';
          
          await telegramBot.bot.sendMessage(telegramId, message);
          console.log(`📤 API: Уведомление отправлено пользователю ${telegramId}`);
        } catch (botError) {
          console.warn(`⚠️ API: Не удалось отправить уведомление пользователю ${telegramId}:`, botError);
        }
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

      // Отправляем уведомление пользователю
      if (telegramBot && telegramBot.bot) {
        try {
          const message = enabled 
            ? '🔄 Автоплатеж включен администратором.'
            : '⏹️ Автоплатеж отключен администратором.';
          
          await telegramBot.bot.sendMessage(telegramId, message);
          console.log(`📤 API: Уведомление об автоплатеже отправлено пользователю ${telegramId}`);
        } catch (botError) {
          console.warn(`⚠️ API: Не удалось отправить уведомление об автоплатеже пользователю ${telegramId}:`, botError);
        }
      }
      
      console.log(`✅ API: Автоплатеж пользователя ${telegramId} обновлен`);
      res.json({ success: true, message: 'Автоплатеж обновлен' });
    } catch (error) {
      console.error('❌ API: Ошибка при изменении автоплатежа:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Обновление настроек автоплатежа (сумма и интервал)
  router.put('/users/:id/auto-payment-settings', async (req, res) => {
    try {
      const { amount, interval, customInterval, nextPaymentDate } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`💰 API: Обновление настроек автоплатежа пользователя ${telegramId}:`, {
        amount,
        interval,
        customInterval,
        nextPaymentDate
      });
      
      // Валидация данных
      if (!amount || amount <= 0) {
        return res.status(400).json({ error: 'Некорректная сумма' });
      }
      
      const validIntervals = ['3_minutes', 'hourly', 'daily', 'weekly', 'monthly', 'custom'];
      if (!validIntervals.includes(interval)) {
        return res.status(400).json({ error: 'Некорректный интервал' });
      }
      
      // Обработка кастомного интервала
      let customMinutes = null;
      if (interval === 'custom' && customInterval) {
        customMinutes = await database.parseCustomInterval(customInterval);
        if (!customMinutes) {
          return res.status(400).json({ error: 'Некорректный формат интервала. Используйте формат: "30 minutes", "1.5 hours", "2 days"' });
        }
      }

      // Валидация даты
      let parsedNextPaymentDate = null;
      if (nextPaymentDate) {
        parsedNextPaymentDate = new Date(nextPaymentDate).toISOString();
        if (new Date(parsedNextPaymentDate) <= new Date()) {
          return res.status(400).json({ error: 'Дата следующего платежа должна быть в будущем' });
        }
      }
      
      await database.updateAutoPaymentSettings(telegramId, amount, interval, customMinutes, parsedNextPaymentDate);
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        let details = `Настройки автоплатежа изменены администратором: ${amount} руб`;
        
        if (interval === 'custom' && customInterval) {
          details += `, интервал: ${customInterval} (${customMinutes} мин)`;
        } else {
          details += `, интервал: ${interval}`;
        }
        
        if (nextPaymentDate) {
          details += `, следующий платеж: ${new Date(nextPaymentDate).toLocaleString('ru-RU')}`;
        }
        
        await database.logSubscriptionAction(
          user.id,
          'admin_autopay_settings_update',
          details
        );
      }

      // Отправляем уведомление пользователю
      if (telegramBot && telegramBot.bot) {
        try {
          const intervalNames = {
            '3_minutes': 'каждые 3 минуты',
            'hourly': 'каждый час',
            'daily': 'каждый день',
            'weekly': 'каждую неделю',
            'monthly': 'каждый месяц',
            'custom': customInterval || 'кастомный интервал'
          };
          
          let message = `💰 Настройки автоплатежа обновлены администратором:

💵 Новая сумма: ${amount} руб
⏰ Новый период: ${intervalNames[interval]}`;

          if (nextPaymentDate) {
            message += `\n📅 Следующий платеж: ${new Date(nextPaymentDate).toLocaleString('ru-RU')}`;
          }

          message += '\n\nИзменения вступят в силу при следующем платеже.';
          
          await telegramBot.bot.sendMessage(telegramId, message);
          console.log(`📤 API: Уведомление о настройках автоплатежа отправлено пользователю ${telegramId}`);
        } catch (botError) {
          console.warn(`⚠️ API: Не удалось отправить уведомление о настройках пользователю ${telegramId}:`, botError);
        }
      }
      
      console.log(`✅ API: Настройки автоплатежа пользователя ${telegramId} обновлены`);
      res.json({ success: true, message: 'Настройки автоплатежа обновлены' });
    } catch (error) {
      console.error('❌ API: Ошибка при обновлении настроек автоплатежа:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Обновление статуса пользователя с кастомным временем
  router.put('/users/:id/status-custom', async (req, res) => {
    try {
      const { status, duration, specificEndDate } = req.body;
      const telegramId = parseInt(req.params.id);
      
      console.log(`📝 API: Обновление статуса пользователя ${telegramId} с кастомными настройками:`, {
        status,
        duration,
        specificEndDate
      });
      
      let subscriptionEnd = null;
      
      if (specificEndDate) {
        subscriptionEnd = new Date(specificEndDate).toISOString();
        if (new Date(subscriptionEnd) <= new Date()) {
          return res.status(400).json({ error: 'Дата окончания должна быть в будущем' });
        }
      }
      
      const finalSubscriptionEnd = await database.updateUserStatusWithCustomEnd(
        telegramId, 
        status, 
        subscriptionEnd, 
        duration
      );
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        let details = `Статус изменен администратором на: ${status}`;
        
        if (finalSubscriptionEnd) {
          details += `, действует до: ${new Date(finalSubscriptionEnd).toLocaleString('ru-RU')}`;
        }
        
        if (duration) {
          details += `, длительность: ${duration}`;
        }
        
        await database.logSubscriptionAction(
          user.id,
          'admin_status_update_custom',
          details
        );
      }

      // Отправляем уведомление пользователю
      if (telegramBot && telegramBot.bot) {
        try {
          let message = status === 'active' 
            ? '✅ Ваша подписка активирована администратором!'
            : '❌ Ваша подписка деактивирована администратором.';
          
          if (finalSubscriptionEnd && status === 'active') {
            message += `\n📅 Действует до: ${new Date(finalSubscriptionEnd).toLocaleString('ru-RU')}`;
          }
          
          await telegramBot.bot.sendMessage(telegramId, message);
          console.log(`📤 API: Уведомление отправлено пользователю ${telegramId}`);
        } catch (botError) {
          console.warn(`⚠️ API: Не удалось отправить уведомление пользователю ${telegramId}:`, botError);
        }
      }
      
      console.log(`✅ API: Статус пользователя ${telegramId} обновлен с кастомными настройками`);
      res.json({ 
        success: true, 
        message: 'Статус обновлен',
        subscriptionEnd: finalSubscriptionEnd
      });
    } catch (error) {
      console.error('❌ API: Ошибка при обновлении статуса с кастомными настройками:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });
  // Отправка сообщения пользователю
  router.post('/send-message', async (req, res) => {
    try {
      const { telegramId, message } = req.body;
      
      console.log(`💬 API: Отправка сообщения пользователю ${telegramId}: ${message}`);
      
      if (!telegramBot || !telegramBot.bot) {
        console.error('❌ API: Telegram бот недоступен');
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      // Отправляем сообщение через бота
      await telegramBot.bot.sendMessage(telegramId, message);
      
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

  // Отправка рассылки с медиа и кнопками
  router.post('/send-broadcast', upload.single('media_file'), async (req, res) => {
    try {
      const { telegramId, text, parse_mode, buttons, media_type } = req.body;
      const mediaFile = req.file;
      
      console.log(`📢 API: Отправка рассылки пользователю ${telegramId}`);
      
      if (!telegramBot || !telegramBot.bot) {
        console.error('❌ API: Telegram бот недоступен');
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      // Подготавливаем опции сообщения
      const messageOptions = {
        parse_mode: parse_mode !== 'None' ? parse_mode : undefined,
        reply_markup: undefined
      };

      // Добавляем кнопки если есть
      if (buttons) {
        try {
          const parsedButtons = JSON.parse(buttons);
          if (parsedButtons.length > 0) {
            const inlineKeyboard = parsedButtons.map(row => 
              row.map(button => ({
                text: button.text,
                ...(button.url ? { url: button.url } : { callback_data: button.callback_data || button.text })
              }))
            );
            messageOptions.reply_markup = { inline_keyboard: inlineKeyboard };
          }
        } catch (error) {
          console.warn('⚠️ Ошибка парсинга кнопок:', error);
        }
      }

      // Отправляем сообщение с медиа или без
      if (mediaFile && media_type) {
        const mediaBuffer = mediaFile.buffer;
        
        // Подготавливаем fileOptions для корректной отправки медиа
        const fileOptions = {
          filename: mediaFile.originalname,
          contentType: mediaFile.mimetype
        };
        
        switch (media_type) {
          case 'photo':
            await telegramBot.bot.sendPhoto(telegramId, mediaBuffer, {
              caption: text,
              ...messageOptions
            }, fileOptions);
            break;
          case 'video':
            await telegramBot.bot.sendVideo(telegramId, mediaBuffer, {
              caption: text,
              ...messageOptions
            }, fileOptions);
            break;
          case 'video_note':
            await telegramBot.bot.sendVideoNote(telegramId, mediaBuffer, {}, fileOptions);
            if (text) {
              await telegramBot.bot.sendMessage(telegramId, text, messageOptions);
            }
            break;
          default:
            throw new Error(`Неподдерживаемый тип медиа: ${media_type}`);
        }
      } else {
        // Отправляем только текстовое сообщение
        await telegramBot.bot.sendMessage(telegramId, text, messageOptions);
      }
      
      // Логируем действие
      const user = await database.getUserByTelegramId(telegramId);
      if (user) {
        await database.logSubscriptionAction(
          user.id,
          'admin_broadcast_sent',
          `Администратор отправил рассылку: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`
        );
      }
      
      console.log(`✅ API: Рассылка пользователю ${telegramId} отправлена`);
      res.json({ success: true, message: 'Рассылка отправлена' });
    } catch (error) {
      console.error('❌ API: Ошибка при отправке рассылки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // === API ДЛЯ УПРАВЛЕНИЯ КАНАЛОМ ===

  // Получение запросов на вступление в канал
  router.get('/channel/requests', async (req, res) => {
    try {
      console.log('🔒 API: Запрос списка запросов на вступление в канал');
      
      const requests = await database.getChannelRequests();
      
      console.log('✅ API: Запросы канала получены:', requests.length);
      res.json(requests);
    } catch (error) {
      console.error('❌ API: Ошибка при получении запросов канала:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение статистики канала
  router.get('/channel/stats', async (req, res) => {
    try {
      console.log('📊 API: Запрос статистики канала');
      
      const stats = await database.getChannelStats();
      
      console.log('✅ API: Статистика канала получена:', stats);
      res.json(stats);
    } catch (error) {
      console.error('❌ API: Ошибка при получении статистики канала:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Одобрение запроса на вступление
  router.post('/channel/requests/:id/approve', async (req, res) => {
    try {
      const requestId = req.params.id;
      console.log(`✅ API: Одобрение запроса ${requestId}`);
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      await telegramBot.approveChannelRequestAPI(requestId);
      
      console.log(`✅ API: Запрос ${requestId} одобрен`);
      res.json({ success: true, message: 'Запрос одобрен' });
    } catch (error) {
      console.error('❌ API: Ошибка при одобрении запроса:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Отклонение запроса на вступление
  router.post('/channel/requests/:id/decline', async (req, res) => {
    try {
      const requestId = req.params.id;
      console.log(`❌ API: Отклонение запроса ${requestId}`);
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      await telegramBot.declineChannelRequestAPI(requestId);
      
      console.log(`✅ API: Запрос ${requestId} отклонен`);
      res.json({ success: true, message: 'Запрос отклонен' });
    } catch (error) {
      console.error('❌ API: Ошибка при отклонении запроса:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Кик пользователя из канала
  router.post('/channel/kick-user', async (req, res) => {
    try {
      const { userId } = req.body;
      console.log(`🚫 API: Кик пользователя ${userId} из канала`);
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      // Кикаем пользователя из канала
      await telegramBot.checkAndManageChannelMember(telegramBot.PRIVATE_CHANNEL_ID, userId);
      
      // Обновляем статус запроса на "kicked" если есть
      const request = await database.getChannelRequestByUserId(userId);
      if (request) {
        await database.updateChannelRequestStatus(request.id, 'kicked', 'admin_panel');
      }
      
      // Логируем действие
      const user = await database.getUserByTelegramId(userId);
      if (user) {
        await database.logSubscriptionAction(
          user.id,
          'channel_kicked_manual',
          'Пользователь кикнут из канала администратором через панель'
        );
      }
      
      console.log(`✅ API: Пользователь ${userId} кикнут из канала`);
      res.json({ success: true, message: 'Пользователь кикнут из канала' });
    } catch (error) {
      console.error('❌ API: Ошибка при кике пользователя:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Массовое одобрение запросов
  router.post('/channel/requests/bulk-approve', async (req, res) => {
    try {
      const { requestIds } = req.body;
      console.log(`✅ API: Массовое одобрение ${requestIds.length} запросов`);
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      let successCount = 0;
      let errorCount = 0;

      for (const requestId of requestIds) {
        try {
          await telegramBot.approveChannelRequestAPI(requestId);
          successCount++;
        } catch (error) {
          console.error(`❌ Ошибка при одобрении запроса ${requestId}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ API: Массовое одобрение завершено: ${successCount} успешно, ${errorCount} ошибок`);
      res.json({ 
        success: true, 
        message: `${successCount} запросов одобрено, ${errorCount} ошибок`,
        successCount,
        errorCount
      });
    } catch (error) {
      console.error('❌ API: Ошибка при массовом одобрении:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Массовое отклонение запросов
  router.post('/channel/requests/bulk-decline', async (req, res) => {
    try {
      const { requestIds } = req.body;
      console.log(`❌ API: Массовое отклонение ${requestIds.length} запросов`);
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      let successCount = 0;
      let errorCount = 0;

      for (const requestId of requestIds) {
        try {
          await telegramBot.declineChannelRequestAPI(requestId);
          successCount++;
        } catch (error) {
          console.error(`❌ Ошибка при отклонении запроса ${requestId}:`, error);
          errorCount++;
        }
      }
      
      console.log(`✅ API: Массовое отклонение завершено: ${successCount} успешно, ${errorCount} ошибок`);
      res.json({ 
        success: true, 
        message: `${successCount} запросов отклонено, ${errorCount} ошибок`,
        successCount,
        errorCount
      });
    } catch (error) {
      console.error('❌ API: Ошибка при массовом отклонении:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Принудительный аудит канала
  router.post('/channel/audit', async (req, res) => {
    try {
      console.log('🔍 API: Запуск принудительного аудита канала');
      
      if (!telegramBot) {
        return res.status(503).json({ error: 'Telegram бот недоступен' });
      }

      await telegramBot.performChannelAudit();
      
      console.log('✅ API: Аудит канала завершен');
      res.json({ success: true, message: 'Аудит канала завершен' });
    } catch (error) {
      console.error('❌ API: Ошибка при аудите канала:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // === API ДЛЯ РЕФЕРАЛЬНОЙ СИСТЕМЫ ===

  // Получение всех реферальных ссылок
  router.get('/referrals/links', async (req, res) => {
    try {
      console.log('🔗 API: Запрос реферальных ссылок');
      
      const { data, error } = await database.supabase
        .from('referral_links')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      console.log('✅ API: Реферальные ссылки получены:', data?.length || 0);
      res.json(data || []);
    } catch (error) {
      console.error('❌ API: Ошибка при получении реферальных ссылок:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Создание новой реферальной ссылки
  router.post('/referrals/links', async (req, res) => {
    try {
      const { referrerName, subscriptionAmount } = req.body;
      console.log(`🔗 API: Создание реферальной ссылки для ${referrerName}`);
      
      const { data, error } = await database.supabase
        .rpc('create_referral_link', {
          p_referrer_name: referrerName,
          p_subscription_amount: subscriptionAmount
        });

      if (error) throw error;

      console.log('✅ API: Реферальная ссылка создана:', data);
      res.json(data);
    } catch (error) {
      console.error('❌ API: Ошибка при создании реферальной ссылки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Обновление реферальной ссылки
  router.put('/referrals/links/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const updateData = req.body;
      console.log(`🔄 API: Обновление реферальной ссылки ${id}`);
      
      const { data, error } = await database.supabase
        .from('referral_links')
        .update(updateData)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;

      console.log('✅ API: Реферальная ссылка обновлена');
      res.json(data);
    } catch (error) {
      console.error('❌ API: Ошибка при обновлении реферальной ссылки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Удаление реферальной ссылки
  router.delete('/referrals/links/:id', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`🗑️ API: Удаление реферальной ссылки ${id}`);
      
      const { error } = await database.supabase
        .from('referral_links')
        .delete()
        .eq('id', id);

      if (error) throw error;

      console.log('✅ API: Реферальная ссылка удалена');
      res.json({ success: true, message: 'Реферальная ссылка удалена' });
    } catch (error) {
      console.error('❌ API: Ошибка при удалении реферальной ссылки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение статистики реферальной ссылки
  router.get('/referrals/links/:id/stats', async (req, res) => {
    try {
      const { id } = req.params;
      console.log(`📊 API: Запрос статистики реферальной ссылки ${id}`);
      
      const { data, error } = await database.supabase
        .rpc('get_referral_link_stats', { p_referral_link_id: id });

      if (error) throw error;

      console.log('✅ API: Статистика реферальной ссылки получена');
      res.json(data?.[0] || {});
    } catch (error) {
      console.error('❌ API: Ошибка при получении статистики реферальной ссылки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение детальной статистики рефералов
  router.get('/referrals/stats', async (req, res) => {
    try {
      const { linkId } = req.query;
      console.log('📈 API: Запрос детальной статистики рефералов');
      
      let query = database.supabase
        .from('referral_stats')
        .select(`
          *,
          referral_links!inner(referrer_name, code)
        `)
        .order('created_at', { ascending: false });

      if (linkId) {
        query = query.eq('referral_link_id', linkId);
      }

      const { data, error } = await query;

      if (error) throw error;

      console.log('✅ API: Детальная статистика рефералов получена:', data?.length || 0);
      res.json(data || []);
    } catch (error) {
      console.error('❌ API: Ошибка при получении детальной статистики рефералов:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Получение топ рефералов
  router.get('/referrals/top', async (req, res) => {
    try {
      const { limit = 10 } = req.query;
      console.log(`🏆 API: Запрос топ ${limit} рефералов`);
      
      const { data, error } = await database.supabase
        .rpc('get_top_referrals', { limit_count: parseInt(limit) });

      if (error) throw error;

      console.log('✅ API: Топ рефералы получены:', data?.length || 0);
      res.json(data || []);
    } catch (error) {
      console.error('❌ API: Ошибка при получении топ рефералов:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // === API ДЛЯ УПРАВЛЕНИЯ НАСТРОЙКАМИ ПОДПИСКИ ===

  // Получение настроек подписки
  router.get('/subscription/settings', async (req, res) => {
    try {
      console.log('⚙️ API: Запрос настроек подписки');
      
      const { data, error } = await database.supabase
        .from('subscription_settings')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') throw error;

      // Если настройки не найдены, возвращаем значения по умолчанию
      const settings = data || {
        id: 'default',
        subscription_amount: 1000.00,
        currency: 'RUB',
        updated_at: new Date().toISOString(),
        updated_by: 'system'
      };

      console.log('✅ API: Настройки подписки получены:', settings);
      res.json(settings);
    } catch (error) {
      console.error('❌ API: Ошибка при получении настроек подписки:', error);
      res.status(500).json({ error: 'Ошибка сервера', details: error.message });
    }
  });

  // Обновление настроек подписки
  router.put('/subscription/settings', async (req, res) => {
    try {
      const { amount } = req.body;
      console.log(`💰 API: Обновление суммы подписки на ${amount}`);
      
      if (!amount || amount <= 0 || amount > 100000) {
        return res.status(400).json({ error: 'Сумма должна быть от 1 до 100 000 рублей' });
      }

      // Используем функцию для обновления настроек
      const { error } = await database.supabase
        .rpc('update_subscription_amount', {
          new_amount: amount,
          updated_by_user: 'admin_panel'
        });

      if (error) throw error;

      console.log(`✅ API: Сумма подписки обновлена на ${amount} руб`);
      res.json({ success: true, message: 'Сумма подписки обновлена', amount });
    } catch (error) {
      console.error('❌ API: Ошибка при обновлении настроек подписки:', error);
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