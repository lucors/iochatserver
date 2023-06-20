const handler = require('./handler.js');
const ioPort = 9000;
const socketOptions = {path: "/iochatserver/socket.io"};
if (handler.handlerConfig.debug) {
  socketOptions.path = "";
}
const io = require('socket.io')(null, socketOptions);

handler.prepare();
io.on('connection', handler.onConnect);
io.listen(ioPort);
console.log(`Сервер запущен на порту: ${ioPort}`);