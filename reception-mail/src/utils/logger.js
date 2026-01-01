/**
 * Simple logger utility
 * Provides formatted console logging with timestamps
 */

const LOG_LEVELS = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR'
};

class Logger {
  constructor() {
    this.level = process.env.LOG_LEVEL || 'INFO';
  }

  /**
   * Format a log message with timestamp and level
   */
  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.length > 0 ? ' ' + JSON.stringify(args) : '';
    return `[${timestamp}] [${level}] ${message}${formattedArgs}`;
  }

  debug(message, ...args) {
    if (this.level === 'DEBUG') {
      console.log(this.formatMessage(LOG_LEVELS.DEBUG, message, ...args));
    }
  }

  info(message, ...args) {
    console.log(this.formatMessage(LOG_LEVELS.INFO, message, ...args));
  }

  warn(message, ...args) {
    console.warn(this.formatMessage(LOG_LEVELS.WARN, message, ...args));
  }

  error(message, ...args) {
    console.error(this.formatMessage(LOG_LEVELS.ERROR, message, ...args));
  }
}

// Export a singleton instance
export default new Logger();
