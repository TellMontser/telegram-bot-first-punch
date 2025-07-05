import TelegramBot from 'node-telegram-bot-api';

export class TelegramBotService {
  constructor(database, yookassaService, paymentScheduler) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.paymentScheduler = paymentScheduler;
    
    // ID закрытого канала (получите через @userinfobot)
    this.PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID || '-1002876590285';
    this.PRIVATE_CHANNEL_LINK = 'https://t.me/+TEw_Ql5PbLIxNmMy';
    
    // Список админов канала (Telegram ID)
    this.CHANNEL_ADMINS = (process.env.CHANNEL_ADMINS || '794139414,1139585647').split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
    
    // Проверяем наличие токена
    const botToken = process.env.BOT_TOKEN;
    if (!botToken) {
      throw new Error('BOT_TOKEN не найден в переменных среды');
    }
    
    console.log('🤖 Инициализация бота с токеном:', botToken.substring(0, 15) + '...');
    console.log('🔒 Закрытый канал ID:', this.PRIVATE_CHANNEL_ID);
    console.log('👑 Админы канала:', this.CHANNEL_ADMINS);
    console.log('🔗 Ссылка на канал:', this.PRIVATE_CHANNEL_LINK);
    
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
      
      // Проверяем права бота в канале
      await this.checkBotPermissions();
      
      this.setupCommands();
      this.setupCallbacks();
      this.setupChannelManagement();
      
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

  // Проверка прав бота в канале
  async checkBotPermissions() {
    try {
      console.log('🔍 Проверяем права бота в канале...');
      
      const me = await this.bot.getMe();
      const chatMember = await this.bot.getChatMember(this.PRIVATE_CHANNEL_ID, me.id);
      
      console.log('🤖 Статус бота в канале:', chatMember.status);
      console.log('🔑 Права бота:', {
        can_restrict_members: chatMember.can_restrict_members,
        can_invite_users: chatMember.can_invite_users,
        can_delete_messages: chatMember.can_delete_messages
      });
      
      if (chatMember.status !== 'administrator') {
        console.warn('⚠️ ВНИМАНИЕ: Бот не является администратором канала!');
        console.warn('📋 Для корректной работы бот должен быть админом с правами:');
        console.warn('   - Удаление участников');
        console.warn('   - Приглашение пользователей');
        console.warn('   - Управление запросами на вступление');
      } else {
        console.log('✅ Бот имеет права администратора в канале');
      }
      
    } catch (error) {
      console.error('❌ Ошибка при проверке прав бота в канале:', error);
      console.warn('⚠️ Убедитесь, что:');
      console.warn('   1. Бот добавлен в канал как администратор');
      console.warn('   2. ID канала указан правильно:', this.PRIVATE_CHANNEL_ID);
      console.warn('   3. Бот имеет права на управление участниками');
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
    
    this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const startParam = match?.[1]; // Параметр после /start
      console.log(`📨 Получена команда /start от пользователя ${chatId}`, startParam ? `с параметром: ${startParam}` : '');
      
      try {
        // Сначала проверяем, существует ли уже пользователь
        let existingUser = await this.database.getUserByTelegramId(chatId);
        
        // Переменные для реферальной системы
        let referralSource = existingUser?.referral_source || null;
        let referralLinkId = existingUser?.referral_link_id || null;
        let customAmount = null;
        
        // Если есть реферальная ссылка, получаем сумму
        if (referralLinkId) {
          const { data: referralLink } = await this.database.supabase
            .from('referral_links')
            .select('subscription_amount')
            .eq('id', referralLinkId)
            .single();
          
          if (referralLink) {
            customAmount = referralLink.subscription_amount;
          }
        }
        
        // Обрабатываем реферальный параметр только если пользователь новый или еще не имеет реферала
        if (startParam && startParam.startsWith('ref_') && (!existingUser || !existingUser.referral_source)) {
          console.log(`🔗 Обнаружен реферальный код: ${startParam}`);
          
          // Логируем клик по реферальной ссылке
          await this.database.supabase.rpc('log_referral_action', {
            p_referral_code: startParam,
            p_telegram_id: chatId,
            p_action_type: 'click'
          });
          
          // Получаем информацию о реферальной ссылке
          const { data: referralLink, error } = await this.database.supabase
            .from('referral_links')
            .select('*')
            .eq('code', startParam)
            .eq('is_active', true)
            .single();
          
          if (!error && referralLink) {
            referralSource = `Реф. ${referralLink.referrer_name}`;
            referralLinkId = referralLink.id;
            customAmount = referralLink.subscription_amount;
            console.log(`✅ Найдена активная реферальная ссылка: ${referralLink.referrer_name}, сумма: ${customAmount} ₽`);
            
            // Если пользователь уже существует, обновляем его реферальную информацию
            if (existingUser) {
              await this.database.supabase
                .from('users')
                .update({
                  referral_source: referralSource,
                  referral_link_id: referralLinkId
                })
                .eq('telegram_id', chatId);
              
              console.log(`🔄 Обновлена реферальная информация для существующего пользователя ${chatId}`);
            }
          }
        }
        
        // Создаем или получаем пользователя
        let user;
        if (existingUser) {
          // Обновляем информацию о пользователе (имя, username могли измениться)
          await this.database.supabase
            .from('users')
            .update({
              username: msg.from.username,
              first_name: msg.from.first_name,
              last_name: msg.from.last_name
            })
            .eq('telegram_id', chatId);
          
          // Получаем обновленного пользователя
          user = await this.database.getUserByTelegramId(chatId);
          console.log(`🔄 Обновлена информация существующего пользователя ${chatId}`);
        } else {
          // Создаем нового пользователя
          user = await this.database.createUser(
            chatId,
            msg.from.username,
            msg.from.first_name,
            msg.from.last_name,
            referralSource,
            referralLinkId
          );
          console.log(`✅ Создан новый пользователь ${chatId}`);
        }
        
        // Если это новый пользователь с реферальным кодом или обновили реферала, логируем регистрацию
        if (referralSource && referralLinkId && startParam && startParam.startsWith('ref_')) {
          await this.database.supabase.rpc('log_referral_action', {
            p_referral_code: startParam,
            p_telegram_id: chatId,
            p_action_type: 'register'
          });
          
          console.log(`📝 Зарегистрирован новый реферал: ${referralSource}`);
        }
        
        // Получаем актуальную сумму для отображения
        if (user.referral_link_id && !customAmount) {
          const { data: referralLink } = await this.database.supabase
            .from('referral_links')
            .select('subscription_amount')
            .eq('id', user.referral_link_id)
            .single();
          
          if (referralLink) {
            customAmount = referralLink.subscription_amount;
          }
        }

        let welcomeMessage = `
🎉 Добро пожаловать в наш бот!

👤 Ваш статус: ${user.status === 'active' ? 'Активный' : 'Неактивный'}
${user.referral_source ? `\n🔗 Источник: ${user.referral_source}` : ''}
${customAmount ? `\n💰 Специальная цена для вас: ${customAmount} ₽` : ''}

Доступные команды:
/subscribe - Оформить подписку
/status - Проверить статус подписки
/cancel - Отменить автоплатеж
/channel - Получить доступ к закрытому каналу
/help - Помощь
        `;

        const keyboard = [
          [{ text: customAmount ? `💳 Оформить подписку (${customAmount} ₽)` : '💳 Оформить подписку', callback_data: 'subscribe' }],
          [{ text: '📊 Мой статус', callback_data: 'status' }]
        ];

        // Если пользователь активен, добавляем кнопку канала
        if (user.status === 'active') {
          keyboard.push([{ text: '🔒 Закрытый канал', callback_data: 'channel_access' }]);
        }

        await this.bot.sendMessage(chatId, welcomeMessage, {
          reply_markup: {
            inline_keyboard: keyboard
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

    this.bot.onText(/\/channel/, async (msg) => {
      console.log(`📨 Получена команда /channel от пользователя ${msg.chat.id}`);
      await this.handleChannelAccess(msg.chat.id);
    });

    this.bot.onText(/\/help/, async (msg) => {
      console.log(`📨 Получена команда /help от пользователя ${msg.chat.id}`);
      
      const helpMessage = `
📋 Доступные команды:

/start - Начать работу с ботом
/subscribe - Оформить подписку за 10 руб
/status - Проверить статус подписки
/cancel - Отменить автоплатеж
/channel - Получить доступ к закрытому каналу
/help - Показать это сообщение

💡 Как это работает:
1. Первый платеж - 10 руб
2. Затем каждые 3 минуты автоматически списывается 10 руб
3. Вы можете отменить автоплатеж в любой момент
4. При активной подписке получаете доступ к закрытому каналу

🔒 Закрытый канал:
- Доступен только при активной подписке
- Автоматическое управление доступом
- Эксклюзивный контент для подписчиков
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
          case 'channel_access':
            await this.handleChannelAccess(chatId);
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

  // Настройка управления каналом
  setupChannelManagement() {
    console.log('🔒 Настраиваем управление закрытым каналом...');

    // Обработка запросов на вступление в канал
    this.bot.on('chat_join_request', async (chatJoinRequest) => {
      const userId = chatJoinRequest.from.id;
      const chatId = chatJoinRequest.chat.id;
      const username = chatJoinRequest.from.username;
      const firstName = chatJoinRequest.from.first_name;
      const lastName = chatJoinRequest.from.last_name;
      
      console.log(`🔑 Запрос на вступление в канал от пользователя ${userId} (@${username}) в чат ${chatId}`);
      console.log(`🔍 Проверяем канал: ожидаем ${this.PRIVATE_CHANNEL_ID}, получили ${chatId}`);
      
      // Проверяем, что это наш закрытый канал
      if (chatId.toString() !== this.PRIVATE_CHANNEL_ID.toString()) {
        console.log(`⚠️ Запрос не для нашего канала: получен ${chatId}, ожидается ${this.PRIVATE_CHANNEL_ID}`);
        return;
      }

      try {
        // Сохраняем запрос в базу данных
        await this.database.createChannelRequest(userId, username, firstName, lastName);
        console.log(`📝 Запрос на вступление сохранен в базу данных для пользователя ${userId}`);
        
        console.log(`🔍 Проверяем пользователя ${userId} в базе данных...`);
        
        // Проверяем статус пользователя в базе данных
        const user = await this.database.getUserByTelegramId(userId);
        
        if (!user) {
          console.log(`❌ Пользователь ${userId} не найден в базе данных`);
          
          try {
            await this.bot.declineChatJoinRequest(chatId, userId);
            console.log(`✅ Запрос от ${userId} отклонен`);
            
            // Обновляем статус в базе данных
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'declined', 'auto_system');
            }
          } catch (declineError) {
            console.error(`❌ Ошибка при отклонении запроса от ${userId}:`, declineError);
          }
          
          // Отправляем сообщение пользователю
          try {
            const botInfo = await this.bot.getMe();
            await this.bot.sendMessage(userId, `
❌ Доступ к каналу запрещен

Вы не зарегистрированы в нашем боте. Для получения доступа к закрытому каналу:

1. Запустите бота: /start
2. Оформите подписку: /subscribe
3. После активации подписки получите доступ к каналу

🤖 Начать работу с ботом: @${botInfo.username}
            `);
            console.log(`📤 Отправлено уведомление пользователю ${userId} о необходимости регистрации`);
          } catch (dmError) {
            console.log(`⚠️ Не удалось отправить DM пользователю ${userId}:`, dmError.message);
          }
          return;
        }

        console.log(`👤 Пользователь ${userId} найден, статус: ${user.status}`);

        // Проверяем статус подписки
        if (user.status === 'active') {
          console.log(`✅ Пользователь ${userId} имеет активную подписку, одобряем запрос`);
          
          try {
            await this.bot.approveChatJoinRequest(chatId, userId);
            console.log(`✅ Запрос от ${userId} одобрен`);
            
            // Обновляем статус в базе данных
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'approved', 'auto_system');
            }
            
            // Логируем действие
            await this.database.logSubscriptionAction(
              user.id,
              'channel_access_granted',
              `Пользователь получил доступ к закрытому каналу`
            );

            // Отправляем приветственное сообщение
            try {
              await this.bot.sendMessage(userId, `
🎉 Добро пожаловать в закрытый канал!

✅ Ваш запрос на вступление одобрен
🔒 Теперь у вас есть доступ к эксклюзивному контенту
💎 Наслаждайтесь премиум-материалами!

⚠️ Помните: доступ к каналу действует только при активной подписке
              `);
              console.log(`📤 Отправлено приветственное сообщение пользователю ${userId}`);
            } catch (dmError) {
              console.log(`⚠️ Не удалось отправить приветственное сообщение пользователю ${userId}:`, dmError.message);
            }
          } catch (approveError) {
            console.error(`❌ Ошибка при одобрении запроса от ${userId}:`, approveError);
          }
          
        } else {
          console.log(`❌ Пользователь ${userId} не имеет активной подписки (статус: ${user.status}), отклоняем запрос`);
          
          try {
            await this.bot.declineChatJoinRequest(chatId, userId);
            console.log(`✅ Запрос от ${userId} отклонен`);
            
            // Обновляем статус в базе данных
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'declined', 'auto_system');
            }
            
            // Логируем действие
            await this.database.logSubscriptionAction(
              user.id,
              'channel_access_denied',
              `Доступ к каналу отклонен: неактивная подписка (статус: ${user.status})`
            );

            // Отправляем сообщение о необходимости подписки
            try {
              await this.bot.sendMessage(userId, `
❌ Доступ к каналу запрещен

Для получения доступа к закрытому каналу необходима активная подписка.

Ваш текущий статус: ${user.status === 'inactive' ? 'Неактивен' : user.status}

💳 Оформить подписку: /subscribe
📊 Проверить статус: /status

После активации подписки вы сможете повторно запросить доступ к каналу.
              `);
              console.log(`📤 Отправлено уведомление об отказе пользователю ${userId}`);
            } catch (dmError) {
              console.log(`⚠️ Не удалось отправить сообщение об отказе пользователю ${userId}:`, dmError.message);
            }
          } catch (declineError) {
            console.error(`❌ Ошибка при отклонении запроса от ${userId}:`, declineError);
          }
        }
        
      } catch (error) {
        console.error(`❌ Ошибка при обработке запроса на вступление от ${userId}:`, error);
        
        // В случае ошибки отклоняем запрос
        try {
          await this.bot.declineChatJoinRequest(chatId, userId);
          console.log(`✅ Запрос от ${userId} отклонен из-за ошибки`);
        } catch (declineError) {
          console.error(`❌ Ошибка при отклонении запроса:`, declineError);
        }
      }
    });

    // Обработка новых участников канала (если кто-то был добавлен напрямую)
    this.bot.on('new_chat_members', async (msg) => {
      const chatId = msg.chat.id;
      
      console.log(`👥 Новые участники в чате ${chatId}`);
      
      // Проверяем, что это наш закрытый канал
      if (chatId.toString() !== this.PRIVATE_CHANNEL_ID.toString()) {
        console.log(`⚠️ Событие не для нашего канала: ${chatId}`);
        return;
      }

      console.log(`🔍 Проверяем новых участников в нашем канале`);
      
      for (const newMember of msg.new_chat_members) {
        console.log(`👤 Проверяем нового участника: ${newMember.id} (@${newMember.username})`);
        await this.checkAndManageChannelMember(chatId, newMember.id);
      }
    });

    // Обработка покинувших участников
    this.bot.on('left_chat_member', async (msg) => {
      const chatId = msg.chat.id;
      const leftMember = msg.left_chat_member;
      
      if (chatId.toString() === this.PRIVATE_CHANNEL_ID.toString()) {
        console.log(`👋 Пользователь ${leftMember.id} (@${leftMember.username}) покинул канал`);
        
        // Логируем событие
        try {
          const user = await this.database.getUserByTelegramId(leftMember.id);
          if (user) {
            await this.database.logSubscriptionAction(
              user.id,
              'channel_left',
              'Пользователь покинул закрытый канал'
            );
          }
        } catch (error) {
          console.error(`❌ Ошибка при логировании выхода пользователя ${leftMember.id}:`, error);
        }
      }
    });

    console.log('✅ Управление каналом настроено');
  }

  // Проверка и управление участником канала
  async checkAndManageChannelMember(chatId, userId) {
    try {
      console.log(`🔍 Проверяем участника ${userId} в канале ${chatId}`);
      
      // Проверяем, не админ ли это
      if (this.CHANNEL_ADMINS.includes(userId)) {
        console.log(`👑 Пользователь ${userId} является админом канала, пропускаем проверку`);
        return;
      }

      // Получаем информацию о пользователе из базы данных
      const user = await this.database.getUserByTelegramId(userId);
      
      if (!user || user.status !== 'active') {
        console.log(`🚫 Пользователь ${userId} не имеет активной подписки (статус: ${user?.status || 'не найден'}), удаляем из канала`);
        
        try {
          // Используем banChatMember вместо kickChatMember
          console.log(`🚫 Пытаемся забанить пользователя ${userId}...`);
          await this.bot.banChatMember(chatId, userId);
          console.log(`✅ Пользователь ${userId} забанен`);
          
          // Сразу разбаниваем, чтобы мог подать запрос снова
          setTimeout(async () => {
            try {
              await this.bot.unbanChatMember(chatId, userId);
              console.log(`✅ Пользователь ${userId} разбанен`);
            } catch (unbanError) {
              console.error(`❌ Ошибка при разбане пользователя ${userId}:`, unbanError);
            }
          }, 1000);
          
          // Логируем действие
          if (user) {
            await this.database.logSubscriptionAction(
              user.id,
              'channel_access_revoked',
              `Пользователь удален из канала: неактивная подписка (статус: ${user.status})`
            );
          }

          // Отправляем уведомление пользователю
          try {
            await this.bot.sendMessage(userId, `
🚫 Вы были удалены из закрытого канала

Причина: ${user ? `неактивная подписка (статус: ${user.status})` : 'не зарегистрированы в боте'}

Для восстановления доступа:
${user ? '💳 Продлите подписку: /subscribe' : '🤖 Зарегистрируйтесь в боте: /start'}
📊 Проверьте статус: /status

После активации подписки вы сможете снова запросить доступ к каналу.
            `);
            console.log(`📤 Отправлено уведомление об удалении пользователю ${userId}`);
          } catch (dmError) {
            console.log(`⚠️ Не удалось отправить уведомление пользователю ${userId}:`, dmError.message);
          }
          
        } catch (banError) {
          console.error(`❌ Ошибка при бане пользователя ${userId}:`, banError);
          
          // Если banChatMember не работает, пробуем restrictChatMember
          try {
            console.log(`🔄 Пытаемся ограничить пользователя ${userId}...`);
            await this.bot.restrictChatMember(chatId, userId, {
              can_send_messages: false,
              can_send_media_messages: false,
              can_send_polls: false,
              can_send_other_messages: false,
              can_add_web_page_previews: false,
              can_change_info: false,
              can_invite_users: false,
              can_pin_messages: false
            });
            console.log(`✅ Пользователь ${userId} ограничен в правах`);
          } catch (restrictError) {
            console.error(`❌ Ошибка при ограничении пользователя ${userId}:`, restrictError);
          }
        }
      } else {
        console.log(`✅ Пользователь ${userId} имеет активную подписку, оставляем в канале`);
      }
      
    } catch (error) {
      console.error(`❌ Ошибка при проверке участника ${userId}:`, error);
    }
  }

  // Периодическая проверка участников канала
  async performChannelAudit() {
    try {
      console.log('🔍 Выполняем аудит участников закрытого канала...');
      
      // Получаем количество участников
      const chatMemberCount = await this.bot.getChatMemberCount(this.PRIVATE_CHANNEL_ID);
      console.log(`👥 Всего участников в канале: ${chatMemberCount}`);
      
      // Получаем список администраторов
      const chatAdmins = await this.bot.getChatAdministrators(this.PRIVATE_CHANNEL_ID);
      console.log(`👑 Администраторов в канале: ${chatAdmins.length}`);
      
      // Проверяем каждого администратора (кроме ботов и создателя)
      for (const admin of chatAdmins) {
        if (!admin.user.is_bot && admin.status !== 'creator' && !this.CHANNEL_ADMINS.includes(admin.user.id)) {
          console.log(`🔍 Проверяем администратора ${admin.user.id} (@${admin.user.username})`);
          await this.checkAndManageChannelMember(this.PRIVATE_CHANNEL_ID, admin.user.id);
        }
      }
      
      console.log('✅ Аудит канала завершен');
    } catch (error) {
      console.error('❌ Ошибка при аудите канала:', error);
      
      if (error.response?.body?.error_code === 400) {
        console.error('📋 Возможные причины ошибки:');
        console.error('   - Бот не является администратором канала');
        console.error('   - Неправильный ID канала');
        console.error('   - Недостаточно прав у бота');
      }
    }
  }

  // === API МЕТОДЫ ДЛЯ УПРАВЛЕНИЯ КАНАЛОМ ===

  // Одобрение запроса через API
  async approveChannelRequestAPI(requestId) {
    try {
      console.log(`✅ API: Одобрение запроса ${requestId}`);
      
      const request = await this.database.getChannelRequestById(requestId);
      if (!request) {
        throw new Error('Запрос не найден');
      }

      if (request.status !== 'pending') {
        throw new Error('Запрос уже обработан');
      }

      // Одобряем запрос в Telegram
      await this.bot.approveChatJoinRequest(this.PRIVATE_CHANNEL_ID, request.user_id);
      
      // Обновляем статус в базе данных
      await this.database.updateChannelRequestStatus(requestId, 'approved', 'admin_panel');
      
      // Логируем действие
      const user = await this.database.getUserByTelegramId(request.user_id);
      if (user) {
        await this.database.logSubscriptionAction(
          user.id,
          'channel_request_approved_manual',
          `Запрос на вступление одобрен администратором через панель`
        );
      }

      console.log(`✅ API: Запрос ${requestId} успешно одобрен`);
      return true;
    } catch (error) {
      console.error(`❌ API: Ошибка при одобрении запроса ${requestId}:`, error);
      throw error;
    }
  }

  // Отклонение запроса через API
  async declineChannelRequestAPI(requestId) {
    try {
      console.log(`❌ API: Отклонение запроса ${requestId}`);
      
      const request = await this.database.getChannelRequestById(requestId);
      if (!request) {
        throw new Error('Запрос не найден');
      }

      if (request.status !== 'pending') {
        throw new Error('Запрос уже обработан');
      }

      // Отклоняем запрос в Telegram
      await this.bot.declineChatJoinRequest(this.PRIVATE_CHANNEL_ID, request.user_id);
      
      // Обновляем статус в базе данных
      await this.database.updateChannelRequestStatus(requestId, 'declined', 'admin_panel');
      
      // Логируем действие
      const user = await this.database.getUserByTelegramId(request.user_id);
      if (user) {
        await this.database.logSubscriptionAction(
          user.id,
          'channel_request_declined_manual',
          `Запрос на вступление отклонен администратором через панель`
        );
      }

      console.log(`✅ API: Запрос ${requestId} успешно отклонен`);
      return true;
    } catch (error) {
      console.error(`❌ API: Ошибка при отклонении запроса ${requestId}:`, error);
      throw error;
    }
  }

  async handleSubscribe(chatId) {
    try {
      console.log(`💳 Обработка подписки для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      // Определяем сумму подписки (реферальная или стандартная)
      let subscriptionAmount = 10.00;
      
      if (user.referral_link_id) {
        // Получаем сумму из реферальной ссылки
        const { data: referralLink } = await this.database.supabase
          .from('referral_links')
          .select('subscription_amount')
          .eq('id', user.referral_link_id)
          .single();
        
        if (referralLink) {
          subscriptionAmount = parseFloat(referralLink.subscription_amount);
          console.log(`💰 Используем реферальную цену: ${subscriptionAmount} ₽`);
        }
      }
      
      if (user.status === 'active' && user.auto_payment_enabled) {
        await this.bot.sendMessage(chatId, `
✅ У вас уже есть активная подписка с автоплатежом!

🔒 Доступ к закрытому каналу: /channel
📊 Проверить статус: /status
        `);
        return;
      }

      // Создаем платеж БЕЗ return_url - будет использована стандартная страница ЮКассы
      const payment = await this.yookassaService.createPayment(
        subscriptionAmount,
        `Подписка на сервис - первый платеж${user.referral_source ? ` (${user.referral_source})` : ''}`,
        null, // Убираем return_url для использования стандартной страницы
        true
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        subscriptionAmount,
        payment.status
      );

      await this.bot.sendMessage(chatId, 
        `💳 Для оформления подписки перейдите по ссылке:\n\n${payment.confirmation.confirmation_url}\n\n💰 Сумма: ${subscriptionAmount} руб${user.referral_source ? ` (специальная цена от ${user.referral_source})` : ''}\n⏰ После первого платежа каждые 3 минуты будет списываться ${subscriptionAmount} руб автоматически\n🔒 При активной подписке получите доступ к закрытому каналу\n\n📱 Оплата будет проходить на стандартной странице ЮКассы`,
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

      // Добавляем информацию о канале
      if (user.status === 'active') {
        statusMessage += `\n🔒 Доступ к закрытому каналу: ✅ Разрешен`;
      } else {
        statusMessage += `\n🔒 Доступ к закрытому каналу: ❌ Требуется активная подписка`;
      }

      const keyboard = [];
      
      if (user.status !== 'active') {
        keyboard.push([{ text: '💳 Оформить подписку', callback_data: 'subscribe' }]);
      } else {
        keyboard.push([{ text: '🔒 Закрытый канал', callback_data: 'channel_access' }]);
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

  async handleChannelAccess(chatId) {
    try {
      console.log(`🔒 Запрос доступа к каналу от пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user.status !== 'active') {
        await this.bot.sendMessage(chatId, `
❌ Доступ к закрытому каналу запрещен

Для получения доступа необходима активная подписка.

💳 Оформить подписку: /subscribe
📊 Проверить статус: /status
        `);
        return;
      }

      await this.bot.sendMessage(chatId, `
🔒 Доступ к закрытому каналу

✅ У вас есть активная подписка!
🎉 Вы можете присоединиться к нашему закрытому каналу с эксклюзивным контентом.

👇 Нажмите на ссылку ниже для вступления:
${this.PRIVATE_CHANNEL_LINK}

⚠️ Важно:
• Доступ действует только при активной подписке
• При отмене подписки доступ будет автоматически отозван
• Не делитесь ссылкой с другими пользователями

💎 Наслаждайтесь премиум-контентом!
      `, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔗 Перейти в канал', url: this.PRIVATE_CHANNEL_LINK }],
            [{ text: '📊 Мой статус', callback_data: 'status' }]
          ]
        }
      });

      // Логируем запрос доступа
      await this.database.logSubscriptionAction(
        user.id,
        'channel_link_requested',
        'Пользователь запросил ссылку на закрытый канал'
      );
      
    } catch (error) {
      console.error('❌ Ошибка при предоставлении доступа к каналу:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при получении доступа к каналу.');
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

      await this.bot.sendMessage(chatId, `
✅ Автоплатеж отменен

Ваша подписка останется активной до окончания оплаченного периода.

⚠️ После окончания подписки:
• Доступ к закрытому каналу будет отозван
• Для восстановления потребуется новая оплата

📊 Проверить статус: /status
💳 Возобновить подписку: /subscribe
      `);
      
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

      // Логируем реферальную подписку если есть
      const user = await this.database.getUserByTelegramId(payment.telegram_id);
      if (user && user.referral_link_id) {
        const { data: referralLink } = await this.database.supabase
          .from('referral_links')
          .select('code')
          .eq('id', user.referral_link_id)
          .single();
        
        if (referralLink) {
          await this.database.supabase.rpc('log_referral_action', {
            p_referral_code: referralLink.code,
            p_telegram_id: payment.telegram_id,
            p_action_type: 'payment',
            p_amount: payment.amount,
            p_details: `Первый платеж по реферальной ссылке`
          });
          
          console.log(`💰 Зафиксирован реферальный платеж: ${payment.amount} ₽`);
        }
      }
      await this.database.logSubscriptionAction(
        payment.user_id,
        'payment_success',
        `Платеж успешно обработан. Сумма: ${payment.amount} руб`
      );

      await this.bot.sendMessage(
        payment.telegram_id,
        `✅ Платеж успешно обработан!

💰 Сумма: ${payment.amount} руб
🔄 Автоплатеж активирован
⏰ Следующий платеж через 3 минуты
🔒 Доступ к закрытому каналу открыт!

🎉 Спасибо за использование нашего сервиса!

Команды:
/channel - Получить доступ к закрытому каналу
/status - Проверить статус подписки`,
        {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔒 Закрытый канал', callback_data: 'channel_access' }],
              [{ text: '📊 Мой статус', callback_data: 'status' }]
            ]
          }
        }
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
