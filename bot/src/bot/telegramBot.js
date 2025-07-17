import TelegramBot from 'node-telegram-bot-api';

export class TelegramBotService {
  constructor(database, yookassaService, paymentScheduler, cryptoCloudService = null) {
    this.database = database;
    this.yookassaService = yookassaService;
    this.cryptoCloudService = cryptoCloudService;
    this.paymentScheduler = paymentScheduler;
    
    // ID закрытого канала
    this.PRIVATE_CHANNEL_ID = process.env.PRIVATE_CHANNEL_ID;
    this.PRIVATE_CHANNEL_LINK = process.env.PRIVATE_CHANNEL_LINK;
    
    // Список админов канала
    this.CHANNEL_ADMINS = process.env.CHANNEL_ADMINS ? process.env.CHANNEL_ADMINS.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id)) : [];
    
    if (!this.PRIVATE_CHANNEL_ID || !this.PRIVATE_CHANNEL_LINK) {
      console.warn('⚠️ ВНИМАНИЕ: Настройки канала не найдены в переменных среды');
      this.PRIVATE_CHANNEL_ID = null;
      this.PRIVATE_CHANNEL_LINK = null;
    }
    
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
    
    // Состояние для ввода email
    this.awaitingEmail = new Map();
    
    // Хранение ID последних сообщений для удаления
    this.lastBotMessages = new Map();
  }

  async start() {
    if (this.isStarted) {
      console.log('⚠️ Бот уже запущен');
      return;
    }
    
    try {
      console.log('🔍 Проверяем авторизацию бота...');
      
      const me = await this.bot.getMe();
      console.log('✅ Бот успешно авторизован:', me.username, `(ID: ${me.id})`);
      
      if (this.PRIVATE_CHANNEL_ID) {
        await this.checkBotPermissions();
      }
      
      this.setupCommands();
      this.setupCallbacks();
      if (this.PRIVATE_CHANNEL_ID) {
        this.setupChannelManagement();
      }
      
      if (process.env.WEBHOOK_URL) {
        const webhookUrl = `${process.env.WEBHOOK_URL}/webhook/telegram`;
        console.log('🔗 Настраиваем webhook:', webhookUrl);
        
        try {
          console.log('🗑️ Удаляем старый webhook...');
          await this.bot.deleteWebHook();
          
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          console.log('📡 Устанавливаем новый webhook...');
          const result = await this.bot.setWebHook(webhookUrl, {
            drop_pending_updates: true
          });
          
          if (result) {
            console.log('✅ Webhook успешно установлен');
            
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
      
      if (error.response) {
        console.error('📄 Ответ сервера:', error.response.body);
      }
      
      throw error;
    }
  }

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
      } else {
        console.log('✅ Бот имеет права администратора в канале');
      }
      
    } catch (error) {
      console.error('❌ Ошибка при проверке прав бота в канале:', error);
    }
  }

  async stop() {
    if (!this.isStarted) return;
    
    try {
      console.log('⏹️ Останавливаем Telegram бота...');
      
      if (this.bot.isPolling()) {
        await this.bot.stopPolling();
        console.log('✅ Polling остановлен');
      }
      
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
    
    // Команда /start
    this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
      const chatId = msg.chat.id;
      const startParam = match?.[1];
      console.log(`📨 Получена команда /start от пользователя ${chatId}`, startParam ? `с параметром: ${startParam}` : '');
      
      try {
        // Удаляем предыдущие сообщения (очистка)
        await this.clearPreviousMessages(chatId);
        
        let existingUser = await this.database.getUserByTelegramId(chatId);
        
        let referralSource = existingUser?.referral_source || null;
        let referralLinkId = existingUser?.referral_link_id || null;
        
        // Обрабатываем реферальный параметр
        if (startParam && startParam.startsWith('ref_') && (!existingUser || !existingUser.referral_source)) {
          console.log(`🔗 Обнаружен реферальный код: ${startParam}`);
          
          await this.database.supabase.rpc('log_referral_action', {
            p_referral_code: startParam,
            p_telegram_id: chatId,
            p_action_type: 'click'
          });
          
          const { data: referralLink, error } = await this.database.supabase
            .from('referral_links')
            .select('*')
            .eq('code', startParam)
            .eq('is_active', true)
            .single();
          
          if (!error && referralLink) {
            referralSource = `Реф. ${referralLink.referrer_name}`;
            referralLinkId = referralLink.id;
            console.log(`✅ Найдена активная реферальная ссылка: ${referralLink.referrer_name}`);
            
            if (existingUser) {
              await this.database.supabase
                .from('users')
                .update({
                  referral_source: referralSource,
                  referral_link_id: referralLinkId
                })
                .eq('telegram_id', chatId);
            }
          }
        }
        
        // Создаем или обновляем пользователя
        let user;
        if (existingUser) {
          await this.database.supabase
            .from('users')
            .update({
              username: msg.from.username,
              first_name: msg.from.first_name,
              last_name: msg.from.last_name
            })
            .eq('telegram_id', chatId);
          
          user = await this.database.getUserByTelegramId(chatId);
          console.log(`🔄 Обновлена информация существующего пользователя ${chatId}`);
        } else {
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
        
        // Логируем реферальную регистрацию
        if (referralSource && referralLinkId && startParam && startParam.startsWith('ref_')) {
          await this.database.supabase.rpc('log_referral_action', {
            p_referral_code: startParam,
            p_telegram_id: chatId,
            p_action_type: 'register'
          });
        }

        // Формируем сообщение в зависимости от статуса пользователя
        if (user.status === 'active') {
          await this.sendActiveUserWelcome(chatId, user);
        } else {
          await this.sendInactiveUserWelcome(chatId, user);
        }
        
        console.log(`✅ Приветственное сообщение отправлено пользователю ${chatId}`);
      } catch (error) {
        console.error('❌ Ошибка в команде /start:', error);
        await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
      }
    });

    // Команда /profile
    this.bot.onText(/\/profile/, async (msg) => {
      console.log(`📨 Получена команда /profile от пользователя ${msg.chat.id}`);
      await this.clearPreviousMessages(msg.chat.id);
      await this.handleProfile(msg.chat.id);
    });

    // Обработка текстовых сообщений (для ввода email)
    this.bot.on('message', async (msg) => {
      const chatId = msg.chat.id;
      
      // Пропускаем команды
      if (msg.text && msg.text.startsWith('/')) {
        return;
      }
      
      // Проверяем, ожидаем ли мы email от этого пользователя
      if (this.awaitingEmail.has(chatId)) {
        await this.handleEmailInput(chatId, msg.text);
      }
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
          case 'pay_access':
            await this.clearPreviousMessages(chatId);
            await this.handlePayAccess(chatId);
            break;
          case 'about_channel':
            await this.clearPreviousMessages(chatId);
            await this.handleAboutChannel(chatId);
            break;
          case 'pay_card_rf':
            await this.handlePayCardRF(chatId);
            break;
          case 'pay_crypto':
            await this.handlePayCrypto(chatId);
            break;
          case 'go_to_channel':
            await this.handleGoToChannel(chatId);
            break;
          case 'change_email':
            await this.handleChangeEmail(chatId);
            break;
          case 'cancel_subscription':
            await this.handleCancelSubscription(chatId);
            break;
          case 'profile':
            await this.clearPreviousMessages(chatId);
            await this.handleProfile(chatId);
            break;
          case 'back_to_start':
            await this.clearPreviousMessages(chatId);
            await this.handleBackToStart(chatId);
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

  setupChannelManagement() {
    if (!this.PRIVATE_CHANNEL_ID) {
      console.log('⚠️ Управление каналом отключено - нет настроек канала');
      return;
    }
    
    console.log('🔒 Настраиваем управление закрытым каналом...');

    // Обработка запросов на вступление в канал
    this.bot.on('chat_join_request', async (chatJoinRequest) => {
      const userId = chatJoinRequest.from.id;
      const chatId = chatJoinRequest.chat.id;
      const username = chatJoinRequest.from.username;
      const firstName = chatJoinRequest.from.first_name;
      const lastName = chatJoinRequest.from.last_name;
      
      console.log(`🔑 Запрос на вступление в канал от пользователя ${userId} (@${username}) в чат ${chatId}`);
      
      if (chatId.toString() !== this.PRIVATE_CHANNEL_ID.toString()) {
        console.log(`⚠️ Запрос не для нашего канала: получен ${chatId}, ожидается ${this.PRIVATE_CHANNEL_ID}`);
        return;
      }

      try {
        await this.database.createChannelRequest(userId, username, firstName, lastName);
        console.log(`📝 Запрос на вступление сохранен в базу данных для пользователя ${userId}`);
        
        const user = await this.database.getUserByTelegramId(userId);
        
        if (!user) {
          console.log(`❌ Пользователь ${userId} не найден в базе данных`);
          
          try {
            await this.bot.declineChatJoinRequest(chatId, userId);
            console.log(`✅ Запрос от ${userId} отклонен`);
            
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'declined', 'auto_system');
            }
          } catch (declineError) {
            console.error(`❌ Ошибка при отклонении запроса от ${userId}:`, declineError);
          }
          
          try {
            const botInfo = await this.bot.getMe();
            await this.bot.sendMessage(userId, `
❌ *Доступ к каналу запрещен*

Вы не зарегистрированы в нашем боте. Для получения доступа к закрытому каналу:

1️⃣ Запустите бота: /start
2️⃣ Оформите подписку
3️⃣ После активации подписки получите доступ к каналу

🤖 Начать работу с ботом: @FirstPunchBot
            `, { parse_mode: 'Markdown' });
            console.log(`📤 Отправлено уведомление пользователю ${userId} о необходимости регистрации`);
          } catch (dmError) {
            console.log(`⚠️ Не удалось отправить DM пользователю ${userId}:`, dmError.message);
          }
          return;
        }

        console.log(`👤 Пользователь ${userId} найден, статус: ${user.status}`);

        if (user.status === 'active') {
          console.log(`✅ Пользователь ${userId} имеет активную подписку, одобряем запрос`);
          
          try {
            await this.bot.approveChatJoinRequest(chatId, userId);
            console.log(`✅ Запрос от ${userId} одобрен`);
            
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'approved', 'auto_system');
            }
            
            await this.database.logSubscriptionAction(
              user.id,
              'channel_access_granted',
              `Пользователь получил доступ к закрытому каналу`
            );

            try {
              await this.bot.sendMessage(userId, `
🎉 *Добро пожаловать в закрытый клуб Первый Панч!*

✅ Ваш запрос на вступление одобрен
🔒 Теперь у вас есть доступ к эксклюзивному контенту
💎 Наслаждайтесь премиум-материалами!

⚠️ *Помните:* доступ к каналу действует только при активной подписке
              `, { parse_mode: 'Markdown' });
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
            
            const request = await this.database.getChannelRequestByUserId(userId);
            if (request) {
              await this.database.updateChannelRequestStatus(request.id, 'declined', 'auto_system');
            }
            
            await this.database.logSubscriptionAction(
              user.id,
              'channel_access_denied',
              `Доступ к каналу отклонен: неактивная подписка (статус: ${user.status})`
            );

            try {
              await this.bot.sendMessage(userId, `
❌ *Доступ к каналу запрещен*

Для получения доступа к закрытому каналу необходима активная подписка.

Ваш текущий статус: *${user.status === 'inactive' ? 'Неактивен' : user.status}*

💳 Оформить подписку: /start
📊 Проверить статус: /profile

После активации подписки вы сможете повторно запросить доступ к каналу.
              `, { parse_mode: 'Markdown' });
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
        
        try {
          await this.bot.declineChatJoinRequest(chatId, userId);
          console.log(`✅ Запрос от ${userId} отклонен из-за ошибки`);
        } catch (declineError) {
          console.error(`❌ Ошибка при отклонении запроса:`, declineError);
        }
      }
    });

    console.log('✅ Управление каналом настроено');
  }

  // Утилита для очистки предыдущих сообщений
  async clearPreviousMessages(chatId) {
    try {
      // Удаляем последнее сообщение бота если оно есть
      const lastMessageId = this.lastBotMessages.get(chatId);
      if (lastMessageId) {
        try {
          await this.bot.deleteMessage(chatId, lastMessageId);
          console.log(`🗑️ Удалено предыдущее сообщение ${lastMessageId} для пользователя ${chatId}`);
        } catch (error) {
          console.log(`⚠️ Не удалось удалить сообщение ${lastMessageId}:`, error.message);
        }
        this.lastBotMessages.delete(chatId);
      }
    } catch (error) {
      console.log(`⚠️ Не удалось очистить сообщения для ${chatId}:`, error.message);
    }
  }

  // Отправка сообщения с сохранением ID для последующего удаления
  async sendMessageWithTracking(chatId, text, options = {}) {
    try {
      const sentMessage = await this.bot.sendMessage(chatId, text, options);
      this.lastBotMessages.set(chatId, sentMessage.message_id);
      return sentMessage;
    } catch (error) {
      console.error(`❌ Ошибка отправки сообщения пользователю ${chatId}:`, error);
      throw error;
    }
  }
  // Приветствие для активного пользователя
  async sendActiveUserWelcome(chatId, user) {
    let timeLeft = '';
    
    if (user.subscription_end) {
      const endDate = new Date(user.subscription_end);
      const now = new Date();
      const timeDiff = endDate - now;
      
      if (timeDiff > 0) {
        const days = Math.floor(timeDiff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((timeDiff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((timeDiff % (1000 * 60 * 60)) / (1000 * 60));
        
        if (days > 0) {
          timeLeft = `⏰ *Подписка истекает через:* ${days}д ${hours}ч ${minutes}м`;
        } else if (hours > 0) {
          timeLeft = `⏰ *Подписка истекает через:* ${hours}ч ${minutes}м`;
        } else {
          timeLeft = `⏰ *Подписка истекает через:* ${minutes}м`;
        }
      } else {
        timeLeft = '⚠️ *Подписка истекла*';
      }
    } else {
      timeLeft = '♾️ *Подписка:* Бессрочная';
    }

    const welcomeMessage = `🔥 *Добро пожаловать в Первый Панч!*

✅ *Статус:* Активен
${timeLeft}

🎯 Ты уже в игре! Время прокачивать свой юмор и зарабатывать на шутках.

💎 *Что тебя ждет:*
• Ежедневные уроки от профи
• Конкурсы с призами до 100 000₽
• Эксклюзивные материалы
• Комьюнити единомышленников

🚀 *Готов к новым победам?*`;

    const keyboard = [
      [{ text: '🔒 Перейти в канал', callback_data: 'go_to_channel' }],
      [{ text: '👤 Мой профиль', callback_data: 'profile' }],
      [{ text: '❓ FAQ', url: 'https://thereservationsystem.com/faq' }],
      [{ text: '🆘 Мне нужна помощь', url: 'https://t.me/johnyestet' }]
    ];

    await this.sendMessageWithTracking(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  // Приветствие для неактивного пользователя
  async sendInactiveUserWelcome(chatId, user) {
    const welcomeMessage = `🎭 Этот бот поможет тебе попасть в закрытый клуб «**Первый Панч**» — место, где ты сможешь стать на голову выше окружающих, за счет нового навыка - своего чувства юмора 

Мы объединяем тех, кто хочет:

💥 **Реально научиться шутить!** Не просто слушать теорию, а получать ежедневную практику, которая научит мозг выдавать шутки на автомате 
💥 **Влюблять в себя людей** не внешностью или деньгами, а за счет  вайба: «С ним(ей) реально классно!» 
💥 **Попасть в окружение** тех, с кем никогда не бывает скучно и самому стать таким же 
💥 **иметь возможность** по щелчку, за одну шутку заработать от __100 000 рублей__ 

👇 **Всё необходимое ниже** 👇`;

    const keyboard = [
      [{ text: '💳 Оплатить доступ', callback_data: 'pay_access' }],
      [{ text: '📖 Подробнее о канале', callback_data: 'about_channel' }],
      [{ text: '👤 Мой профиль', callback_data: 'profile' }],
      [{ text: '❓ FAQ', url: 'https://thereservationsystem.com/faq' }],
      [{ text: '🆘 Мне нужна помощь', url: 'https://t.me/johnyestet' }]
    ];

    await this.sendMessageWithTracking(chatId, welcomeMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: keyboard
      }
    });
  }

  // Обработчики команд и callback'ов

  async handleProfile(chatId) {
    try {
      await this.clearPreviousMessages(chatId);
      console.log(`📊 Показ профиля для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (!user) {
        await this.sendMessageWithTracking(chatId, '❌ Пользователь не найден. Используйте /start для регистрации.');
        return;
      }

      let profileMessage = `👤 *Ваш профиль*\n\n`;
      
      // Email
      profileMessage += `📧 *Email:* ${user.email || 'Не указан'}\n\n`;
      
      // Статус подписки
      if (user.status === 'active') {
        if (user.subscription_end) {
          const endDate = new Date(user.subscription_end);
          const moscowTime = new Date(endDate.getTime() + 3 * 60 * 60 * 1000);
          const now = new Date();
          const timeLeft = endDate - now;
          
          if (timeLeft > 0) {
            const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            profileMessage += `✅ *Статус:* Активна\n`;
            profileMessage += `📅 *Действует до:* ${moscowTime.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n`;
            
            if (days > 0) {
              profileMessage += `⏰ *Осталось:* ${days}д ${hours}ч ${minutes}м\n\n`;
            } else if (hours > 0) {
              profileMessage += `⏰ *Осталось:* ${hours}ч ${minutes}м\n\n`;
            } else {
              profileMessage += `⏰ *Осталось:* ${minutes}м\n\n`;
            }
          } else {
            profileMessage += `❌ *Статус:* Истекла\n\n`;
          }
        } else {
          profileMessage += `✅ *Статус:* Активна (бессрочно)\n\n`;
        }
      } else {
        profileMessage += `❌ *Статус:* Неактивна\n\n`;
      }
      
      // Автоплатеж
      profileMessage += `🔄 *Автоплатеж:* ${user.auto_payment_enabled ? '✅ Включен' : '❌ Отключен'}\n\n`;
      
      // Реферальная информация
      if (user.referral_source) {
        profileMessage += `🔗 *Источник:* ${user.referral_source}\n\n`;
      }

      const keyboard = [];
      
      if (user.status === 'active' && this.PRIVATE_CHANNEL_LINK) {
        keyboard.push([{ text: '🔒 Перейти в канал', callback_data: 'go_to_channel' }]);
      }
      
      keyboard.push([{ text: '📧 Изменить почту', callback_data: 'change_email' }]);
      
      if (user.auto_payment_enabled) {
        keyboard.push([{ text: '❌ Отменить подписку', callback_data: 'cancel_subscription' }]);
      }

      // Добавляем кнопку "Назад"
      keyboard.push([{ text: '🔙 Назад', callback_data: 'back_to_start' }]);

      await this.sendMessageWithTracking(chatId, profileMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } catch (error) {
      console.error('❌ Ошибка при показе профиля:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка при получении профиля.');
    }
  }

  async handleAboutChannel(chatId) {
    await this.clearPreviousMessages(chatId);
    const aboutMessage = `Ты всё ещё думаешь, что чувство юмора — это дар?
Что кто-то просто «родился таким», а тебе остается отмалчиваться и быть в сторонке?

**Нет.**

Юмор — это не генетика.
Это навык, который надо прокачивать каждый день 
«**Первый Панч**» — первый в России тренажёр чувства юмора.

Мы сделаем тебя тем, кто:

✅ Шутит сразу, а не додумывает через час, как надо было пошутить
✅ Классно и весело проводит время на свиданиях
✅ Умеет разрядить любую обстановку
✅ Становится душой любой компании и вливается в нее за пару минут

**Внутри:**
🎯 **НИКАКОЙ СКУЧНОЙ ТЕОРИИ, ТОЛЬКО ПРАКТИКА**
🥊 Разборы шуток в прямом эфире
🧠 Юмористические тренажёры: выучишь самые работающие приемы юмора, мозг начнет работать намного быстрее и креативнее
💬 Клуб, где не будет скучно. Тут свои: все легкие, позитивные, на одной волне

**А теперь про деньги. И не только про твои**
Каждый день у нас конкурс: в конце дня голосование - лучшая шутка дня получает __1000р__ 
А в конце месяца — финальный турнир среди 30 лучших шуток. Приз: от __100 000 ₽__. За одну шутку. 
Это будут самые легкие деньги в твоей жизни.

А знаешь сколько стоит месяц в клубе? **1000 р.** Нет, это не первый взнос рассрочки. Это вся стоимость

Ты можешь отбить месячную стоимость клуба в первый же день, всего лишь одной шуткой

Но главное — все вокруг думают, что шутить это дар. Пусть думают. Тебе это только на руку. Это же очень приятно быть лучше остальных, но никому не говорить как это получилось😈

**Добро пожаловать!**`;

    await this.sendMessageWithTracking(chatId, aboutMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Оплатить доступ', callback_data: 'pay_access' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
        ]
      }
    });
  }

  async handlePayAccess(chatId) {
    await this.clearPreviousMessages(chatId);
    const payMessage = `🚀 *Готов войти в элиту юмора?*

🎯 *Первый Панч ждет тебя!*

💎 *За 1000₽/месяц получаешь:*
✨ Ежедневные уроки от профи
🎤 Прямые эфиры со Стасом Ерником  
🏆 Шанс выиграть 100 000₽ за шутку
💪 Тренажеры для прокачки юмора
👥 Крутое комьюнити

🔥 *Время становиться легендой!*

*Выбери способ оплаты:*`;

    await this.sendMessageWithTracking(chatId, payMessage, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏦 Банковской картой/СБП', callback_data: 'pay_card_rf' }],
          [{ text: '₿ Оплатить криптой', callback_data: 'pay_crypto' }],
          [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
        ]
      }
    });
  }

  async handlePayCardRF(chatId) {
    try {
      await this.clearPreviousMessages(chatId);
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user && user.email) {
        // У пользователя уже есть email, создаем платеж сразу
        await this.createYookassaPayment(chatId, user.email);
      } else {
        // Запрашиваем email
        this.awaitingEmail.set(chatId, 'payment');
        
        await this.sendMessageWithTracking(chatId, `📧 *Для оплаты укажите email*

Он нужен для отправки чека об оплате.

*Введите ваш email:*`, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'pay_access' }]
            ]
          }
        });
      }
    } catch (error) {
      console.error('❌ Ошибка при обработке оплаты картой:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  }

  // Проверка и управление участником канала
  async checkAndManageChannelMember(channelId, userId) {
    try {
      console.log(`🔍 Проверяем участника ${userId} в канале ${channelId}`);
      
      const user = await this.database.getUserByTelegramId(userId);
      
      if (!user) {
        console.log(`❌ Пользователь ${userId} не найден в базе данных`);
        return;
      }

      // Проверяем статус пользователя
      const isActive = user.status === 'active';
      let subscriptionValid = true;
      
      if (user.subscription_end) {
        const now = new Date();
        const subscriptionEnd = new Date(user.subscription_end);
        subscriptionValid = now <= subscriptionEnd;
      }

      const shouldHaveAccess = isActive && subscriptionValid;
      
      console.log(`👤 Пользователь ${userId}: статус=${user.status}, подписка_до=${user.subscription_end}, доступ=${shouldHaveAccess}`);

      if (!shouldHaveAccess) {
        try {
          // Проверяем, является ли пользователь участником канала
          const chatMember = await this.bot.getChatMember(channelId, userId);
          
          if (chatMember.status === 'member' || chatMember.status === 'restricted') {
            console.log(`🚫 Кикаем пользователя ${userId} из канала (статус: ${chatMember.status})`);
            
            await this.bot.banChatMember(channelId, userId);
            await this.bot.unbanChatMember(channelId, userId);
            
            console.log(`✅ Пользователь ${userId} кикнут из канала`);
            
            // Логируем действие
            await this.database.logSubscriptionAction(
              user.id,
              'channel_kicked_auto',
              `Пользователь автоматически кикнут из канала: неактивная подписка`
            );

            // Уведомляем пользователя
            try {
              await this.bot.sendMessage(userId, `
🚫 Доступ к каналу отозван

Ваша подписка неактивна или истекла.

Для возобновления доступа:
💳 Оформить подписку: /start
📊 Проверить статус: /profile
              `);
            } catch (dmError) {
              console.log(`⚠️ Не удалось отправить уведомление пользователю ${userId}:`, dmError.message);
            }
          } else {
            console.log(`ℹ️ Пользователь ${userId} не является участником канала (статус: ${chatMember.status})`);
          }
        } catch (memberError) {
          if (memberError.response && memberError.response.body && memberError.response.body.error_code === 400) {
            console.log(`ℹ️ Пользователь ${userId} не найден в канале или уже не участник`);
          } else {
            console.error(`❌ Ошибка при проверке участника ${userId}:`, memberError);
          }
        }
      } else {
        console.log(`✅ Пользователь ${userId} имеет активную подписку, доступ сохранен`);
      }
    } catch (error) {
      console.error(`❌ Ошибка при управлении участником ${userId}:`, error);
    }
  }
  async handlePayCrypto(chatId) {
    try {
      await this.clearPreviousMessages(chatId);
      if (!this.cryptoCloudService) {
        await this.sendMessageWithTracking(chatId, '❌ Криптоплатежи временно недоступны.');
        return;
      }
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      // Определяем сумму платежа для криптоплатежей
      let paymentAmount = 10; // Базовая сумма по умолчанию
      
      // Если у пользователя есть реферальная ссылка, используем её сумму
      if (user && user.referral_link_id) {
        try {
          const { data: referralLink, error } = await this.database.supabase
            .from('referral_links')
            .select('subscription_amount')
            .eq('id', user.referral_link_id)
            .single();
          
          if (!error && referralLink) {
            paymentAmount = referralLink.subscription_amount;
            console.log(`₿ Используем сумму из реферальной ссылки для крипто: ${paymentAmount} руб`);
          }
        } catch (referralError) {
          console.warn('⚠️ Ошибка получения реферальной ссылки для крипто:', referralError);
        }
      }
      
      const invoice = await this.cryptoCloudService.createInvoice(
        paymentAmount,
        'Подписка на Первый Панч',
        `tg_${chatId}_${Date.now()}`,
        'RUB'
      );

      await this.database.createPayment(
        user.id,
        invoice.id,
        paymentAmount,
        'pending'
      );

      await this.sendMessageWithTracking(chatId, `₿ *Оплата криптовалютой*

💰 *Сумма:* ${paymentAmount}₽
🔗 *Платежная система:* CryptoCloud
💎 *Поддерживаемые валюты:* BTC, ETH, USDT, USDC, LTC, BCH, BNB, TRX, DOGE

Нажмите кнопку ниже для перехода к оплате:`, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '₿ Оплатить криптой', url: invoice.pay_url }],
            [{ text: '🔙 Назад', callback_data: 'pay_access' }]
          ]
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка при создании криптоплатежа:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка при создании криптоплатежа. Попробуйте позже.');
    }
  }

  async handleEmailInput(chatId, email) {
    try {
      // Валидация email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        await this.sendMessageWithTracking(chatId, '❌ *Неверный формат email.* Попробуйте еще раз:', { parse_mode: 'Markdown' });
        return;
      }

      // Сохраняем email в базу данных
      await this.database.supabase
        .from('users')
        .update({ email: email })
        .eq('telegram_id', chatId);

      const action = this.awaitingEmail.get(chatId);
      this.awaitingEmail.delete(chatId);

      if (action === 'payment') {
        await this.createYookassaPayment(chatId, email);
      } else if (action === 'change') {
        await this.sendMessageWithTracking(chatId, `✅ *Email успешно обновлен на:* ${email}`, { 
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
            ]
          }
        });
      }

    } catch (error) {
      console.error('❌ Ошибка при обработке email:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка при сохранении email. Попробуйте позже.');
    }
  }

  async createYookassaPayment(chatId, email) {
    try {
      const user = await this.database.getUserByTelegramId(chatId);
      
      // Определяем сумму платежа
      let paymentAmount = 10; // Базовая сумма по умолчанию
      
      // Если у пользователя есть реферальная ссылка, используем её сумму
      if (user && user.referral_link_id) {
        try {
          const { data: referralLink, error } = await this.database.supabase
            .from('referral_links')
            .select('subscription_amount')
            .eq('id', user.referral_link_id)
            .single();
          
          if (!error && referralLink) {
            paymentAmount = referralLink.subscription_amount;
            console.log(`💰 Используем сумму из реферальной ссылки: ${paymentAmount} руб`);
          }
        } catch (referralError) {
          console.warn('⚠️ Ошибка получения реферальной ссылки:', referralError);
        }
      }
      
      console.log(`💳 Создаем платеж на сумму: ${paymentAmount} руб для пользователя ${chatId}`);
      
      // Не указываем конкретный способ оплаты - пользователь выберет на странице ЮКассы
      const payment = await this.yookassaService.createPayment(
        paymentAmount,
        'Подписка на Первый Панч',
        null,
        true,
        email
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        paymentAmount,
        payment.status
      );

      const confirmMessage = `💳 *Оплата подписки*

💰 *Сумма:* ${paymentAmount}₽
📧 *Чек будет отправлен на:* ${email}
🏦 *Платежная система:* ЮКасса
💡 *Способы оплаты:* СБП или банковская карта (выбор на странице оплаты)

При оплате вы автоматически соглашаетесь с публичной офертой.`;

      await this.sendMessageWithTracking(chatId, confirmMessage, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Оплатить', url: payment.confirmation.confirmation_url }],
            [{ text: '📄 Публичная оферта', url: 'https://thereservationsystem.com/' }],
            [{ text: '🔙 Назад', callback_data: 'pay_access' }]
          ]
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка при создании платежа:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка при создании платежа. Попробуйте позже.');
    }
  }

  async handleGoToChannel(chatId) {
    await this.clearPreviousMessages(chatId);
    if (!this.PRIVATE_CHANNEL_LINK) {
      await this.sendMessageWithTracking(chatId, '❌ Ссылка на канал не настроена.');
      return;
    }

    await this.sendMessageWithTracking(chatId, `🔒 *Добро пожаловать в Первый Панч!*

🎯 Переходи по ссылке и начинай прокачивать свой юмор:`, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Перейти в канал', url: this.PRIVATE_CHANNEL_LINK }],
          [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
        ]
      }
    });
  }

  async handleChangeEmail(chatId) {
    await this.clearPreviousMessages(chatId);
    this.awaitingEmail.set(chatId, 'change');
    
    await this.sendMessageWithTracking(chatId, `📧 *Введите новый email:*

Новый email будет использоваться для отправки чеков об оплате.`, { 
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔙 Назад', callback_data: 'profile' }]
        ]
      }
    });
  }

  async handleCancelSubscription(chatId) {
    try {
      await this.clearPreviousMessages(chatId);
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (!user.auto_payment_enabled) {
        await this.sendMessageWithTracking(chatId, '❌ У вас не включен автоплатеж.');
        return;
      }

      await this.database.setAutoPayment(chatId, false);
      await this.database.logSubscriptionAction(
        user.id,
        'auto_payment_cancelled',
        'Пользователь отменил автоплатеж'
      );

      await this.sendMessageWithTracking(chatId, `✅ *Автоплатеж отменен*

Ваша подписка останется активной до окончания оплаченного периода.

⚠️ После окончания подписки доступ к каналу будет отозван.

📊 Проверить статус: /profile`, { 
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔙 Назад', callback_data: 'back_to_start' }]
          ]
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка при отмене автоплатежа:', error);
      await this.sendMessageWithTracking(chatId, '❌ Произошла ошибка при отмене автоплатежа.');
    }
  }

  async handleBackToStart(chatId) {
    // Получаем пользователя и отправляем соответствующее приветствие
    try {
      await this.clearPreviousMessages(chatId);
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user.status === 'active') {
        await this.sendActiveUserWelcome(chatId, user);
      } else {
        await this.sendInactiveUserWelcome(chatId, user);
      }
    } catch (error) {
      console.error('❌ Ошибка при возврате к началу:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте /start');
    }
  }

  // Обработка успешного платежа
  async handlePaymentSuccess(paymentId) {
    try {
      console.log(`💰 Обработка успешного платежа: ${paymentId}`);
      
      const payment = await this.database.getPaymentByPaymentId(paymentId);
      if (!payment) {
        console.error('❌ Платеж не найден в базе данных:', paymentId);
        return;
      }

      await this.database.updatePaymentStatus(paymentId, 'succeeded', new Date().toISOString());
      
      // Активируем пользователя на месяц
      const subscriptionEnd = new Date();
      
      // Рассчитываем период подписки на основе настроек пользователя
      const userSettings = await this.database.getUserByTelegramId(payment.telegram_id);
      if (userSettings && userSettings.auto_payment_interval) {
        // Используем метод из PaymentScheduler для расчета
        if (this.paymentScheduler) {
          const calculatedEnd = this.paymentScheduler.calculateSubscriptionEnd(
            userSettings.auto_payment_interval, 
            userSettings.custom_interval_minutes
          );
          subscriptionEnd.setTime(calculatedEnd.getTime());
        } else {
          // Fallback: добавляем 2 минуты
          subscriptionEnd.setTime(subscriptionEnd.getTime() + 2 * 60 * 1000);
        }
      } else {
        // По умолчанию - 2 минуты
        subscriptionEnd.setTime(subscriptionEnd.getTime() + 2 * 60 * 1000);
      }
      
      await this.database.updateUserStatus(payment.telegram_id, 'active', subscriptionEnd.toISOString());
      await this.database.setAutoPayment(payment.telegram_id, true);

      // Сохраняем payment method для рекуррентных платежей (только для ЮКассы)
      try {
        const yookassaPayment = await this.yookassaService.getPayment(paymentId);
        if (yookassaPayment.payment_method && yookassaPayment.payment_method.id) {
          await this.database.updateUserPaymentMethod(payment.telegram_id, yookassaPayment.payment_method.id);
        }
      } catch (error) {
        console.log(`ℹ️ Не удалось получить payment method (возможно, это криптоплатеж): ${error.message}`);
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
        }
      }

      await this.database.logSubscriptionAction(
        payment.user_id,
        'payment_success',
        `Платеж успешно обработан. Сумма: ${payment.amount} руб`
      );

      const endDateMoscow = new Date(subscriptionEnd.getTime() + 3 * 60 * 60 * 1000);

      await this.bot.sendMessage(
        payment.telegram_id,
        `🎉 *Добро пожаловать в Первый Панч!*

✅ Платеж успешно обработан
💰 Сумма: ${payment.amount}₽
📅 Подписка активна до: ${endDateMoscow.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🔄 Автоплатеж включен

🔥 *Теперь ты в элите юмора!*

🔒 Присоединяйся к закрытому каналу и начинай прокачиваться!`,
        {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: this.PRIVATE_CHANNEL_LINK ? [
              [{ text: '🔒 Перейти в канал', url: this.PRIVATE_CHANNEL_LINK }],
              [{ text: '👤 Мой профиль', callback_data: 'profile' }]
            ] : [
              [{ text: '👤 Мой профиль', callback_data: 'profile' }]
            ]
          }
        }
      );
      
      console.log(`✅ Платеж успешно обработан для пользователя ${payment.telegram_id}`);
    } catch (error) {
      console.error('❌ Ошибка при обработке успешного платежа:', error);
    }
  }

  async handleCryptoPaymentSuccess(invoiceId) {
    try {
      console.log(`₿ Обработка успешного криптоплатежа: ${invoiceId}`);
      await this.handlePaymentSuccess(invoiceId);
    } catch (error) {
      console.error('❌ Ошибка при обработке успешного криптоплатежа:', error);
    }
  }

  // Аудит всех участников канала
  async performChannelAudit() {
    if (!this.PRIVATE_CHANNEL_ID) {
      console.log('⚠️ Аудит канала пропущен - канал не настроен');
      return;
    }

    try {
      console.log('🔍 Начинаем аудит закрытого канала...');
      
      // Получаем всех администраторов канала
      const administrators = await this.bot.getChatAdministrators(this.PRIVATE_CHANNEL_ID);
      const adminIds = administrators.map(admin => admin.user.id);
      
      console.log(`👑 Найдено ${adminIds.length} администраторов канала`);
      
      // Получаем количество участников канала
      const chatMemberCount = await this.bot.getChatMemberCount(this.PRIVATE_CHANNEL_ID);
      console.log(`👥 Всего участников в канале: ${chatMemberCount}`);
      
      // Получаем всех пользователей с активными подписками
      const activeUsers = await this.database.getAllUsers();
      const activeUserIds = activeUsers
        .filter(user => {
          const isActive = user.status === 'active';
          let subscriptionValid = true;
          
          if (user.subscription_end) {
            const now = new Date();
            const subscriptionEnd = new Date(user.subscription_end);
            subscriptionValid = now <= subscriptionEnd;
          }
          
          return isActive && subscriptionValid;
        })
        .map(user => user.telegram_id);
      
      console.log(`✅ Найдено ${activeUserIds.length} пользователей с активными подписками`);
      
      // Проверяем каждого пользователя в базе данных
      const allUsers = await this.database.getAllUsers();
      let checkedCount = 0;
      let kickedCount = 0;
      
      for (const user of allUsers) {
        try {
          // Пропускаем администраторов
          if (adminIds.includes(user.telegram_id)) {
            console.log(`👑 Пропускаем администратора ${user.telegram_id}`);
            continue;
          }
          
          const chatMember = await this.bot.getChatMember(this.PRIVATE_CHANNEL_ID, user.telegram_id);
          
          if (chatMember.status === 'member' || chatMember.status === 'restricted') {
            checkedCount++;
            
            // Проверяем, должен ли пользователь иметь доступ
            const isActive = user.status === 'active';
            let subscriptionValid = true;
            
            if (user.subscription_end) {
              const now = new Date();
              const subscriptionEnd = new Date(user.subscription_end);
              subscriptionValid = now <= subscriptionEnd;
            }
            
            const shouldHaveAccess = isActive && subscriptionValid;
            
            if (!shouldHaveAccess) {
              console.log(`🚫 Кикаем неактивного пользователя ${user.telegram_id} (статус: ${user.status})`);
              
              await this.bot.banChatMember(this.PRIVATE_CHANNEL_ID, user.telegram_id);
              await this.bot.unbanChatMember(this.PRIVATE_CHANNEL_ID, user.telegram_id);
              
              kickedCount++;
              
              // Логируем действие
              await this.database.logSubscriptionAction(
                user.id,
                'channel_audit_kick',
                `Пользователь кикнут при аудите канала: неактивная подписка`
              );
              
              // Небольшая задержка между киками
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        } catch (memberError) {
          if (memberError.response && memberError.response.body && memberError.response.body.error_code === 400) {
            // Пользователь не в канале - это нормально
            continue;
          } else {
            console.error(`❌ Ошибка при проверке пользователя ${user.telegram_id}:`, memberError.message);
          }
        }
      }
      
      console.log(`✅ Аудит канала завершен: проверено ${checkedCount} участников, кикнуто ${kickedCount}`);
      
    } catch (error) {
      console.error('❌ Ошибка при аудите канала:', error);
    }
  }

  // API методы для управления каналом
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

      if (this.PRIVATE_CHANNEL_ID) {
        await this.bot.approveChatJoinRequest(this.PRIVATE_CHANNEL_ID, request.user_id);
      }
      
      await this.database.updateChannelRequestStatus(requestId, 'approved', 'admin_panel');
      
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

      if (this.PRIVATE_CHANNEL_ID) {
        await this.bot.declineChatJoinRequest(this.PRIVATE_CHANNEL_ID, request.user_id);
      }
      
      await this.database.updateChannelRequestStatus(requestId, 'declined', 'admin_panel');
      
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