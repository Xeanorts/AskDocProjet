/**
 * Mail Sender Service
 * Simple SMTP service using nodemailer
 */

import nodemailer from 'nodemailer';

export class MailSenderService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger || console;
    this.timeout = parseInt(config.timeout || process.env.EMAIL_SEND_TIMEOUT_MS || '30000', 10);

    // Create SMTP transporter
    this.transporter = nodemailer.createTransport({
      host: config.smtp.host,
      port: config.smtp.port,
      secure: config.smtp.secure, // true for 465, false for other ports (STARTTLS)
      auth: {
        user: config.smtp.user,
        pass: config.smtp.password
      },
      connectionTimeout: this.timeout,
      greetingTimeout: this.timeout,
      socketTimeout: this.timeout,
      tls: {
        rejectUnauthorized: config.smtp.rejectUnauthorized // Configurable for self-signed certs
      }
    });

    this.logger.info(`[EMAIL-SEND] SMTP transporter configured: ${config.smtp.host}:${config.smtp.port}`);
  }

  /**
   * Send a text email with optional attachments
   * @param {string} to - Recipient email address
   * @param {string} subject - Email subject
   * @param {string} body - Email body (plain text)
   * @param {Array} attachments - Optional array of attachments [{filename, content_base64}]
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async sendEmail(to, subject, body, attachments = []) {
    const startTime = Date.now();

    this.logger.info(`[EMAIL-SEND] Sending email to ${to}`);

    try {
      // Configure email
      const mailOptions = {
        from: {
          name: this.config.smtp.fromName || 'AI Email Service',
          address: this.config.smtp.from
        },
        to: to,
        subject: subject,
        text: body
      };

      // Add attachments if provided
      if (attachments && attachments.length > 0) {
        mailOptions.attachments = attachments.map(att => ({
          filename: att.filename,
          content: Buffer.from(att.content_base64, 'base64')
        }));
        this.logger.info(`[EMAIL-SEND] Including ${attachments.length} attachment(s)`);
      }

      // Send email
      this.logger.info(`[EMAIL-SEND] Sending...`);
      const info = await this.transporter.sendMail(mailOptions);

      const duration = Date.now() - startTime;
      this.logger.info(`[EMAIL-SEND] Email sent to ${to} (${duration}ms)`);
      this.logger.debug(`[EMAIL-SEND] Message ID: ${info.messageId}`);

      return {
        success: true,
        error: null
      };

    } catch (error) {
      const duration = Date.now() - startTime;
      this.logger.error(`[EMAIL-SEND] Failed to send email (${duration}ms): ${error.message}`);
      this.logger.error(`[EMAIL-SEND] Error details:`, error);

      return {
        success: false,
        error: error.message || 'Unknown SMTP error'
      };
    }
  }

  /**
   * Verify SMTP connection (for startup validation)
   * @returns {Promise<boolean>}
   */
  async verifyConnection() {
    try {
      this.logger.info('[EMAIL-SEND] Verifying SMTP connection...');
      await this.transporter.verify();
      this.logger.info('[EMAIL-SEND] SMTP connection verified successfully');
      return true;
    } catch (error) {
      this.logger.error(`[EMAIL-SEND] SMTP connection failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Close transporter (cleanup)
   */
  close() {
    if (this.transporter) {
      this.transporter.close();
      this.logger.debug('[EMAIL-SEND] SMTP transporter closed');
    }
  }
}

export default MailSenderService;
