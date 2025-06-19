import express from 'express';
import cors from 'cors';
// ... остальные импорты из server/index.js

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Все API endpoints из server/index.js
// ...

app.listen(PORT, () => {
  console.log(`🌐 API сервер запущен на порту ${PORT}`);
});
