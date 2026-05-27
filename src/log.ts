import pino from 'pino';

export const log = pino({
  level: process.env.LOG_LEVEL ?? 'warn',
  transport: {
    target: 'pino-pretty',
    options: {
      destination: 2,
      colorize: Boolean(process.stderr.isTTY),
      ignore: 'pid,hostname,time',
      singleLine: true,
    },
  },
});
