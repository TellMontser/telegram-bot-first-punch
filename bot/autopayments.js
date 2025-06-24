import { 
  getActiveAutoPaymentMethods, 
  updateNextPaymentDate, 
  disableAutoPayments,
  addSubscription,
  getUser,
  addMessage
} from './lib/supabase.js';
import { createAutoSubscriptionPayment } from './payments.js';
import TelegramBot from 'node-telegram-bot-api';

const BOT_TOKEN = '7801546376:AAEr6x5nFu1aIdVUusPzZsJscdL6zzFF6bM';
const bot = new TelegramBot(BOT_TOKEN);

// Функция для обработки автоплатежей
export async function processAutoPayments() {
  try {
    console.log('🔄 Запуск обработки автоплатежей...');
    
    // Получаем все активные способы оплаты с включенными автоплатежами
    const autoPaymentMethods = await getActiveAutoPaymentMethods();
    
    if (autoPaymentMethods.length === 0) {
      console.log('ℹ️ Нет активных автоплатежей для обработки');
      return;
    }
    
    console.log(`💳 Найдено ${autoPaymentMethods.length} автоплатежей для обработки`);
    
    for (const paymentMethod of autoPaymentMethods) {
      try {
        console.log(`🔄 Обработка автоплатежа для пользователя ${paymentMethod.user_id}`);
        
        // Создаем автоплатеж
        const payment = await createAutoSubscriptionPayment(
          paymentMethod.user_id,
          paymentMethod.payment_method_id,
          10 // 10 рублей
        );
        
        if (payment.status === 'succeeded') {
          // Платеж прошел успешно - создаем подписку
          await addSubscription(
            paymentMethod.user_id,
            payment.paymentId,
            payment.amount,
            30, // 30 дней
            'yukassa',
            paymentMethod.payment_method_id
          );
          
          // Отправляем уведомление пользователю
          await sendAutoPaymentSuccessNotification(paymentMethod.user_id, payment.amount);
          
          // Обновляем дату следующего платежа (через 5 минут)
          const nextPaymentDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();
          await updateNextPaymentDate(paymentMethod.payment_method_id, nextPaymentDate);
          
          console.log(`✅ Автоплатеж успешно обработан для пользователя ${paymentMethod.user_id}`);
        } else {
          console.log(`⏳ Автоплатеж в обработке для пользователя ${paymentMethod.user_id}`);
          
          // Обновляем дату следующего платежа (через 1 минуту для повторной попытки)
          const nextPaymentDate = new Date(Date.now() + 1 * 60 * 1000).toISOString();
          await updateNextPaymentDate(paymentMethod.payment_method_id, nextPaymentDate);
        }
        
      } catch (error) {
        console.error(`❌ Ошибка при обработке автоплатежа для пользователя ${paymentMethod.user_id}:`, error);
        
        // Если ошибка критическая (например, карта заблокирована), отключаем автоплатежи
        if (error.message.includes('blocked') || error.message.includes('expired') || error.message.includes('insufficient')) {
          console.log(`🚫 Отключение автоплатежей для пользователя ${paymentMethod.user_id} из-за ошибки: ${error.message}`);
          
          await disableAutoPayments(paymentMethod.payment_method_id);
          await sendAutoPaymentFailureNotification(paymentMethod.user_id, error.message);
        } else {
          // Временная ошибка - попробуем позже
          const nextPaymentDate = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // Через 10 минут
          await updateNextPaymentDate(paymentMethod.payment_method_id, nextPaymentDate);
        }
      }
    }
    
    console.log('✅ Обработка автоплатежей завершена');
  } catch (error) {
    console.error('❌ Критическая ошибка при обработке автоплатежей:', error);
  }
}

// Функция для отправки уведомления об успешном автоплатеже
async function sendAutoPaymentSuccessNotification(userId, amount) {
  try {
    const user = await getUser(userId);
    if (!user) return;
    
    const message = `✅ Автоплатеж успешно выполнен!

💳 Списано: ${amount}₽
📅 Подписка продлена на 30 дней
🔄 Следующий платеж: через 5 минут

Ваша подписка на канал "Первый Панч" активна!`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '🚀 Перейти в канал', url: 'https://t.me/+SQUu4rWliGo5ZjRi' }
          ],
          [
            { text: '🚫 Отключить автоплатежи', callback_data: 'disable_autopayments' },
            { text: '📊 Статус подписки', callback_data: 'subscription_status' }
          ]
        ]
      }
    };

    await bot.sendMessage(userId, message, options);
    await addMessage(userId, message, true, 'autopayment_success');
    
    console.log(`✅ Уведомление об успешном автоплатеже отправлено пользователю ${userId}`);
  } catch (error) {
    console.error(`❌ Ошибка отправки уведомления об успешном автоплатеже пользователю ${userId}:`, error);
  }
}

// Функция для отправки уведомления о неудачном автоплатеже
async function sendAutoPaymentFailureNotification(userId, errorMessage) {
  try {
    const user = await getUser(userId);
    if (!user) return;
    
    const message = `❌ Автоплатеж не удался

🚫 Причина: ${errorMessage}
💳 Автоплатежи отключены

Для продолжения подписки оформите платеж вручную:`;

    const options = {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '💳 Оплатить вручную', callback_data: 'get_subscription_yukassa' }
          ],
          [
            { text: '📊 Статус подписки', callback_data: 'subscription_status' }
          ]
        ]
      }
    };

    await bot.sendMessage(userId, message, options);
    await addMessage(userId, message, true, 'autopayment_failure');
    
    console.log(`✅ Уведомление о неудачном автоплатеже отправлено пользователю ${userId}`);
  } catch (error) {
    console.error(`❌ Ошибка отправки уведомления о неудачном автоплатеже пользователю ${userId}:`, error);
  }
}

// Функция для запуска планировщика автоплатежей
export function startAutoPaymentScheduler() {
  console.log('🚀 Запуск планировщика автоплатежей...');
  
  // Запускаем обработку каждую минуту
  setInterval(async () => {
    try {
      await processAutoPayments();
    } catch (error) {
      console.error('❌ Ошибка в планировщике автоплатежей:', error);
    }
  }, 60 * 1000); // Каждую минуту
  
  console.log('✅ Планировщик автоплатежей запущен (проверка каждую минуту)');
}

// Функция для остановки планировщика (если нужно)
export function stopAutoPaymentScheduler() {
  console.log('🛑 Остановка планировщика автоплатежей...');
  // Здесь можно добавить логику остановки, если нужно
}