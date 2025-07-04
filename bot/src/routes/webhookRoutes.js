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

  // Страница успешной оплаты
  router.get('/payment-success', async (req, res) => {
    console.log('✅ Пользователь перенаправлен на страницу успешной оплаты');
    
    res.send(`
      <!DOCTYPE html>
      <html lang="ru">
        <head>
          <title>Оплата завершена</title>
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
              background: linear-gradient(135deg, #4CAF50 0%, #45a049 100%);
              color: white;
              min-height: 100vh;
              display: flex;
              align-items: center;
              justify-content: center;
              padding: 20px;
            }
            
            .container {
              background: rgba(255, 255, 255, 0.15);
              padding: 50px;
              border-radius: 25px;
              backdrop-filter: blur(15px);
              border: 1px solid rgba(255, 255, 255, 0.3);
              max-width: 600px;
              width: 100%;
              text-align: center;
              box-shadow: 0 25px 50px rgba(0, 0, 0, 0.2);
            }
            
            .success-icon {
              font-size: 100px;
              margin-bottom: 30px;
              animation: bounce 2s infinite;
            }
            
            @keyframes bounce {
              0%, 20%, 50%, 80%, 100% {
                transform: translateY(0);
              }
              40% {
                transform: translateY(-10px);
              }
              60% {
                transform: translateY(-5px);
              }
            }
            
            h1 { 
              margin-bottom: 25px;
              font-size: 2.8em;
              font-weight: 700;
              text-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
            }
            
            p { 
              font-size: 1.3em;
              line-height: 1.7;
              margin-bottom: 20px;
              opacity: 0.95;
            }
            
            .highlight {
              background: rgba(255, 255, 255, 0.2);
              padding: 25px;
              border-radius: 15px;
              margin: 30px 0;
              border: 1px solid rgba(255, 255, 255, 0.3);
            }
            
            .telegram-link {
              display: inline-block;
              background: #0088cc;
              color: white;
              padding: 15px 30px;
              border-radius: 50px;
              text-decoration: none;
              font-weight: 600;
              margin-top: 20px;
              transition: all 0.3s ease;
              box-shadow: 0 5px 15px rgba(0, 136, 204, 0.4);
            }
            
            .telegram-link:hover {
              background: #006699;
              transform: translateY(-2px);
              box-shadow: 0 8px 25px rgba(0, 136, 204, 0.6);
            }
            
            .features {
              display: grid;
              grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
              gap: 20px;
              margin-top: 30px;
            }
            
            .feature {
              background: rgba(255, 255, 255, 0.1);
              padding: 20px;
              border-radius: 15px;
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            .feature-icon {
              font-size: 2em;
              margin-bottom: 10px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Оплата завершена!</h1>
            <p>Спасибо за оплату! Ваша подписка успешно активирована.</p>
            
            <div class="highlight">
              <p><strong>🎉 Что дальше?</strong></p>
              <p>Уведомление о активации подписки уже отправлено в Telegram бот.</p>
              <p>Автоплатеж настроен и будет происходить каждые 3 минуты.</p>
            </div>
            
            <div class="features">
              <div class="feature">
                <div class="feature-icon">🔄</div>
                <p><strong>Автоплатеж</strong><br>Каждые 3 минуты</p>
              </div>
              <div class="feature">
                <div class="feature-icon">💰</div>
                <p><strong>Сумма</strong><br>10 рублей</p>
              </div>
              <div class="feature">
                <div class="feature-icon">📱</div>
                <p><strong>Управление</strong><br>Через Telegram бот</p>
              </div>
            </div>
            
            <a href="https://t.me/your_bot_username" class="telegram-link">
              📱 Вернуться в Telegram бот
            </a>
            
            <p style="margin-top: 30px; font-size: 1em; opacity: 0.8;">
              Вы можете закрыть эту страницу и вернуться в Telegram.
            </p>
          </div>
        </body>
      </html>
    `);
  });

  return router;
}