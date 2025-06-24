import cron from 'node-cron';
import { processAutoPayments } from './auto-payments.js';

// Запускаем обработку автоплатежей каждые 5 минут (для тестирования)
// В продакшене можно изменить на ежедневную проверку: '0 0 * * *'
export function startAutoPaymentScheduler() {
  console.log('🕐 Запуск планировщика автоплатежей...');
  
  // Каждые 5 минут для тестирования
  cron.schedule('*/5 * * * *', async () => {
    console.log('⏰ Запуск обработки автоплатежей по расписанию...');
    try {
      await processAutoPayments();
      console.log('✅ Обработка автоплатежей завершена успешно');
    } catch (error) {
      console.error('❌ Ошибка в планировщике автоплатежей:', error);
    }
  });
  
  console.log('✅ Планировщик автоплатежей запущен (каждые 5 минут)');
}

// Функция для остановки планировщика
export function stopAutoPaymentScheduler() {
  cron.destroy();
  console.log('🛑 Планировщик автоплатежей остановлен');
}