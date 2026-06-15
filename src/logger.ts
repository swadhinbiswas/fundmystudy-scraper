import pino from 'pino';
import { getConfig } from './config.js';

const cfg = getConfig();

const isDev = cfg.NODE_ENV === 'development' || cfg.NODE_ENV === 'test';

export const logger = pino({
  level: cfg.LOG_LEVEL,
  base: { service: 'fundmystudy-bot', env: cfg.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
  ...(isDev
    ? {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss.l',
            ignore: 'pid,hostname,service,env',
          },
        },
      }
    : {}),
});

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
