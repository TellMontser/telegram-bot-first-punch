import TelegramBot from 'node-telegram-bot-api';
import { 
  addOrUpdateUser, 
  addMessage, 
  isSubscriptionActive,
  getUserPaymentMethods,
  updatePaymentMethodStatus
} from './lib/supabase.js';
import { createAutoPayment, cancelAutoPayments } from './auto-payments.js';
import { createSubscriptionPayment } from './payments.js';

// Функция для создания главного меню
export function createMainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💳 Подписаться', callback_data: 'subscribe' },
          { text: '📋 О канале', callback_data: 'about_channel' }
        ],
        [
          { text: '⚙️ Мои автоплатежи', callback_data: 'auto_payments' },
          { text: '📊 Мой статус', callback_data: 'my_status' }
        ],
        [
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}

// Функция для создания меню подписки
export function createSubscriptionMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💳 Разовый платеж (10₽)', callback_data: 'pay_once' }
        ],
        [
          { text: '🔄 Автоплатеж (10₽/мес)', callback_data: 'pay_auto' }
        ],
        [
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  };
}

// Функция для создания меню автоплатежей
export function createAutoPaymentsMenu(hasAutoPayments = false) {
  const keyboard = [];
  
  if (hasAutoPayments) {
    keyboard.push([
      { text: '❌ Отменить автоплатежи', callback_data: 'cancel_auto_payments' }
    ]);
    keyboard.push([
      { text: '📋 Информация об автоплатежах', callback_data: 'auto_payments_info' }
    ]);
  } else {
    keyboard.push([
      { text: '🔄 Подключить автоплатежи', callback_data: 'pay_auto' }
    ]);
  }
  
  keyboard.push([
    { text: '🏠 Главное меню', callback_data: 'main_menu' }
  ]);

  return {
    reply_markup: {
      inline_keyboard: keyboard
    }
  };
}

// Обработчик команды /start
export async function handleStartCommand(bot, msg) {
  try {
    const chatId = msg.chat.id;
    const user = msg.from;

    console.log(`🚀 Команда /start от пользователя: ${user.id} (@${user.username})`);

    // Добавляем/обновляем пользователя в базе данных
    await addOrUpdateUser(user);
    await addMessage(user.id, '/start', false, 'command');

    const welcomeText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

🔄 *Новинка: Автоплатежи!*
Подключите автоматическое продление подписки и забудьте о необходимости каждый месяц оплачивать вручную.

👇 *Выберите действие* 👇`;

    await bot.sendMessage(chatId, welcomeText, {
      parse_mode: 'Markdown',
      ...createMainMenu()
    });

    await addMessage(user.id, welcomeText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка в handleStartCommand:', error);
    await bot.sendMessage(msg.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

// Обработчик callback запросов
export async function handleCallbackQuery(bot, callbackQuery) {
  try {
    const chatId = callbackQuery.message.chat.id;
    const messageId = callbackQuery.message.message_id;
    const user = callbackQuery.from;
    const data = callbackQuery.data;

    console.log(`🔘 Callback от пользователя ${user.id}: ${data}`);

    // Добавляем/обновляем пользователя
    await addOrUpdateUser(user);
    await addMessage(user.id, `Нажата кнопка: ${data}`, false, 'button');

    // Подтверждаем callback
    await bot.answerCallbackQuery(callbackQuery.id);

    switch (data) {
      case 'main_menu':
        await handleMainMenu(bot, chatId, messageId, user);
        break;
      
      case 'subscribe':
        await handleSubscribeMenu(bot, chatId, messageId, user);
        break;
      
      case 'pay_once':
        await handlePayOnce(bot, chatId, user);
        break;
      
      case 'pay_auto':
        await handlePayAuto(bot, chatId, user);
        break;
      
      case 'auto_payments':
        await handleAutoPaymentsMenu(bot, chatId, messageId, user);
        break;
      
      case 'cancel_auto_payments':
        await handleCancelAutoPayments(bot, chatId, user);
        break;
      
      case 'auto_payments_info':
        await handleAutoPaymentsInfo(bot, chatId, user);
        break;
      
      case 'about_channel':
        await handleAboutChannel(bot, chatId, messageId, user);
        break;
      
      case 'my_status':
        await handleMyStatus(bot, chatId, user);
        break;
      
      default:
        console.log(`⚠️ Неизвестный callback: ${data}`);
    }
  } catch (error) {
    console.error('❌ Ошибка в handleCallbackQuery:', error);
    await bot.sendMessage(callbackQuery.message.chat.id, 'Произошла ошибка. Попробуйте позже.');
  }
}

// Обработчик главного меню
async function handleMainMenu(bot, chatId, messageId, user) {
  const welcomeText = `🎭 *Добро пожаловать в "Первый Панч"!*

Мы объединяем людей, которым интересно:
✨ Развивать свой юмор
✨ Становиться увереннее  
✨ Находить единомышленников

💰 *Стоимость подписки: 10 рублей на 30 дней*

👇 *Выберите действие* 👇`;

  await bot.editMessageText(welcomeText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    ...createMainMenu()
  });

  await addMessage(user.id, welcomeText, true, 'text');
}

// Обработчик меню подписки
async function handleSubscribeMenu(bot, chatId, messageId, user) {
  const subscribeText = `💳 *Выберите способ оплаты подписки*

🔸 *Разовый платеж* - оплачиваете один раз на 30 дней
🔸 *Автоплатеж* - автоматическое продление каждый месяц

💡 *Преимущества автоплатежа:*
✅ Не нужно помнить о продлении
✅ Непрерывный доступ к каналу
✅ Можно отменить в любой момент

💰 *Стоимость: 10 рублей за 30 дней*`;

  await bot.editMessageText(subscribeText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    ...createSubscriptionMenu()
  });

  await addMessage(user.id, subscribeText, true, 'text');
}

// Обработчик разового платежа
async function handlePayOnce(bot, chatId, user) {
  try {
    const payment = await createSubscriptionPayment(user.id, user, 'yukassa');
    
    const paymentText = `💳 *Разовый платеж создан!*

💰 Сумма: ${payment.amount}₽
🕐 Срок: 30 дней

👇 Нажмите кнопку для оплаты:`;

    await bot.sendMessage(chatId, paymentText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Оплатить', url: payment.confirmationUrl }
          ],
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    });

    await addMessage(user.id, paymentText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка создания разового платежа:', error);
    await bot.sendMessage(chatId, `❌ Ошибка создания платежа: ${error.message}`);
  }
}

// Обработчик автоплатежа
async function handlePayAuto(bot, chatId, user) {
  try {
    const payment = await createAutoPayment(user.id, user);
    
    const paymentText = `🔄 *Автоплатеж создан!*

💰 Сумма: ${payment.amount}₽ каждые 30 дней
🔄 Автоматическое продление: ВКЛ
❌ Отмена: в любой момент через бота

⚠️ *Важно:* После первой оплаты ваша карта будет сохранена для автоматических списаний. Вы сможете отменить автоплатежи в любой момент.

👇 Нажмите кнопку для первой оплаты:`;

    await bot.sendMessage(chatId, paymentText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Оплатить и подключить автоплатеж', url: payment.confirmationUrl }
          ],
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    });

    await addMessage(user.id, paymentText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка создания автоплатежа:', error);
    await bot.sendMessage(chatId, `❌ Ошибка создания автоплатежа: ${error.message}`);
  }
}

// Обработчик меню автоплатежей
async function handleAutoPaymentsMenu(bot, chatId, messageId, user) {
  try {
    const paymentMethods = await getUserPaymentMethods(user.id);
    const hasAutoPayments = paymentMethods.length > 0;
    
    let menuText;
    
    if (hasAutoPayments) {
      menuText = `⚙️ *Управление автоплатежами*

✅ Автоплатежи подключены
💳 Активных методов: ${paymentMethods.length}
💰 Сумма списания: 10₽ каждые 30 дней

🔄 Следующее списание произойдет автоматически при истечении текущей подписки.`;
    } else {
      menuText = `⚙️ *Автоплатежи*

❌ Автоплатежи не подключены

💡 *Преимущества автоплатежей:*
✅ Автоматическое продление подписки
✅ Не нужно помнить о платежах
✅ Непрерывный доступ к каналу
✅ Отмена в любой момент`;
    }

    await bot.editMessageText(menuText, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'Markdown',
      ...createAutoPaymentsMenu(hasAutoPayments)
    });

    await addMessage(user.id, menuText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка в handleAutoPaymentsMenu:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при загрузке информации об автоплатежах.');
  }
}

// Обработчик отмены автоплатежей
async function handleCancelAutoPayments(bot, chatId, user) {
  try {
    await cancelAutoPayments(user.id);
    
    const cancelText = `❌ *Автоплатежи отменены*

✅ Все сохраненные платежные методы деактивированы
✅ Автоматические списания остановлены
✅ Текущая подписка остается активной до окончания срока

💡 Вы можете в любой момент снова подключить автоплатежи или оплачивать подписку вручную.`;

    await bot.sendMessage(chatId, cancelText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    });

    await addMessage(user.id, cancelText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка отмены автоплатежей:', error);
    await bot.sendMessage(chatId, `❌ Ошибка отмены автоплатежей: ${error.message}`);
  }
}

// Обработчик информации об автоплатежах
async function handleAutoPaymentsInfo(bot, chatId, user) {
  try {
    const paymentMethods = await getUserPaymentMethods(user.id);
    
    let infoText = `📋 *Информация об автоплатежах*

💳 *Активных методов оплаты:* ${paymentMethods.length}
💰 *Сумма списания:* 10₽
⏰ *Периодичность:* каждые 30 дней
🔄 *Статус:* ${paymentMethods.length > 0 ? 'Активен' : 'Неактивен'}

`;

    if (paymentMethods.length > 0) {
      infoText += `📋 *Сохраненные карты:*\n`;
      paymentMethods.forEach((method, index) => {
        infoText += `${index + 1}. ${method.card_mask || 'Карта'} (${method.type})\n`;
      });
      
      infoText += `\n⚠️ *Важно:* Списание происходит автоматически при истечении текущей подписки. Вы можете отменить автоплатежи в любой момент.`;
    } else {
      infoText += `❌ Автоплатежи не настроены. Подключите их для удобства!`;
    }

    await bot.sendMessage(chatId, infoText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    });

    await addMessage(user.id, infoText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка получения информации об автоплатежах:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при загрузке информации.');
  }
}

// Обработчик информации о канале
async function handleAboutChannel(bot, chatId, messageId, user) {
  const aboutText = `📋 *Подробнее о канале*

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

  await bot.editMessageText(aboutText, {
    chat_id: chatId,
    message_id: messageId,
    parse_mode: 'Markdown',
    reply_markup: {
      inline_keyboard: [
        [
          { text: '💳 Подписаться', callback_data: 'subscribe' }
        ],
        [
          { text: '🏠 Главное меню', callback_data: 'main_menu' }
        ]
      ]
    }
  });

  await addMessage(user.id, aboutText, true, 'text');
}

// Обработчик статуса пользователя
async function handleMyStatus(bot, chatId, user) {
  try {
    const isActive = await isSubscriptionActive(user.id);
    const paymentMethods = await getUserPaymentMethods(user.id);
    
    let statusText = `📊 *Ваш статус*

👤 *Пользователь:* ${user.first_name} ${user.last_name || ''}
🆔 *ID:* ${user.id}
📱 *Username:* @${user.username || 'не указан'}

`;

    if (isActive) {
      statusText += `✅ *Подписка:* Активна
🔄 *Автоплатежи:* ${paymentMethods.length > 0 ? 'Подключены' : 'Не подключены'}
💳 *Сохраненных карт:* ${paymentMethods.length}

🎉 У вас есть доступ ко всем материалам канала!`;
    } else {
      statusText += `❌ *Подписка:* Неактивна
🔄 *Автоплатежи:* ${paymentMethods.length > 0 ? 'Подключены (ожидание активации)' : 'Не подключены'}

💡 Оформите подписку для получения доступа к каналу.`;
    }

    await bot.sendMessage(chatId, statusText, {
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: isActive ? '⚙️ Автоплатежи' : '💳 Подписаться', 
              callback_data: isActive ? 'auto_payments' : 'subscribe' }
          ],
          [
            { text: '🏠 Главное меню', callback_data: 'main_menu' }
          ]
        ]
      }
    });

    await addMessage(user.id, statusText, true, 'text');
  } catch (error) {
    console.error('❌ Ошибка получения статуса:', error);
    await bot.sendMessage(chatId, 'Произошла ошибка при загрузке статуса.');
  }
}