import express from 'express';

export function webhookRoutes(telegramBot, yookassaService) {
  const router = express.Router();

  // Webhook для Telegram
  router.post('/telegram', async (req, res) => {
    console.log('📨 Получен webhook от Telegram');
    await telegramBot.processWebhook(req, res);
  });

  // Webhook для ЮKassa
  router.post('/yookassa', async (req, res) => {
    try {
      const notification = req.body;
      console.log('💰 Получен webhook от ЮKassa:', JSON.stringify(notification, null, 2));

      // Проверяем тип события
      if (notification.event === 'payment.succeeded') {
        const paymentId = notification.object.id;
        console.log(`✅ Платеж успешно завершен: ${paymentId}`);
        
        await telegramBot.handlePaymentSuccess(paymentId);
      } else if (notification.event === 'payment.canceled') {
        const paymentId = notification.object.id;
        console.log(`❌ Платеж отменен: ${paymentId}`);
        
        // Здесь можно добавить обработку отмененных платежей
      } else {
        console.log(`ℹ️ Получено событие: ${notification.event}`);
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('❌ Ошибка при обработке webhook ЮKassa:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Простая страница для информации (на случай если кто-то зайдет)
  router.get('/payment-success', async (req, res) => {
    console.log('ℹ️ Кто-то зашел на страницу payment-success');
    
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <title>Информация о платежах</title>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body { 
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            
            .container {
              background: rgba(255, 255, 255, 0.1);
              padding: 40px;
              border-radius: 20px;
              backdrop-filter: blur(10px);
              border: 1px solid rgba(255, 255, 255, 0.2);
              max-width: 500px;
              width: 100%;
              text-align: center;
              box-shadow: 0 20px 40px rgba(0, 0, 0, 0.1);
            }
            
            .icon {
              font-size: 80px;
              margin-bottom: 20px;
            }
            
            h1 { 
              margin-bottom: 20px;
              font-size: 2.5em;
              font-weight: 700;
            }
            
            p { 
              font-size: 1.2em;
              line-height: 1.6;
              margin-bottom: 15px;
              opacity: 0.9;
            }
            
            .highlight {
              background: rgba(255, 255, 255, 0.2);
              padding: 20px;
              border-radius: 10px;
              margin: 20px 0;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="icon">💳</div>
            <h1>Платежная система</h1>
            <p>Все платежи обрабатываются через стандартную страницу ЮКассы.</p>
            
            <div class="highlight">
              <p><strong>ℹ️ Информация:</strong></p>
              <p>После успешной оплаты вы получите уведомление в Telegram боте.</p>
              <p>Никаких дополнительных действий не требуется.</p>
            </div>
            
            <p>Если у вас есть вопросы, обратитесь в поддержку через бот.</p>
          </div>
        </body>
      </html>
    `);
  });

  return router;
}