import { 
  updatePaymentStatus, 
  getPaymentByPaymentId, 
  addSubscription,
  addPaymentMethod,
  enableAutoPayments
} from './lib/supabase.js';
import { startAutoPayments } from './lib/auto-payments.js';

// Обработка webhook от ЮKassa
export async function handleYukassaWebhook(bot, webhookData) {
  try {
    console.log('📡 Получен webhook от ЮKassa:', JSON.stringify(webhookData, null, 2));
    
    const { type, object: payment } = webhookData;
    
    if (type === 'payment.succeeded') {
      console.log(`✅ Платеж успешен: ${payment.id}`);
      
      // Обновляем статус платежа в базе данных
      const updatedPayment = await updatePaymentStatus(payment.id, 'succeeded');
      
      if (updatedPayment) {
        const userId = updatedPayment.user_id;
        const amount = updatedPayment.amount;
        
        console.log(`💳 Обрабатываем успешный платеж для пользователя ${userId}`);
        
        // Создаем подписку на 30 дней
        await addSubscription(userId, payment.id, amount, 30, 'yukassa');
        
        // Проверяем, есть ли сохраненный способ оплаты (для автоплатежей)
        if (payment.payment_method && payment.payment_method.saved) {
          console.log(`💾 Обнаружен сохраненный способ оплаты: ${payment.payment_method.id}`);
          
          // Сохраняем способ оплаты в базе данных
          const cardMask = payment.payment_method.card ? 
            `**** **** **** ${payment.payment_method.card.last4}` : null;
          
          await addPaymentMethod(
            userId, 
            payment.payment_method.id, 
            payment.payment_method.type || 'card',
            cardMask
          );
          
          // Включаем автоплатежи для этого способа оплаты
          await enableAutoPayments(userId, payment.payment_method.id);
          
          // Запускаем автоплатежи
          await startAutoPayments(userId, payment.payment_method.id, 10);
          
          console.log(`🔄 Автоплатежи настроены для пользователя ${userId}`);
          
          // Уведомляем пользователя об успешной настройке автоподписки
          try {
            await bot.sendMessage(userId, `🎉 *Автоподписка настроена!*

✅ Ваш платеж на ${amount}₽ успешно обработан
🔄 Автоплатежи активированы
💳 Карта сохранена: ${cardMask || 'Способ оплаты сохранен'}

⏰ Следующее списание: через 5 минут (тест)
💰 Сумма автоплатежа: 10₽

🛑 Отключить автоплатежи можно в любой момент через меню бота.

🎭 Добро пожаловать в "Первый Панч"!`, {
              parse_mode: 'Markdown'
            });
          } catch (error) {
            console.error('❌ Ошибка отправки уведомления об автоподписке:', error);
          }
        } else {
          // Обычная подписка без автоплатежей
          console.log(`💳 Обычная подписка для пользователя ${userId}`);
          
          // Уведомляем пользователя об успешной оплате
          try {
            await bot.sendMessage(userId, `🎉 *Платеж успешно обработан!*

✅ Ваш платеж на ${amount}₽ подтвержден
📅 Подписка активна на 30 дней
🎭 Добро пожаловать в "Первый Панч"!

💡 Хотите настроить автоподписку? Используйте команду /start и выберите "Автоподписка".`, {
              parse_mode: 'Markdown'
            });
          } catch (error) {
            console.error('❌ Ошибка отправки уведомления о платеже:', error);
          }
        }
        
        console.log(`✅ Подписка создана для пользователя ${userId} на 30 дней`);
      } else {
        console.error('❌ Не удалось найти платеж в базе данных:', payment.id);
      }
    } else if (type === 'payment.canceled') {
      console.log(`❌ Платеж отменен: ${payment.id}`);
      
      // Обновляем статус платежа в базе данных
      await updatePaymentStatus(payment.id, 'cancelled');
      
      // Можно отправить уведомление пользователю об отмене
      const paymentRecord = await getPaymentByPaymentId(payment.id);
      if (paymentRecord) {
        try {
          await bot.sendMessage(paymentRecord.user_id, `❌ *Платеж отменен*

Ваш платеж на ${paymentRecord.amount}₽ был отменен.

💡 Вы можете попробовать оплатить снова, используя команду /start.`, {
            parse_mode: 'Markdown'
          });
        } catch (error) {
          console.error('❌ Ошибка отправки уведомления об отмене:', error);
        }
      }
    } else if (type === 'payment.waiting_for_capture') {
      console.log(`⏳ Платеж ожидает подтверждения: ${payment.id}`);
      // Обычно для автоматического подтверждения (capture: true) этот статус не используется
    } else {
      console.log(`ℹ️ Неизвестный тип webhook от ЮKassa: ${type}`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка обработки webhook от ЮKassa:', error);
    return { success: false, error: error.message };
  }
}

// Обработка webhook от CryptoCloud
export async function handleCryptoCloudWebhook(bot, webhookData) {
  try {
    console.log('📡 Получен webhook от CryptoCloud:', JSON.stringify(webhookData, null, 2));
    
    const { status, uuid: paymentId, amount_crypto, amount_rub } = webhookData;
    
    if (status === 'paid' || status === 'confirmed') {
      console.log(`✅ Криптоплатеж успешен: ${paymentId}`);
      
      // Обновляем статус платежа в базе данных
      const updatedPayment = await updatePaymentStatus(paymentId, 'succeeded');
      
      if (updatedPayment) {
        const userId = updatedPayment.user_id;
        const amount = updatedPayment.amount;
        
        console.log(`₿ Обрабатываем успешный криптоплатеж для пользователя ${userId}`);
        
        // Создаем подписку на 30 дней
        await addSubscription(userId, paymentId, amount, 30, 'cryptocloud');
        
        // Уведомляем пользователя об успешной оплате
        try {
          await bot.sendMessage(userId, `🎉 *Криптоплатеж успешно обработан!*

✅ Ваш платеж на ${amount}₽ подтвержден
₿ Получено: ${amount_crypto || 'N/A'} криптовалюты
📅 Подписка активна на 30 дней
🎭 Добро пожаловать в "Первый Панч"!

💡 CryptoCloud не поддерживает автоплатежи. Для автоподписки используйте ЮKassa.`, {
            parse_mode: 'Markdown'
          });
        } catch (error) {
          console.error('❌ Ошибка отправки уведомления о криптоплатеже:', error);
        }
        
        console.log(`✅ Подписка создана для пользователя ${userId} на 30 дней (CryptoCloud)`);
      } else {
        console.error('❌ Не удалось найти криптоплатеж в базе данных:', paymentId);
      }
    } else if (status === 'canceled' || status === 'failed') {
      console.log(`❌ Криптоплатеж отменен/неудачен: ${paymentId}`);
      
      // Обновляем статус платежа в базе данных
      await updatePaymentStatus(paymentId, 'cancelled');
      
      // Можно отправить уведомление пользователю об отмене
      const paymentRecord = await getPaymentByPaymentId(paymentId);
      if (paymentRecord) {
        try {
          await bot.sendMessage(paymentRecord.user_id, `❌ *Криптоплатеж не удался*

Ваш платеж на ${paymentRecord.amount}₽ не был завершен.

💡 Вы можете попробовать оплатить снова, используя команду /start.`, {
            parse_mode: 'Markdown'
          });
        } catch (error) {
          console.error('❌ Ошибка отправки уведомления об отмене криптоплатежа:', error);
        }
      }
    } else {
      console.log(`ℹ️ Неизвестный статус webhook от CryptoCloud: ${status}`);
    }
    
    return { success: true };
  } catch (error) {
    console.error('❌ Ошибка обработки webhook от CryptoCloud:', error);
    return { success: false, error: error.message };
  }
}