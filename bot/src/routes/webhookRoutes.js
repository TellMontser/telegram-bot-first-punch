import express from 'express';

export function webhookRoutes(telegramBot, yookassaService) {
  const router = express.Router();

  // Webhook для Telegram
  router.post('/telegram', async (req, res) => {
    await telegramBot.processWebhook(req, res);
  });

  // Webhook для ЮKassa
  router.post('/yookassa', async (req, res) => {
    try {
      const notification = req.body;
      console.log('Получен webhook от ЮKassa:', notification);

      if (notification.event === 'payment.succeeded') {
        const paymentId = notification.object.id;
        await telegramBot.handlePaymentSuccess(paymentId);
      }

      res.status(200).json({ status: 'ok' });
    } catch (error) {
      console.error('Ошибка при обработке webhook ЮKassa:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Redirect после успешной оплаты
  router.get('/payment-success', async (req, res) => {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Оплата успешна</title>
          <meta charset="UTF-8">
          <style>
            body { 
              font-family: Arial, sans-serif; 
              text-align: center; 
              padding: 50px;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
              color: white;
            }
            .container {
              background: rgba(255, 255, 255, 0.1);
              padding: 40px;
              border-radius: 20px;
              backdrop-filter: blur(10px);
              max-width: 500px;
              margin: 0 auto;
            }
            .success-icon {
              font-size: 60px;
              margin-bottom: 20px;
            }
            h1 { margin-bottom: 20px; }
            p { font-size: 18px; line-height: 1.6; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="success-icon">✅</div>
            <h1>Платеж успешно обработан!</h1>
            <p>Спасибо за оплату. Ваша подписка активирована.</p>
            <p>Вы можете вернуться в Telegram бот для управления подпиской.</p>
          </div>
        </body>
      </html>
    `);
  });

  return router;
}