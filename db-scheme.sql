CREATE DATABASE wsc;
USE wsc;

DROP TABLE IF EXISTS admins;
DROP TABLE IF EXISTS rooms;

CREATE TABLE IF NOT EXISTS admins (
    admin_id    INTEGER AUTO_INCREMENT,
    name        VARCHAR(70) NOT NULL UNIQUE,
    passhash    VARCHAR(70) NOT NULL,

    PRIMARY KEY (admin_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS rooms (
    room_id     INTEGER AUTO_INCREMENT,
    title       VARCHAR(70) NOT NULL UNIQUE,
    history     TINYINT DEFAULT 0,

    PRIMARY KEY (room_id)
) ENGINE=InnoDB;