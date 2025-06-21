import { addPayment } from './lib/supabase.js';
import { createYukassaPayment } from './yukassa.js';

export async function createSubscriptionPayment(userId, user) {
  try {
    console.log(`💳 Создание платежа подписки для пользователя ${userId}`);
    
    if (!userId) {
      throw new Error('Не указан ID пользователя');
    }
    
    if (!user) {
      throw new Error('Не переданы данные пользователя');
    }
    
    const amount = 10; // 10 рублей
    const description = `Подписка на канал "Первый Панч" на 30 дней`;
    
    const metadata = {
      userId: userId.toString(),
      username: user.username || '',
      first_name: user.first_name || '',
      type: 'subscription'
    };
    
    console.log('🔄 Отправка запроса в ЮKassa...');
    console.log('📋 Метаданные:', metadata);
    
    // Создаем платеж в ЮKassa
    const yukassaPayment = await createYukassaPayment(amount, description, metadata);
    
    console.log('✅ Платеж создан в ЮKassa:', yukassaPayment);
    
    if (!yukassaPayment.confirmationUrl) {
      console.error('❌ Не получена ссылка для оплаты от ЮKassa');
      throw new Error('Не получена ссылка для оплаты от ЮKassa');
    }
    
    // Сохраняем платеж в Supabase
    const supabasePayment = await addPayment(
      userId, 
      yukassaPayment.paymentId, 
      yukassaPayment.amount, 
      yukassaPayment.status,
      yukassaPayment.confirmationUrl
    );
    
    console.log('✅ Платеж сохранен в Supabase:', supabasePayment);
    
    return {
      paymentId: yukassaPayment.paymentId,
      confirmationUrl: yukassaPayment.confirmationUrl,
      amount: yukassaPayment.amount,
      status: yukassaPayment.status
    };
  } catch (error) {
    console.error('❌ Ошибка при создании платежа подписки:', error.message);
    console.error('❌ Полная ошибка:', error);
    throw new Error(`Не удалось создать платеж: ${error.message}`);
  }
}
