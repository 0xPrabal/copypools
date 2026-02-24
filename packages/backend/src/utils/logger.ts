import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.NODE_ENV === 'production' ? 'info' : 'debug',
  serializers: {
    error: (err: unknown) => {
      if (err instanceof Error) {
        return { message: err.message, stack: err.stack, name: err.name };
      }
      if (typeof err === 'object' && err !== null && 'message' in err) {
        return err;
      }
      return { message: String(err) };
    },
  },
  transport:
    config.NODE_ENV === 'development'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});
