const handler = require('./handler.js');
const ioPort = 9000;
const io = require('socket.io')();

handler.prepare();
io.on('connection', handler.onConnect);
io.listen(ioPort);
console.log(`Сервер запущен на порту: ${ioPort}`);