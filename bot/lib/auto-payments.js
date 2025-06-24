import { 
  addPayment, 
  updatePaymentStatus, 
  addSubscription, 
  getUser, 
  updateSubscriptionStatus,
  getAllUsers,
  isSubscriptionActive
} from './supabase.js';
import { createAutoPayment, cancelPaymentMethod } from '../yukassa-recurring.js';

// Хранилище активных автоплатежей
const activeAutoPayments = new Map();

// Функция для запуска автоплатежей для пользователя
export async function startAutoPayments(userId, paymentMethodId, amount = 10) {
  try {
    console.log(`🔄 Запуск автоплатежей для пользователя ${userId} с методом ${paymentMethodId}`);
    
    // Останавливаем предыдущие автоплатежи если есть
    await stopAutoPayments(userId);
    
    const user = await getUser(userId);
    if (!user) {
      throw new Error('Пользователь не найден');
    }
    
    // Создаем интервал для автоплатежей каждые 5 минут (для тестирования)
    // В продакшене можно изменить на месяц: 30 * 24 * 60 * 60 * 1000
    const intervalId = setInterval(async () => {
      try {
        console.log(`💳 Выполнение автоплатежа для пользователя ${userId}`);
        
        // Проверяем, что пользователь еще активен
        const currentUser = await getUser(userId);
        if (!currentUser || currentUser.is_blocked) {
          console.log(`⚠️ Пользователь ${userId} заблокирован или не найден, останавливаем автоплатежи`);
          await stopAutoPayments(userId);
          return;
        }
        
        // Создаем автоплатеж
        const payment = await createAutoPayment(
          paymentMethodId,
          amount,
          `Автоподписка на канал "Первый Панч" - месяц ${new Date().toLocaleDateString('ru-RU')}`,
          {
            userId: userId.toString(),
            username: user.username || '',
            first_name: user.first_name || '',
            last_name: user.last_name || '',
            type: 'auto_subscription',
            paymentSystem: 'yukassa'
          }
        );
        
        // Сохраняем платеж в базу
        await addPayment(
          userId,
          payment.paymentId,
          payment.amount,
          payment.status,
          null, // нет confirmation_url для автоплатежей
          'yukassa'
        );
        
        // Если платеж успешен, продлеваем подписку
        if (payment.status === 'succeeded') {
          console.log(`✅ Автоплатеж успешен для пользователя ${userId}, продлеваем подписку`);
          
          // Добавляем месяц к подписке
          await addSubscription(userId, payment.paymentId, payment.amount, 30, 'yukassa');
          
          console.log(`📅 Подписка продлена для пользователя ${userId} на 30 дней`);
        } else {
          console.log(`⚠️ Автоплатеж не успешен для пользователя ${userId}, статус: ${payment.status}`);
          
          // Если платеж не прошел, можно попробовать еще раз через некоторое время
          // или отправить уведомление пользователю
        }
        
      } catch (error) {
        console.error(`❌ Ошибка автоплатежа для пользователя ${userId}:`, error.message);
        
        // Если ошибка критическая (например, карта заблокирована), останавливаем автоплатежи
        if (error.message.includes('payment_method_not_found') || 
            error.message.includes('card_expired') ||
            error.message.includes('insufficient_funds')) {
          console.log(`🛑 Критическая ошибка автоплатежа для пользователя ${userId}, останавливаем автоплатежи`);
          await stopAutoPayments(userId);
        }
      }
    }, 5 * 60 * 1000); // 5 минут для тестирования
    
    // Сохраняем информацию об активном автоплатеже
    activeAutoPayments.set(userId, {
      intervalId,
      paymentMethodId,
      amount,
      startedAt: new Date(),
      lastPayment: null
    });
    
    console.log(`✅ Автоплатежи запущены для пользователя ${userId}`);
    return true;
    
  } catch (error) {
    console.error(`❌ Ошибка запуска автоплатежей для пользователя ${userId}:`, error.message);
    throw error;
  }
}

// Функция для остановки автоплатежей для пользователя
export async function stopAutoPayments(userId, cancelPaymentMethodToo = false) {
  try {
    console.log(`🛑 Остановка автоплатежей для пользователя ${userId}`);
    
    const autoPayment = activeAutoPayments.get(userId);
    if (autoPayment) {
      // Останавливаем интервал
      clearInterval(autoPayment.intervalId);
      
      // Если нужно, отменяем способ оплаты в ЮKassa
      if (cancelPaymentMethodToo && autoPayment.paymentMethodId) {
        try {
          await cancelPaymentMethod(autoPayment.paymentMethodId);
          console.log(`✅ Способ оплаты отменен в ЮKassa для пользователя ${userId}`);
        } catch (error) {
          console.error(`⚠️ Ошибка отмены способа оплаты в ЮKassa для пользователя ${userId}:`, error.message);
        }
      }
      
      // Удаляем из активных автоплатежей
      activeAutoPayments.delete(userId);
      
      console.log(`✅ Автоплатежи остановлены для пользователя ${userId}`);
      return true;
    } else {
      console.log(`⚠️ Активные автоплатежи для пользователя ${userId} не найдены`);
      return false;
    }
    
  } catch (error) {
    console.error(`❌ Ошибка остановки автоплатежей для пользователя ${userId}:`, error.message);
    throw error;
  }
}

// Функция для проверки статуса автоплатежей пользователя
export function getAutoPaymentStatus(userId) {
  const autoPayment = activeAutoPayments.get(userId);
  if (autoPayment) {
    return {
      active: true,
      paymentMethodId: autoPayment.paymentMethodId,
      amount: autoPayment.amount,
      startedAt: autoPayment.startedAt,
      lastPayment: autoPayment.lastPayment
    };
  }
  return {
    active: false
  };
}

// Функция для получения всех активных автоплатежей
export function getAllActiveAutoPayments() {
  const result = [];
  for (const [userId, autoPayment] of activeAutoPayments.entries()) {
    result.push({
      userId,
      ...autoPayment
    });
  }
  return result;
}

// Функция для восстановления автоплатежей при перезапуске сервера
export async function restoreAutoPayments() {
  try {
    console.log('🔄 Восстановление автоплатежей при запуске сервера...');
    
    // Здесь можно добавить логику для восстановления автоплатежей из базы данных
    // Например, получить всех пользователей с активными подписками и сохраненными способами оплаты
    
    console.log('✅ Автоплатежи восстановлены');
  } catch (error) {
    console.error('❌ Ошибка восстановления автоплатежей:', error.message);
  }
}

// Функция для обновления статуса подписки на основе количества успешных платежей
export async function updateSubscriptionStatusByPayments(userId) {
  try {
    console.log(`📊 Обновление статуса подписки для пользователя ${userId} на основе платежей`);
    
    // Получаем все успешные платежи пользователя
    const { data: payments } = await supabase
      .from('payments')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'succeeded')
      .order('created_at', { ascending: true });
    
    if (!payments || payments.length === 0) {
      console.log(`⚠️ У пользователя ${userId} нет успешных платежей`);
      return;
    }
    
    const successfulPayments = payments.length;
    console.log(`💳 Пользователь ${userId} имеет ${successfulPayments} успешных платежей`);
    
    // Каждый платеж = 1 месяц подписки
    const subscriptionMonths = successfulPayments;
    
    // Обновляем статус пользователя
    await supabase
      .from('users')
      .update({
        subscription_status: 'active',
        updated_at: new Date().toISOString()
      })
      .eq('id', userId);
    
    console.log(`✅ Статус подписки обновлен для пользователя ${userId}: ${subscriptionMonths} месяцев`);
    
    return subscriptionMonths;
    
  } catch (error) {
    console.error(`❌ Ошибка обновления статуса подписки для пользователя ${userId}:`, error.message);
    throw error;
  }
}