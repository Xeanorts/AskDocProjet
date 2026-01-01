/**
 * Logger Utility
 *
 * Simple console-based logger with level filtering.
 */

const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
};

const currentLevel = levels[LOG_LEVEL] || levels.info;

function shouldLog(level) {
  return levels[level] >= currentLevel;
}

function formatMessage(level, ...args) {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] [${level.toUpperCase()}] ${args.join(' ')}`;
}

const logger = {
  debug: (...args) => {
    if (shouldLog('debug')) {
      console.log(formatMessage('debug', ...args));
    }
  },

  info: (...args) => {
    if (shouldLog('info')) {
      console.log(formatMessage('info', ...args));
    }
  },

  warn: (...args) => {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', ...args));
    }
  },

  error: (...args) => {
    if (shouldLog('error')) {
      console.error(formatMessage('error', ...args));
    }
  }
};

export default logger;
