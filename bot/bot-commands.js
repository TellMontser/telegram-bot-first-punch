import TelegramBot from 'node-telegram-bot-api';
import { 
  addOrUpdateUser, 
  addMessage, 
  isSubscriptionActive,
  addPaymentMethod,
  enableAutoPayments,
  disableAutoPayments,
  getUserPaymentMethods,
  getActiveAutoPaymentMethod
} from './lib/supabase.js';
import { createSubscriptionPayment, getAvailablePaymentSystems } from './payments.js';
import { startAutoPayments, stopAutoPayments, getAutoPaymentStatus } from './lib/auto-payments.js';

// Функция для создания главного меню
export function createMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💳 Оформить подписку', callback_data: 'subscribe' },
          { text: '🔄 Автоподписка', callback_data: 'auto_subscribe' }
        ],
        [
          { text: '📋 О канале', callback_data: 'about_channel' },
          { text: '💰 Мой статус', callback_data: 'my_status' }
        ],
        [
          { text: '⚙️ Управление автоплатежами', callback_data: 'manage_auto_payments' }
        ]
      ]
    }
  };
}

// Функция для создания меню выбора платежной системы
export function createPaymentSystemMenu(isRecurring = false) {
  const systems = getAvailablePaymentSystems();
  const keyboard = [];
  
  systems.forEach(system => {
    // Для рекуррентных платежей показываем только поддерживающие системы
    if (isRecurring && !system.supportsRecurring) {
      return;
    }
    
    const callbackData = isRecurring 
      ? `auto_pay_${system.id}` 
      : `pay_${system.id}`;
    
    keyboard.push([{
      text: `${system.icon} ${system.name} (от ${system.minAmount}${system.currency})`,
      callback_data: callbackData
    }]);
  });
  
  keyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
  
  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Функция для создания меню управления автоплатежами
export function createAutoPaymentManagementMenu(hasActiveAutoPayment = false) {
  const keyboard = [];
  
  if (hasActiveAutoPayment) {
    keyboard.push([
      { text: '🛑 Отключить автоплатежи', callback_data: 'disable_auto_payments' }
    ]);
    keyboard.push([
      { text: '📊 Статус автоплатежей', callback_data: 'auto_payment_status' }
    ]);
  } else {
    keyboard.push([
      { text: '🔄 Настроить автоплатежи', callback_data: 'auto_subscribe' }
    ]);
  }
  
  keyboard.push([{ text: '🔙 Назад', callback_data: 'main_menu' }]);
  
  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Обработка команды /start
export async function handleStartCommand(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const user = msg.from;
    
    console.log(`🎯 Команда /start от пользователя: ${user.id}`);
    
    // Добавляем или обновляем пользователя в базе данных
    await addOrUpdateUser(user);
    
    // Добавляем сообщение в базу данных
    await addMessage(user.id, '/start', false, 'command');
    
    const welcomeText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*
🔄 *Доступна автоподписка с автоматическим продлением*

👇 *Выберите действие* 👇`;

    await bot.sendMessage(chatId, welcomeText, {
      parse_mode: 'Markdown',
      ...createMainMenu()
    });
    
    // Добавляем ответ бота в базу данных
    await addMessage(user.id, welcomeText, true, 'text');
    
  } catch (error) {
    console.error('❌ Ошибка обработки команды /start:', error);
    await bot.sendMessage(msg.chat.id, '❌ Произошла ошибка. Попробуйте позже.');
  }
}

// Обработка callback запросов
export async function handleCallbackQuery(bot, callbackQuery) {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const user = callbackQuery.from;
    const data = callbackQuery.data;
    
    console.log(`🎯 Callback от пользователя ${user.id}: ${data}`);
    
    // Обновляем пользователя в базе данных
    await addOrUpdateUser(user);
    
    // Добавляем действие в базу данных
    await addMessage(user.id, `Нажата кнопка: ${data}`, false, 'button');
    
    let responseText = '';
    let replyMarkup = null;
    
    switch (data) {
      case 'main_menu':
        responseText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;
        replyMarkup = createMainMenu();
        break;
        
      case 'about_channel':
        responseText = `📋 *Подробнее о канале*

*Первый Панч* - это тренажерный клуб по юмору. Если ты хочешь научиться уверенно шутить и легко справляться с неловкими ситуациями - ты по адресу.

🎯 *Представь, что через пару недель ты:*
• Легко превращаешь любые неловкие ситуации в шутку
• Больше не думаешь: «А что сказать, чтобы было смешно?»
• Начал думать по-новому!

📚 *Что внутри:*
• Ежедневные короткие и полезные уроки по юмору, подаче, уверенности в разговоре
• Прямые эфиры со Стасом Ерником
• С первого дня доступ к тренажёрам по юмору, подборкам панчей и вебинарам

👥 И всё это среди людей, которые на одной волне: смеются над твоими шутками и помогают становиться лучше. Здесь нормально учиться, пробовать, ошибаться и становиться смешнее каждый день.

🏆 *А также ежедневный конкурс шуток!* Лучшая забирает 1000 рублей. Просто за хороший панч. В конце месяца супер приз. Победитель получает 100 000 рублей!

💰 *Всё это - всего за 10 рублей в месяц.*

🚀 *Попадая в Первый Панч ты:*
• Начинаешь понимать механику юмора
• Становишься увереннее
• Тебя больше слушают
• Легче заводишь новые знакомства

Это полезно и в работе, и в творчестве, и просто в жизни.

👇 *Ссылка на доступ ниже*`;
        replyMarkup = {
          reply_markup: {
            inline_keyboard: [
              [{ text: '💳 Оформить подписку', callback_data: 'subscribe' }],
              [{ text: '🔙 Назад', callback_data: 'main_menu' }]
            ]
          }
        };
        break;
        
      case 'my_status':
        const isActive = await isSubscriptionActive(user.id);
        const autoPaymentStatus = getAutoPaymentStatus(user.id);
        
        responseText = `💰 *Ваш статус подписки*

📊 Статус: ${isActive ? '✅ Активна' : '❌ Неактивна'}
🔄 Автоплатежи: ${autoPaymentStatus.active ? '✅ Включены' : '❌ Отключены'}

${isActive ? 
  '🎉 У вас есть доступ к каналу!' : 
  '💡 Оформите подписку для получения доступа к каналу.'
}

${autoPaymentStatus.active ? 
  `💳 Автоплатежи настроены\n📅 Следующее списание: каждые 5 минут (тест)\n💰 Сумма: ${autoPaymentStatus.amount || 10}₽` : 
  '🔄 Настройте автоплатежи для автоматического продления подписки.'
}`;
        
        replyMarkup = {
          reply_markup: {
            inline_keyboard: [
              [
                { text: '💳 Оформить подписку', callback_data: 'subscribe' },
                { text: '🔄 Автоподписка', callback_data: 'auto_subscribe' }
              ],
              [{ text: '⚙️ Управление автоплатежами', callback_data: 'manage_auto_payments' }],
              [{ text: '🔙 Назад', callback_data: 'main_menu' }]
            ]
          }
        };
        break;
        
      case 'subscribe':
        responseText = `💳 *Оформление подписки*

Выберите удобный способ оплаты:

💳 *ЮKassa* - банковские карты, электронные кошельки
₿ *CryptoCloud* - криптовалюты (Bitcoin, Ethereum, USDT и др.)

💰 Стоимость: 10₽ на 30 дней`;
        replyMarkup = createPaymentSystemMenu(false);
        break;
        
      case 'auto_subscribe':
        responseText = `🔄 *Настройка автоподписки*

Автоподписка автоматически продлевает вашу подписку каждый месяц.

⚡ *Преимущества:*
• Никогда не забудете продлить подписку
• Непрерывный доступ к каналу
• Автоматическое списание с сохраненной карты

💰 Стоимость: 10₽ каждые 5 минут (для тестирования)
🔒 Можно отключить в любой момент

Выберите способ оплаты для настройки автоподписки:`;
        replyMarkup = createPaymentSystemMenu(true);
        break;
        
      case 'manage_auto_payments':
        const activeAutoPayment = getActiveAutoPaymentMethod(user.id);
        const hasActiveAutoPayment = getAutoPaymentStatus(user.id).active;
        
        responseText = `⚙️ *Управление автоплатежами*

${hasActiveAutoPayment ? 
  `✅ Автоплатежи активны
💳 Сумма: 10₽ каждые 5 минут
🔄 Статус: Работают

Вы можете отключить автоплатежи в любой момент.` :
  `❌ Автоплатежи не настроены

Настройте автоплатежи для автоматического продления подписки.`
}`;
        
        replyMarkup = createAutoPaymentManagementMenu(hasActiveAutoPayment);
        break;
        
      case 'disable_auto_payments':
        try {
          const success = await stopAutoPayments(user.id, true);
          await disableAutoPayments(user.id);
          
          responseText = success ? 
            `✅ *Автоплатежи отключены*

Ваши автоплатежи успешно отключены. Способ оплаты удален из системы.

💡 Вы можете настроить автоплатежи заново в любой момент.` :
            `⚠️ *Автоплатежи уже отключены*

У вас нет активных автоплатежей.`;
            
          replyMarkup = {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Настроить заново', callback_data: 'auto_subscribe' }],
                [{ text: '🔙 Назад', callback_data: 'main_menu' }]
              ]
            }
          };
        } catch (error) {
          console.error('❌ Ошибка отключения автоплатежей:', error);
          responseText = `❌ *Ошибка отключения автоплатежей*

Произошла ошибка при отключении автоплатежей. Попробуйте позже или обратитесь в поддержку.`;
          replyMarkup = createAutoPaymentManagementMenu(true);
        }
        break;
        
      case 'auto_payment_status':
        const status = getAutoPaymentStatus(user.id);
        
        responseText = `📊 *Статус автоплатежей*

${status.active ? 
  `✅ Автоплатежи активны
💰 Сумма: ${status.amount || 10}₽
⏰ Интервал: каждые 5 минут (тест)
📅 Запущены: ${status.startedAt ? new Date(status.startedAt).toLocaleString('ru-RU') : 'Неизвестно'}
🔄 Последний платеж: ${status.lastPayment ? new Date(status.lastPayment).toLocaleString('ru-RU') : 'Еще не было'}` :
  `❌ Автоплатежи не активны

Настройте автоплатежи для автоматического продления подписки.`
}`;
        
        replyMarkup = createAutoPaymentManagementMenu(status.active);
        break;
        
      // Обработка выбора платежной системы для обычной подписки
      case 'pay_yukassa':
      case 'pay_cryptocloud':
        const paymentSystem = data.replace('pay_', '');
        try {
          const payment = await createSubscriptionPayment(user.id, user, paymentSystem, false);
          
          responseText = `💳 *Платеж создан*

💰 Сумма: ${payment.amount}₽
🏦 Система: ${paymentSystem === 'yukassa' ? 'ЮKassa' : 'CryptoCloud'}
🆔 ID платежа: \`${payment.paymentId}\`

👇 *Нажмите кнопку для оплаты* 👇`;
          
          replyMarkup = {
            reply_markup: {
              inline_keyboard: [
                [{ text: '💳 Оплатить', url: payment.confirmationUrl }],
                [{ text: '🔙 Назад', callback_data: 'subscribe' }]
              ]
            }
          };
        } catch (error) {
          console.error('❌ Ошибка создания платежа:', error);
          responseText = `❌ *Ошибка создания платежа*

${error.message}

Попробуйте еще раз или выберите другой способ оплаты.`;
          replyMarkup = createPaymentSystemMenu(false);
        }
        break;
        
      // Обработка выбора платежной системы для автоподписки
      case 'auto_pay_yukassa':
        try {
          const autoPayment = await createSubscriptionPayment(user.id, user, 'yukassa', true);
          
          responseText = `🔄 *Настройка автоподписки*

💰 Сумма: ${autoPayment.amount}₽
🏦 Система: ЮKassa
🆔 ID платежа: \`${autoPayment.paymentId}\`

⚠️ *Важно:* После оплаты ваша карта будет сохранена для автоматических платежей каждые 5 минут (тест).

👇 *Нажмите кнопку для оплаты и настройки автоподписки* 👇`;
          
          replyMarkup = {
            reply_markup: {
              inline_keyboard: [
                [{ text: '🔄 Настроить автоподписку', url: autoPayment.confirmationUrl }],
                [{ text: '🔙 Назад', callback_data: 'auto_subscribe' }]
              ]
            }
          };
        } catch (error) {
          console.error('❌ Ошибка создания автоплатежа:', error);
          responseText = `❌ *Ошибка настройки автоподписки*

${error.message}

Попробуйте еще раз.`;
          replyMarkup = createPaymentSystemMenu(true);
        }
        break;
        
      default:
        responseText = 'Неизвестная команда';
        replyMarkup = createMainMenu();
    }
    
    // Отправляем ответ
    await bot.editMessageText(responseText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...replyMarkup
    });
    
    // Добавляем ответ бота в базу данных
    await addMessage(user.id, responseText, true, 'text');
    
    // Подтверждаем callback
    await bot.answerCallbackQuery(callbackQuery.id);
    
  } catch (error) {
    console.error('❌ Ошибка обработки callback:', error);
    await bot.answerCallbackQuery(callbackQuery.id, {
      text: '❌ Произошла ошибка. Попробуйте позже.',
      show_alert: true
    });
  }
}