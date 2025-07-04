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
