/**
 * Simple logger utility
 * Provides formatted console logging with timestamps
 */

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

class Logger {
  private level: string;

  constructor() {
    this.level = process.env.LOG_LEVEL || 'INFO';
  }

  private formatMessage(level: string, message: string, ...args: unknown[]): string {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  debug(message: string, ...args: unknown[]): void {
    if (this.level === 'DEBUG') {
      console.log(this.formatMessage(LOG_LEVELS.DEBUG, message, ...args));
    }
  }

  info(message: string, ...args: unknown[]): void {
    console.log(this.formatMessage(LOG_LEVELS.INFO, message, ...args));
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(this.formatMessage(LOG_LEVELS.WARN, message, ...args));
  }

  error(message: string, ...args: unknown[]): void {
    console.error(this.formatMessage(LOG_LEVELS.ERROR, message, ...args));
  }
}

export default new Logger();
