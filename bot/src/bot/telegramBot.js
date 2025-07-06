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

        const welcomeMessage = `🎯 Этот бот поможет тебе попасть в закрытый клуб Первый Панч.

Мы объединяем людей, которым интересно развивать свой юмор и становиться увереннее. Ниже находится всё необходимое`;

        const keyboard = [
          [{ text: '💳 Оплатить доступ', callback_data: 'pay_access' }],
          [{ text: '📖 Подробнее о канале', callback_data: 'about_channel' }],
          [{ text: '💬 Обратная связь', url: 'https://t.me/johnyestet' }],
          [{ text: '❓ FAQ', url: 'https://teletype.in/@tellmonster/JSyG1E5bs-b' }]
        ];

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

    // Команда /profile
    this.bot.onText(/\/profile/, async (msg) => {
      console.log(`📨 Получена команда /profile от пользователя ${msg.chat.id}`);
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
            await this.handlePayAccess(chatId);
            break;
          case 'about_channel':
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
❌ Доступ к каналу запрещен

Вы не зарегистрированы в нашем боте. Для получения доступа к закрытому каналу:

1. Запустите бота: /start
2. Оформите подписку
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
🎉 Добро пожаловать в закрытый клуб Первый Панч!

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
❌ Доступ к каналу запрещен

Для получения доступа к закрытому каналу необходима активная подписка.

Ваш текущий статус: ${user.status === 'inactive' ? 'Неактивен' : user.status}

💳 Оформить подписку: /start
📊 Проверить статус: /profile

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

  // Обработчики команд и callback'ов

  async handleProfile(chatId) {
    try {
      console.log(`📊 Показ профиля для пользователя ${chatId}`);
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (!user) {
        await this.bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start для регистрации.');
        return;
      }

      let profileMessage = `👤 Ваш профиль\n\n`;
      
      // Email
      profileMessage += `📧 Email: ${user.email || 'Не указан'}\n\n`;
      
      // Статус подписки
      if (user.status === 'active') {
        if (user.subscription_end) {
          const endDate = new Date(user.subscription_end);
          const moscowTime = new Date(endDate.getTime() + 3 * 60 * 60 * 1000); // +3 часа для Москвы
          const now = new Date();
          const timeLeft = endDate - now;
          
          if (timeLeft > 0) {
            const days = Math.floor(timeLeft / (1000 * 60 * 60 * 24));
            const hours = Math.floor((timeLeft % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
            
            profileMessage += `✅ Статус: Активна\n`;
            profileMessage += `📅 Действует до: ${moscowTime.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}\n`;
            profileMessage += `⏰ Осталось: ${days}д ${hours}ч ${minutes}м\n\n`;
          } else {
            profileMessage += `❌ Статус: Истекла\n\n`;
          }
        } else {
          profileMessage += `✅ Статус: Активна (бессрочно)\n\n`;
        }
      } else {
        profileMessage += `❌ Статус: Неактивна\n\n`;
      }
      
      // Автоплатеж
      profileMessage += `🔄 Автоплатеж: ${user.auto_payment_enabled ? 'Включен' : 'Отключен'}\n\n`;
      
      // Реферальная информация
      if (user.referral_source) {
        profileMessage += `🔗 Источник: ${user.referral_source}\n\n`;
      }

      const keyboard = [];
      
      if (user.status === 'active' && this.PRIVATE_CHANNEL_LINK) {
        keyboard.push([{ text: '🔒 Перейти в канал', callback_data: 'go_to_channel' }]);
      }
      
      keyboard.push([{ text: '📧 Изменить почту', callback_data: 'change_email' }]);
      
      if (user.auto_payment_enabled) {
        keyboard.push([{ text: '❌ Отменить подписку', callback_data: 'cancel_subscription' }]);
      }

      await this.bot.sendMessage(chatId, profileMessage, {
        reply_markup: {
          inline_keyboard: keyboard
        }
      });
    } catch (error) {
      console.error('❌ Ошибка при показе профиля:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при получении профиля.');
    }
  }

  async handleAboutChannel(chatId) {
    const aboutMessage = `🎯 Первый Панч - это тренажерный клуб по юмору. 

Если ты хочешь научиться уверенно шутить и легко справляться с неловкими ситуациями - ты по адресу.

Представь, что через пару недель ты легко превращаешь любые неловкие ситуации в шутку. Ты больше не думаешь: «А что сказать, чтобы было смешно?» - теперь ты это знаешь! Потому что начал думать по-новому.

🎯 Что внутри:
– Ежедневные короткие и полезные уроки по юмору, подаче, уверенности в разговоре
– Прямые эфиры со Стасом Ерником
– С первого дня доступ к тренажёрам по юмору, подборкам панчей и вебинарам

И всё это среди людей, которые на одной волне: смеются над твоими шутками и помогают становиться лучше. Здесь нормально учиться, пробовать, ошибаться и становиться смешнее каждый день.

🏆 А также ежедневный конкурс шуток! Лучшая забирает 1000 рублей. Просто за хороший панч. В конце месяца супер приз. Победитель получает 100 000 рублей!

💰 Всё это - всего за 1000 рублей в месяц.

Да, за одну удачную шутку ты можешь отбить доступ прямо в первый день)

Попадая в Первый Панч ты начинаешь понимать механику юмора, становишься увереннее, тебя больше слушают, ты легче заводишь новые знакомства. Это полезно и в работе, и в творчестве, и просто в жизни.

Ссылка на доступ 👇`;

    await this.bot.sendMessage(chatId, aboutMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Оплатить доступ', callback_data: 'pay_access' }]
        ]
      }
    });
  }

  async handlePayAccess(chatId) {
    const payMessage = `🚀 Готов стать частью самого крутого клуба по юмору?

🎯 Первый Панч ждет тебя! Всего за 1000 рублей в месяц ты получишь:

✨ Ежедневные уроки от профи
🎤 Прямые эфиры со Стасом Ерником  
🏆 Шанс выиграть 100 000 рублей за лучшую шутку
💪 Тренажеры для прокачки юмора
👥 Комьюнити единомышленников

Выбери удобный способ оплаты:`;

    await this.bot.sendMessage(chatId, payMessage, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '💳 Оплатить картой РФ', callback_data: 'pay_card_rf' }],
          [{ text: '₿ Оплатить криптой', callback_data: 'pay_crypto' }]
        ]
      }
    });
  }

  async handlePayCardRF(chatId) {
    try {
      const user = await this.database.getUserByTelegramId(chatId);
      
      if (user && user.email) {
        // У пользователя уже есть email, сразу создаем платеж
        await this.createYookassaPayment(chatId, user.email);
      } else {
        // Запрашиваем email
        this.awaitingEmail.set(chatId, 'payment');
        
        await this.bot.sendMessage(chatId, `📧 Для оформления подписки укажите вашу электронную почту.

Она нужна для отправки чека об оплате.

Введите ваш email:`);
      }
    } catch (error) {
      console.error('❌ Ошибка при обработке оплаты картой:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка. Попробуйте позже.');
    }
  }

  async handlePayCrypto(chatId) {
    try {
      if (!this.cryptoCloudService) {
        await this.bot.sendMessage(chatId, '❌ Криптоплатежи временно недоступны.');
        return;
      }
      
      const user = await this.database.getUserByTelegramId(chatId);
      
      const invoice = await this.cryptoCloudService.createInvoice(
        10, // Тестовая сумма 10 рублей
        'Подписка на Первый Панч',
        `tg_${chatId}_${Date.now()}`,
        'RUB'
      );

      await this.database.createPayment(
        user.id,
        invoice.id,
        10,
        'pending'
      );

      await this.bot.sendMessage(chatId, `₿ Оплата криптовалютой

💰 Сумма: 10 ₽
🔗 Платежная система: CryptoCloud
💎 Поддерживаемые валюты: BTC, ETH, USDT, USDC, LTC, BCH, BNB, TRX, DOGE

Нажмите кнопку ниже для перехода к оплате:`, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '₿ Оплатить криптой', url: invoice.pay_url }]
          ]
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка при создании криптоплатежа:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при создании криптоплатежа. Попробуйте позже.');
    }
  }

  async handleEmailInput(chatId, email) {
    try {
      // Валидация email
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        await this.bot.sendMessage(chatId, '❌ Неверный формат email. Попробуйте еще раз:');
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
        await this.bot.sendMessage(chatId, `✅ Email успешно обновлен на: ${email}`);
      }

    } catch (error) {
      console.error('❌ Ошибка при обработке email:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при сохранении email. Попробуйте позже.');
    }
  }

  async createYookassaPayment(chatId, email) {
    try {
      const user = await this.database.getUserByTelegramId(chatId);
      
      const payment = await this.yookassaService.createPayment(
        10, // Тестовая сумма 10 рублей
        'Подписка на Первый Панч',
        null,
        true,
        email // Передаем email для чека
      );

      await this.database.createPayment(
        user.id,
        payment.id,
        10,
        payment.status
      );

      const confirmMessage = `💳 Оплата подписки

💰 Сумма: 10 ₽
📧 Чек будет отправлен на: ${email}
🏦 Платежная система: ЮКасса

При оплате вы автоматически соглашаетесь с публичной офертой.`;

      await this.bot.sendMessage(chatId, confirmMessage, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '💳 Оплатить', url: payment.confirmation.confirmation_url }],
            [{ text: '📄 Публичная оферта', url: 'https://docs.google.com/document/d/1TlGezk89A3CkHjmF2vgkG2TYP-KoCBPNZrgfNVG_gzk/edit?usp=sharing' }]
          ]
        }
      });
      
    } catch (error) {
      console.error('❌ Ошибка при создании ЮКасса платежа:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при создании платежа. Попробуйте позже.');
    }
  }

  async handleGoToChannel(chatId) {
    if (!this.PRIVATE_CHANNEL_LINK) {
      await this.bot.sendMessage(chatId, '❌ Ссылка на канал не настроена.');
      return;
    }

    await this.bot.sendMessage(chatId, `🔒 Добро пожаловать в Первый Панч!

Переходите по ссылке ниже:`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: '🔗 Перейти в канал', url: this.PRIVATE_CHANNEL_LINK }]
        ]
      }
    });
  }

  async handleChangeEmail(chatId) {
    this.awaitingEmail.set(chatId, 'change');
    
    await this.bot.sendMessage(chatId, `📧 Введите новый email:

Новый email будет использоваться для отправки чеков об оплате.`);
  }

  async handleCancelSubscription(chatId) {
    try {
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

      await this.bot.sendMessage(chatId, `✅ Автоплатеж отменен

Ваша подписка останется активной до окончания оплаченного периода.

⚠️ После окончания подписки доступ к каналу будет отозван.

📊 Проверить статус: /profile`);
      
    } catch (error) {
      console.error('❌ Ошибка при отмене автоплатежа:', error);
      await this.bot.sendMessage(chatId, '❌ Произошла ошибка при отмене автоплатежа.');
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
      subscriptionEnd.setMonth(subscriptionEnd.getMonth() + 1);
      
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
        `🎉 Добро пожаловать в Первый Панч!

✅ Платеж успешно обработан
💰 Сумма: ${payment.amount} ₽
📅 Подписка активна до: ${endDateMoscow.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })}
🔄 Автоплатеж включен

🔒 Теперь вы можете присоединиться к закрытому каналу!

Команды:
/profile - Ваш профиль и управление подпиской`,
        {
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