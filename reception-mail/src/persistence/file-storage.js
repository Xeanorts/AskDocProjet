/**
 * File Storage Service
 * Handles saving emails to JSON files on disk
 */

import fs from 'fs/promises';
import path from 'path';
import { existsSync } from 'fs';
import logger from '../utils/logger.js';

/**
 * FileStorage class for managing email storage
 */
class FileStorage {
  constructor(basePath = null) {
    this.basePath = basePath || process.env.STORAGE_PATH || '/app/storage';
    this.outputDir = process.env.MAIL_OUTPUT_DIR || '00_mail_in';
    this.initialized = false;
  }

  getBasePath() {
    return this.basePath;
  }

  getOutputDir() {
    return this.outputDir;
  }

  getFullPath() {
    return path.join(this.basePath, this.outputDir);
  }

  /**
   * Initialize storage directory
   */
  async initialize() {
    try {
      const fullPath = this.getFullPath();
      if (!existsSync(fullPath)) {
        await fs.mkdir(fullPath, { recursive: true });
        logger.info(`📁 Created storage directory: ${fullPath}`);
      }
      this.initialized = true;
      logger.info(`✅ File storage initialized at: ${fullPath}`);
    } catch (error) {
      logger.error('Failed to initialize file storage:', error.message);
      throw error;
    }
  }

  /**
   * Generate a unique filename for an email
   * Format: YYYYMMDD_HHMMSS_<uuid>.json
   */
  generateFilename(emailId, date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');

    return `${year}${month}${day}_${hours}${minutes}${seconds}_${emailId}.json`;
  }

  /**
   * Save an email to a JSON file
   * @param {Object} email - Email data to save
   * @returns {Promise<string>} - Path to saved file
   */
  async saveEmail(email) {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const filename = this.generateFilename(email.id, new Date(email.date));
      const filepath = path.join(this.getFullPath(), filename);

      // Convert email to JSON with pretty formatting
      const jsonContent = JSON.stringify(email, null, 2);

      // Write to file
      await fs.writeFile(filepath, jsonContent, 'utf8');

      logger.info(`💾 Email saved: ${filename}`);
      return filepath;
    } catch (error) {
      logger.error('Failed to save email:', error.message);
      throw error;
    }
  }

  /**
   * Read an email from a JSON file
   * @param {string} filename - Filename or full path
   * @returns {Promise<Object>} - Email data
   */
  async readEmail(filename) {
    try {
      const filepath = path.isAbsolute(filename)
        ? filename
        : path.join(this.getFullPath(), filename);

      const content = await fs.readFile(filepath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      logger.error(`Failed to read email ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * List all stored emails
   * @returns {Promise<Array>} - Array of filenames
   */
  async listEmails() {
    if (!this.initialized) {
      await this.initialize();
    }

    try {
      const files = await fs.readdir(this.getFullPath());
      return files
        .filter(file => file.endsWith('.json'))
        .sort()
        .reverse(); // Most recent first
    } catch (error) {
      logger.error('Failed to list emails:', error.message);
      throw error;
    }
  }

  /**
   * Get email count
   * @returns {Promise<number>}
   */
  async getCount() {
    const emails = await this.listEmails();
    return emails.length;
  }

  /**
   * Delete an email file
   * @param {string} filename - Filename to delete
   */
  async deleteEmail(filename) {
    try {
      const filepath = path.isAbsolute(filename)
        ? filename
        : path.join(this.getFullPath(), filename);

      await fs.unlink(filepath);
      logger.info(`🗑️  Email deleted: ${filename}`);
    } catch (error) {
      logger.error(`Failed to delete email ${filename}:`, error.message);
      throw error;
    }
  }

  /**
   * Get storage statistics
   */
  async getStats() {
    const files = await this.listEmails();
    let totalSize = 0;

    for (const file of files) {
      const filepath = path.join(this.getFullPath(), file);
      const stats = await fs.stat(filepath);
      totalSize += stats.size;
    }

    return {
      emailCount: files.length,
      totalSizeBytes: totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      storagePath: this.getFullPath()
    };
  }
}

// Export a singleton instance
export default new FileStorage();
