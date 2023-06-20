const handler = require('./handler.js');
const { createServer } = require("http");
const { Server } = require("socket.io");
const ioPort = 9000;

const httpServer = createServer();
const io = new Server(httpServer);

handler.prepare();
io.on('connection', handler.onConnect);
httpServer.listen(ioPort);
console.log(`Сервер запущен на порту: ${ioPort}`);

