/**
 * File Storage Service
 *
 * Handles reading/writing ia_result.json files for email sending.
 * Manages: 30_ia_results/ (read + atomic update)
 */

import { readFile, writeFile, readdir, rename, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

export class FileStorage {
  constructor(config, logger) {
    this.storagePath = config.storagePath || process.env.STORAGE_PATH || '/app/storage';
    this.resultsDir = join(this.storagePath, '30_ia_results');
    this.exportsDir = join(this.storagePath, '40_exports');
    this.logger = logger || console;

    this.logger.info(`[EMAIL-SEND] FileStorage initialized: ${this.resultsDir}`);
  }

  /**
   * List ia_result files eligible for email sending
   *
   * Criteria:
   * - status === "ok"
   * - pptx_download?.success === true
   * - email_sent !== true (idempotence)
   * - PPTX file exists on disk
   *
   * @returns {Promise<string[]>} Array of filenames (not full paths)
   */
  async listUnsentEmails() {
    try {
      if (!existsSync(this.resultsDir)) {
        this.logger.warn(`[EMAIL-SEND] Results directory not found: ${this.resultsDir}`);
        return [];
      }

      const files = await readdir(this.resultsDir);
      const resultFiles = files.filter(f => f.endsWith('.ia_result.json'));

      if (resultFiles.length === 0) {
        return [];
      }

      const eligible = [];

      for (const filename of resultFiles) {
        try {
          const result = await this.readIAResult(filename);

          // Check eligibility criteria
          const isEligible =
            result.status === 'ok' &&
            result.pptx_download?.success === true &&
            result.email_sent !== true;

          if (isEligible) {
            // Verify PPTX file exists
            const pptxPath = result.pptx_download.file_path;
            if (pptxPath && existsSync(pptxPath)) {
              eligible.push(filename);
            } else {
              this.logger.warn(`[EMAIL-SEND] PPTX file missing for ${result.email_id}: ${pptxPath}`);
            }
          }
        } catch (error) {
          this.logger.warn(`[EMAIL-SEND] Failed to read ${filename}: ${error.message}`);
        }
      }

      this.logger.debug(`[EMAIL-SEND] Found ${eligible.length} unsent emails (${resultFiles.length} total)`);
      return eligible;

    } catch (error) {
      this.logger.error('[EMAIL-SEND] Error listing unsent emails:', error.message);
      return [];
    }
  }

  /**
   * Read ia_result file
   *
   * @param {string} filename - Filename (not full path)
   * @returns {Promise<Object>} Parsed JSON
   */
  async readIAResult(filename) {
    const filepath = join(this.resultsDir, filename);
    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Update ia_result file with email status (atomic write)
   *
   * @param {string} emailId - Email UUID
   * @param {Object} emailResult - Email sending result
   * @param {boolean} emailResult.success - Email sent successfully
   * @param {string|null} emailResult.to - Recipient email
   * @param {string|null} emailResult.error - Error message if failed
   */
  async updateEmailSentStatus(emailId, emailResult) {
    const filename = `${emailId}.ia_result.json`;
    const filepath = join(this.resultsDir, filename);
    const tempPath = `${filepath}.tmp`;

    try {
      // 1. Read existing file
      const existing = await this.readIAResult(filename);

      // 2. Enrich with email fields (don't overwrite existing fields)
      const updated = {
        ...existing,
        pipeline_status: emailResult.success ? 'email_completed' : 'email_error',
        email_sent: emailResult.success,
        email_to: emailResult.to || null,
        email_sent_at: emailResult.success ? new Date().toISOString() : null,
        email_error: emailResult.error || null
      };

      // 3. Write to temp file
      await writeFile(tempPath, JSON.stringify(updated, null, 2), 'utf-8');

      // 4. Atomic rename
      await rename(tempPath, filepath);

      this.logger.debug(`[EMAIL-SEND] Updated ${filename} with email status`);

    } catch (error) {
      this.logger.error(`[EMAIL-SEND] Failed to update ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * Get PPTX file path for email
   *
   * @param {Object} iaResult - IA result object
   * @returns {string|null} PPTX file path or null
   */
  getPptxPath(iaResult) {
    return iaResult.pptx_download?.file_path || null;
  }

  /**
   * Get recipient email from IA result
   *
   * @param {Object} iaResult - IA result object
   * @returns {string|null} Recipient email or null
   */
  getRecipientEmail(iaResult) {
    return iaResult.from || null;
  }

  /**
   * Get original subject from IA result
   *
   * @param {Object} iaResult - IA result object
   * @returns {string} Original email subject
   */
  getOriginalSubject(iaResult) {
    return iaResult.subject || '(no subject)';
  }
}

// Singleton instance
const fileStorage = new FileStorage({}, console);
export default fileStorage;
