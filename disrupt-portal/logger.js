"use strict";

const pino = require("pino");

const isDev = process.env.NODE_ENV === "development" || !process.env.NODE_ENV;
const isTest = process.env.NODE_ENV === "test";

const logger = pino({
  level: isTest ? "silent" : (process.env.LOG_LEVEL || (isDev ? "debug" : "info")),
  ...(isDev && !isTest && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:HH:MM:ss.l",
        ignore: "pid,hostname",
        messageFormat: "{msg}",
      },
    },
  }),
});

module.exports = logger;
