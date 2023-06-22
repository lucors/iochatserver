const config = {};

config.debug = false;
config.db = {
    host: "localhost",
    user: "root",
    database: "wsc",
    password: "root"
};
config.msg = {
    slice: 500
};
config.who = {
    unavailableNames: [":","?","сервер", "server"],
    slice: 50
}
config.historySlice = {
    count: 50,
    time: 1800*1000,
};
config.notify = `Добро пожаловать в<br><strong>Socket.io Chat!</strong>`;

module.exports = config;