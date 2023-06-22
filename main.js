const handler = require('./handler.js');
const ioPort = 9000;
const socketOptions = {
  path: handler.config.debug ? "" : "/iochatserver/socket.io",
  cors: {
    origin: "*"
  }
};
const io = require('socket.io')(null, socketOptions);

handler.prepare();
io.on('connection', handler.onConnect);
io.listen(ioPort);
console.log(`Сервер запущен на порту: ${ioPort}`);