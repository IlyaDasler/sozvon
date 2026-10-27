import fs from 'node:fs';
import http from 'node:http';
import express from 'express';
import { config } from './config.js';
import { createApi } from './api.js';
import { attachSignaling } from './signaling.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// Десктопное приложение открывает страницу с file://, поэтому разрешаем запросы с любого источника.
// Авторизация идёт по токену в заголовке, а не по cookie, так что это безопасно.
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', createApi());

// Веб-версия клиента (та же страница, что и в приложении для Windows)
if (fs.existsSync(config.webDir)) app.use(express.static(config.webDir));

const server = http.createServer(app);
attachSignaling(server);

server.listen(config.port, () => {
  console.log(`Сервер «Созвон» запущен: http://localhost:${config.port}`);
  console.log(`Данные хранятся в ${config.dataDir}`);
  if (!config.turnUrls.length) console.log('TURN не настроен: звонки через строгий NAT могут не соединиться');
});
