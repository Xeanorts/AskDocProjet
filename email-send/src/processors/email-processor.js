/**
 * Email Processor
 *
 * Main orchestration logic for sending PPTX emails.
 * MVP patterns: 1 email/cycle, no crash, idempotent
 */

export class EmailProcessor {
  constructor(fileStorage, mailSender, config, logger) {
    this.fileStorage = fileStorage;
    this.mailSender = mailSender;
    this.config = config;
    this.logger = logger;
    this.isRunning = false;
    this.isRunningCycle = false;
    this.timer = null;
    this.pollIntervalMs = parseInt(process.env.EMAIL_SEND_POLL_INTERVAL_SECONDS || '60', 10) * 1000;
    this.mode = process.env.EMAIL_SEND_MODE || 'dry_run';
  }

  start() {
    this.logger.info('[EMAIL-SEND] Processor starting...');
    this.isRunning = true;
    this.timer = setInterval(async () => {
      await this.processCycleWithGuard();
    }, this.pollIntervalMs);
    this.processCycleWithGuard();
    this.logger.info(`[EMAIL-SEND] Processor started (polling every ${this.pollIntervalMs / 1000}s)`);
  }

  stop() {
    this.logger.info('[EMAIL-SEND] Processor stopping...');
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.mailSender) {
      this.mailSender.close();
    }
    this.logger.info('[EMAIL-SEND] Processor stopped');
  }

  async processCycleWithGuard() {
    if (this.isRunningCycle) {
      this.logger.debug('[EMAIL-SEND] Previous cycle still running, skipping');
      return;
    }
    this.isRunningCycle = true;
    try {
      await this.processCycle();
    } catch (error) {
      this.logger.error('[EMAIL-SEND] Unexpected error in cycle wrapper:', error);
    } finally {
      this.isRunningCycle = false;
    }
  }

  async processCycle() {
    let filename = null;
    let emailId = null;

    try {
      if (this.mode !== 'live') {
        this.logger.debug('[EMAIL-SEND] Skipped (not in live mode)');
        return;
      }

      const unsent = await this.fileStorage.listUnsentEmails();
      if (unsent.length === 0) {
        this.logger.debug('[EMAIL-SEND] No unsent emails');
        return;
      }

      filename = unsent[0];
      this.logger.info(`[EMAIL-SEND] Processing ${filename} (${unsent.length} unsent)`);

      const iaResult = await this.fileStorage.readIAResult(filename);
      emailId = iaResult.email_id;

      const recipientEmail = this.fileStorage.getRecipientEmail(iaResult);
      const originalSubject = this.fileStorage.getOriginalSubject(iaResult);
      const pptxPath = this.fileStorage.getPptxPath(iaResult);

      if (!recipientEmail) {
        this.logger.error(`[EMAIL-SEND] No recipient email for ${emailId}`);
        await this.fileStorage.updateEmailSentStatus(emailId, {
          success: false, to: null,
          error: 'No recipient email found in ia_result'
        });
        return;
      }

      if (!pptxPath) {
        this.logger.error(`[EMAIL-SEND] No PPTX path for ${emailId}`);
        await this.fileStorage.updateEmailSentStatus(emailId, {
          success: false, to: recipientEmail,
          error: 'No PPTX file path in ia_result'
        });
        return;
      }

      this.logger.info(`[EMAIL-SEND] Sending to ${recipientEmail} for ${emailId}`);
      const emailResult = await this.mailSender.sendPptxEmail(emailId, recipientEmail, originalSubject, pptxPath);

      await this.fileStorage.updateEmailSentStatus(emailId, {
        success: emailResult.success,
        to: recipientEmail,
        error: emailResult.error
      });

      if (emailResult.success) {
        this.logger.info(`[EMAIL-SEND] Success: ${emailId} → ${recipientEmail}`);
      } else {
        this.logger.error(`[EMAIL-SEND] Failed: ${emailId} - ${emailResult.error}`);
      }

    } catch (error) {
      this.logger.error('[EMAIL-SEND] Cycle error:', error.message);
      this.logger.error('[EMAIL-SEND] Stack:', error.stack);

      if (emailId) {
        try {
          await this.fileStorage.updateEmailSentStatus(emailId, {
            success: false, to: null,
            error: `Processor error: ${error.message}`
          });
          this.logger.info(`[EMAIL-SEND] Error logged → 30_ia_results/${emailId}.ia_result.json`);
        } catch (writeError) {
          this.logger.error('[EMAIL-SEND] Failed to write error result:', writeError.message);
        }
      } else {
        this.logger.error(`[EMAIL-SEND] Critical error processing ${filename || 'unknown file'}`);
      }
    }
  }
}

export default EmailProcessor;
