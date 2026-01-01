/**
 * Module Email Send - Entry Point
 * Simple SMTP email sending service
 */

import { MailSenderService } from './services/mail-sender-service.js';
import logger from './utils/logger.js';

// Global mail sender instance
let mailSender = null;

/**
 * Load and validate configuration
 */
function loadConfig() {
  const config = {
    timeout: parseInt(process.env.EMAIL_SEND_TIMEOUT_MS || '30000', 10),
    smtp: {
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      user: process.env.SMTP_USER,
      password: process.env.SMTP_PASSWORD,
      from: process.env.SMTP_FROM_EMAIL,
      fromName: process.env.SMTP_FROM_NAME || 'AI Email Service',
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false' // true par défaut
    }
  };

  return config;
}

/**
 * Validate SMTP configuration
 */
function validateSmtpConfig(config) {
  const required = ['host', 'port', 'user', 'password', 'from'];
  const missing = required.filter(key => !config.smtp[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required SMTP config: ${missing.join(', ')}`);
  }

  logger.info(`[EMAIL-SEND] SMTP config validated: ${config.smtp.host}:${config.smtp.port}`);
}

/**
 * Initialize the email sending service
 * @returns {Promise<MailSenderService>}
 */
export async function initEmailService() {
  if (mailSender) {
    return mailSender;
  }

  logger.info('[EMAIL-SEND] Initializing email service...');

  try {
    // Load config
    const config = loadConfig();

    // Validate SMTP config
    validateSmtpConfig(config);

    // Create mail sender
    mailSender = new MailSenderService(config, logger);

    // Verify SMTP connection
    const connectionOk = await mailSender.verifyConnection();
    if (!connectionOk) {
      throw new Error('SMTP connection failed - check credentials');
    }

    logger.info('[EMAIL-SEND] Email service initialized successfully');

    return mailSender;

  } catch (error) {
    logger.error('[EMAIL-SEND] Failed to initialize service:', error.message);
    throw error;
  }
}

/**
 * Send an email
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} body - Email body (plain text)
 * @param {Array} attachments - Optional array of attachments [{filename, content_base64}]
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function sendEmail(to, subject, body, attachments = []) {
  try {
    // Initialize service if not already done
    if (!mailSender) {
      await initEmailService();
    }

    // Send email
    return await mailSender.sendEmail(to, subject, body, attachments);

  } catch (error) {
    logger.error('[EMAIL-SEND] Failed to send email:', error.message);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Close the email service
 */
export function closeEmailService() {
  if (mailSender) {
    mailSender.close();
    mailSender = null;
    logger.info('[EMAIL-SEND] Email service closed');
  }
}

export default {
  initEmailService,
  sendEmail,
  closeEmailService
};
