const fs = require("fs");
const mysql = require('mysql2');
const config = require("./config.js");

// [wsClient, ...]
let db;
const clients = new Set();
// let incomingHandlers = []; //[{mode: string, func: function()},...]
let flags = {
  debug: config.debug,
  prepareAdmins: false,
  prepareRooms: false,
}
let admins = {};
let rooms = [];

// 
const historyPool = {
  pool: {},
  interval: undefined,
  prepare: function() {
    rooms.forEach((room, index) => {
      if (room.history) {
        historyPool.pool[index] = []
      }
    });
  },
  clear: function() {
    clearInterval(historyPool.interval);
    historyPool.pool = {};
  },
  push: function(rid, mode, data) {
    if (!rooms[rid].history) return;
    if (["msg:msg", "msg:blur"].indexOf(mode) < 0) return;
    historyPool.pool[rid].push([mode, data]);
  },
  get: function(rid) {
    if (rid in historyPool.pool){
      return historyPool.pool[rid];
    }
    return [];
  },
  slice: function(maxlen, interval) {
    // if (!fs.existsSync("./history")) fs.mkdirSync("./history");
    historyPool.interval = setInterval(() => {
      try {
        for (const rid of Object.keys(historyPool.pool)) {

          if (historyPool.pool[rid].length > maxlen){
            // const longhistory = JSON.stringify(historyPool[rid].slice(0, historyPool[rid].length-maxlen))+'\n';
            // fs.appendFile(`./history/${rid}.txt`, longhistory, function(error){
            //   if (error) console.error(`Ошибка записи истории. Комната ${rid}`);
            // });
            historyPool.pool[rid] = historyPool.pool[rid].slice(historyPool.pool[rid].length-maxlen);
            console.log(`History pool (${rid}:msg) sliced`);
          }
        }
      }
      catch (error) {
        console.error(error);
      }
    }, interval);
  }
}


//-----------------------------------------------------------------------------------
// EXPORTS
module.exports.config = config;
module.exports.onConnect = function(client) {
  console.log(`Подключился ${client.id}`);

  var onevent = client.onevent;
  client.onevent = function (packet) {
      var args = packet.data || [];
      if (flags.debug && !args[0].includes("test:")) {
        console.log(`>> (${client.who || "?"}:${client.admin ? 'A' : 'U'}): ${args.toString().slice(0, 60)}`);
      }
      onevent.call(this, packet);
  }

  //Привязка обработчиков событий
  client.on("message",      handlers.onMessage.bind(handlers, client));
  client.on("disconnect",   handlers.onClose.bind(handlers, client));
  client.on("test:ping",    handlers.ping.bind(handlers, client));
  client.on("auth:auth",    handlers.auth.bind(handlers, client));
  client.on("auth:pass",    handlers.authPass.bind(handlers, client));
  client.on("room:change",  handlers.roomChange.bind(handlers, client));
  client.on("msg:msg",      handlers.msg.bind(handlers, client));
  client.on("msg:blur",     handlers.msgBlur.bind(handlers, client));
  client.on("msg:direct",   handlers.msgDirect.bind(handlers, client));
  client.on("msg:server",   handlers.msgServer.bind(handlers, client));
  client.on("cfg:reload",   handlers.cfgReload.bind(handlers, client));
  client.on("mem:kick",     handlers.memKick.bind(handlers, client));
  client.on("msg:broadcast",      handlers.broadcast.bind(handlers, client));
  client.on("msg:broadcast:room", handlers.broadcastR.bind(handlers, client));
}
module.exports.prepare = function() {
  flags.prepareAdmins = false;
  flags.prepareRooms = false;
  db = mysql.createConnection(config.db);
  db.query(
    "SELECT * FROM admins",
    function(err, results) {
      if (err) {
        console.error(err);
        flags.prepareAdmins = true;
        return;
      }
      admins = {};
      results.forEach((admin) => {
        admins[admin["name"]] = Number(admin["passhash"]);
      });
      flags.prepareAdmins = true;
    }
  );
  db.query(
    "SELECT * FROM rooms",
    function(err, results) {
      if (err) {
        console.error(err);
        flags.prepareRooms = true;
        return;
      }
      rooms = [];
      results.forEach((room) => {
        rooms.push({
          title: room["title"],
          mems: new Set(),
          history: Boolean(room["history"]),
        })
      });
      historyPool.prepare();
      //Старт цикла среза истории
      historyPool.slice(config.historySlice.count, config.historySlice.time);
      flags.prepareRooms = true;
    }
  );
  db.end();
}

const handlers = {
  ping: (client) => {
    client.emit("test:ping", Date.now());
  },

  onClose: (client) => {
    let who = "Null";
    clients.forEach((cl) => {
      if (cl === client) {
        roomUtils.leaveRoom(cl);
        clients.delete(cl);
        who = cl.who;
        delete client.rid;
        delete client.who;
        delete client.admin;
        return;
      }
    });
    adminUtils.adminBroadcast("client:del", who);
    console.log(`Пользователь отключился: ${who}`);
    userUtils.totalBroadcast("client:count", clients.size);
  },

  onMessage: (client, raw) => {
    console.warn("Unsupported raw message: " + raw);
  },

  auth: (client, message) => {
    if (!message) return;
    let who = message.slice(0, config.who.slice);
    if (config.who.unavailableNames.includes(who.toLowerCase())) {
      userUtils.direct(client, "auth:fail", "Имя недоступно");
      return;
    }
    for (let cl of clients) {
      if (cl.who === who) {
        userUtils.direct(client, "auth:fail", "Имя занято");
        return;
      }
    }
    if (adminUtils.isAdmin(who)) {
      userUtils.direct(client, "auth:pass", "Требуется пароль");
      return;
    }
    commonUtils.authUser(client, who);
  },

  authPass: (client, message) => {
    if (!message) return;
    if (message.length < 2) return;
    let who = message[0].slice(0, config.who.slice);
    let hashpass = message[1];
    for (let cl of clients) {
      if (cl.who === who) {
        userUtils.direct(client, "auth:fail", "Имя занято");
        return;
      }
    }
    if (!adminUtils.adminCheckPass(who, hashpass)) {
      userUtils.direct(client, "auth:fail", "Ошибка авторизации");
      return;
    }
    commonUtils.authUser(client, who, true);
  },

  roomChange: (client, message) => {
    if (!client.who) return;

    const rid = message;
    if (!roomUtils.checkRid(rid)) {
      userUtils.direct(client, "room:change:fail", "Комната не найдена");
      return;
    }
    if (rooms[rid].mems.has(client)) {
      userUtils.direct(client, "room:change:fail", "Вы уже в этой комнате");
      return;
    }
    roomUtils.leaveRoom(client);
    roomUtils.enterRoom(client, rid);
  },

  msg: (client, message) => {
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message === "") return;

    message = message.slice(0, config.msg.slice);
    roomUtils.roomBroadcast(client.rid, "msg:msg", [client.who, message]);
  },

  msgBlur: (client, message) => {
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message === "") return;

    message = message.slice(0, config.msg.slice);
    roomUtils.roomBroadcast(client.rid, "msg:blur", [client.who, message]);
  },

  msgDirect: (client, message) => {
    if (!clients.has(client)) return;
    if (!("who" in client)) return;
    if (!("rid" in client)) return;
    if (message.length < 2) return;
    if (!message[0] || !message[1]) return;

    if (message[0] === client.who) {
      userUtils.direct(client, "cmn:error", "Отправка самому себе недоступна");
      return;
    }
    const whom = roomUtils.roomMemberByWho(client.rid, message[0]);
    if (!whom) {
      userUtils.direct(client, "cmn:error", "Пользователь не найден");
      return;
    }
    message[1] = message[1].slice(0, config.msg.slice);
    userUtils.direct(client, "msg:direct", [client.who, whom.who, message[1]]);
    userUtils.direct(whom, "msg:direct", [client.who, whom.who, message[1]]);
  },

  broadcast: (client, message) => {
    if (!client.admin) return;
    if (!message) return;
    
    userUtils.totalBroadcast("msg:notify", message);
  },

  broadcastR: (client, message) => {
    if (!client.admin) return;
    
    if (typeof message === "string") {
      if (!message || (client.rid === undefined)) return;
      roomUtils.roomBroadcast(client.rid, "msg:notify", message);
    }
    else {
      if (message.length < 2) return;
      if (!message[0] || !message[1]) return;
      roomUtils.roomBroadcast(message[0], "msg:notify", message[1]);
    }
  },

  msgServer: (client, message) => {
    if (!client.admin) return;
    if (!clients.has(client)) return;
    if (!("rid" in client)) return;
    if (message === "") return;

    message = message.slice(0, config.msg.slice);
    roomUtils.roomBroadcast(client.rid, "msg:msg", ["Сервер", message]);
  },

  cfgReload: (client, message) => {
    if (!client.admin) return;
    module.exports.prepare();
    userUtils.direct(client, "cfg:reload:ok");
  },

  memKick: (client, message) => {
    if (!client.admin) return;

    if (message === client.who) {
      userUtils.direct(client, "cmn:error", "Себя исключить нельзя");
      return;
    }
    const whom = userUtils.clientByWho(message);
    if (!whom) {
      userUtils.direct(client, "cmn:error", "Пользователь не найден");
      return;
    }
    if (whom.admin) {
      userUtils.direct(client, "cmn:error", "Админа исключить нельзя");
      return;
    }
    roomUtils.roomBroadcast(whom.rid, "mem:kick", whom.who);
    if (client.rid !== whom.rid) {
      userUtils.direct(client, "mem:kick", whom.who);
    }
    whom.disconnect();
  },
}

//-----------------------------------------------------------------------------------
// COMMON UTILS
const commonUtils = {
  authUser: (client, who, admin = false) => {
    client.admin = admin;
    client.who = who;
    client.rid = undefined;
    if (admin) {
      userUtils.direct(client, "client:list", userUtils.totalClientsNames());
    }
    userUtils.direct(client, "room:list", roomUtils.roomsData());
    clients.add(client);
    userUtils.direct(client, "auth:ok", admin);
    adminUtils.adminBroadcast("client:new", who);
    userUtils.totalBroadcast("client:count", clients.size);
    roomUtils.enterRoom(client, 0, config.notify);
    console.log(`${admin ? "Админ." : "Пользователь"} авторизован: ${who} (${client.id})`);
  },
}

// ROOMS UTILS
const roomUtils = {
  checkRid: function (rid) {
    if (rid === undefined) return false;
    if (rooms.length === 0) return false;
    if (rid >= rooms.length || rid < 0) return false;
    return true;
  },
  forceLeaveRoom: (client, rid) => {
    client.rid = undefined;
    if (!roomUtils.checkRid(rid)) return;
    if (rooms[rid].mems.delete(client)) {
      roomUtils.roomBroadcast(rid, "mem:del", client.who);
      roomUtils.roomBroadcast(rid, "mem:count", rooms[rid].mems.size);
    }
  },
  leaveRoom: (client) => {
    roomUtils.forceLeaveRoom(client, client.rid);
  },
  enterRoom: (client, rid, notify = undefined) => {
    userUtils.direct(client, "room:change:ok", rid);
    userUtils.direct(client, "mem:list", roomUtils.roomMembersNames(rid));
    client.rid = rid;
    rooms[rid].mems.add(client);
    if (rid in historyPool.pool){
      userUtils.direct(client, "history:list", historyPool.get(rid));
    }
    roomUtils.roomBroadcast(rid, "mem:new", client.who);
    roomUtils.roomBroadcast(rid, "mem:count", rooms[rid].mems.size);
    if (notify) {
      userUtils.direct(client, "msg:msg", ["Сервер", config.notify]);
    }
  },
  roomMembersNames: (rid) => {
    if (!roomUtils.checkRid(rid)) return;
    const list = [];
    rooms[rid].mems.forEach((member)=>{
      list.push(member.who);
    })
    return list;
  },
  roomMemberByWho: (rid, who) => {
    if (!roomUtils.checkRid(rid)) return undefined;
    for (let member of rooms[rid].mems) {
      if (member.who === who) {
        return member;
      } 
    }
    return undefined;
  },
  roomsData: () => {
    const list = [];
    rooms.forEach((room, rid)=>{
      list.push({title: room.title, rid: rid});
    })
    return list;
  },
  roomBroadcast: (rid, mode, data = undefined) => {
    if (!roomUtils.checkRid(rid)) return;
    historyPool.push(rid, mode, data);
    for (let member of rooms[rid].mems) {
      userUtils.direct(member, mode, data);
    }
  },
}

// USERS UTILS
const userUtils = {
  direct: (client, mode, data = undefined) => {
    if (data === undefined) return client.emit(mode);
    return client.emit(mode, data);
  },
  totalBroadcast: (mode, data = undefined) => {
    for (let client of clients) {
      userUtils.direct(client, mode, data);
    }
  },
  totalClientsNames: () => {
    const list = [];
    clients.forEach((client)=>{
      list.push(client.who);
    })
    return list;
  },
  clientByWho: (who) => {
    for (let client of clients) {
      if (client.who === who) {
        return client;
      } 
    }
    return undefined;
  },
}

// ADMINS UTILS
const adminUtils = {
  isAdmin: (who) => {
    return (who in admins);
  },
  adminCheckPass: (who, hashpass) => {
    if (!adminUtils.isAdmin(who)) return false;
    return (admins[who] === hashpass);
  },
  adminBroadcast: (mode, data) => {
    for (let client of clients) {
      if (adminUtils.isAdmin(client.who)){
        userUtils.direct(client, mode, data);
      }
    }
  },
}