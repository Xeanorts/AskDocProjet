/**
 * IMAP Synchronization Service
 * Syncs emails from Zimbra IMAP to local JSON storage
 */

import Imap from 'imap';
import { simpleParser } from 'mailparser';
import logger from '../utils/logger.js';
import fileStorage from '../persistence/file-storage.js';
import { createEmailFromParsed } from '../parser/email-parser.js';

class ImapSyncService {
  constructor(config) {
    this.config = {
      user: config.user || process.env.IMAP_USER,
      password: config.password || process.env.IMAP_PASSWORD,
      host: config.host || process.env.IMAP_HOST,
      port: parseInt(config.port || process.env.IMAP_PORT || '993'),
      tls: config.tls !== false,
      tlsOptions: {
        rejectUnauthorized: process.env.IMAP_REJECT_UNAUTHORIZED === 'true' // false par défaut (rétrocompatible)
      }
    };

    this.imap = null;
    this.isConnected = false;
    this.syncInterval = parseInt(process.env.IMAP_SYNC_INTERVAL || '300000'); // 5 minutes
    this.syncTimer = null;
    this.mailbox = process.env.IMAP_MAILBOX || 'INBOX';
    this.markAsRead = process.env.IMAP_MARK_AS_READ !== 'false';

    // Mutex for sync operations
    this.isSyncing = false;
    this.skippedSyncs = 0;
  }

  /**
   * Start the sync service
   */
  async start() {
    logger.info('📬 Starting IMAP Sync Service...');
    logger.info(`   Host: ${this.config.host}:${this.config.port}`);
    logger.info(`   User: ${this.config.user}`);
    logger.info(`   Mailbox: ${this.mailbox}`);
    logger.info(`   Sync interval: ${this.syncInterval / 1000}s (${this.syncInterval / 60000} minutes)`);
    logger.info(`   Mark as read: ${this.markAsRead}`);

    // Initial sync
    await this.syncEmails();

    // Schedule periodic sync
    // Note: syncEmails() handles all errors internally and never throws
    this.syncTimer = setInterval(() => {
      this.syncEmails();
    }, this.syncInterval);

    logger.info('✅ IMAP Sync Service started');
  }

  /**
   * Stop the sync service
   */
  stop() {
    logger.info('🛑 Stopping IMAP Sync Service...');

    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }

    this.disconnect();

    logger.info('✅ IMAP Sync Service stopped');
  }

  /**
   * Disconnect from IMAP server
   */
  disconnect() {
    if (this.imap) {
      try {
        this.imap.end();
      } catch (err) {
        logger.debug('Error closing IMAP connection:', err.message);
      }
      this.imap = null;
    }
    this.isConnected = false;
  }

  /**
   * Connect to IMAP server
   */
  connect() {
    return new Promise((resolve, reject) => {
      if (this.isConnected && this.imap) {
        return resolve();
      }

      // Clean up any existing connection
      this.disconnect();

      this.imap = new Imap(this.config);

      this.imap.once('ready', () => {
        this.isConnected = true;
        logger.debug('📡 IMAP connection ready');
        resolve();
      });

      this.imap.once('error', (err) => {
        this.isConnected = false;
        this.imap = null;
        logger.debug('IMAP connection error:', err.message);
        reject(err);
      });

      this.imap.once('end', () => {
        this.isConnected = false;
        logger.debug('📡 IMAP connection ended');
      });

      this.imap.connect();
    });
  }

  /**
   * Attempt to reconnect after a delay
   */
  async attemptReconnect(delayMs = 5000) {
    logger.info(`⏳ Waiting ${delayMs / 1000}s before reconnecting...`);
    await new Promise(resolve => setTimeout(resolve, delayMs));

    try {
      await this.connect();
      logger.info('✅ IMAP reconnected successfully');
      return true;
    } catch (error) {
      logger.error('❌ IMAP reconnection failed:', error.message);
      return false;
    }
  }

  /**
   * Check if error is a network or authentication error
   */
  isRecoverableError(error) {
    const recoverableErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'ECONNREFUSED',
      'Not authenticated',
      'Connection lost',
      'No supported authentication'
    ];

    // Convert error message to string (IMAP errors can be arrays)
    const errorMessage = Array.isArray(error.message)
      ? error.message.join(' ')
      : String(error.message || '');

    return recoverableErrors.some(errType =>
      errorMessage.includes(errType) || error.code === errType
    );
  }

  /**
   * Synchronize emails from IMAP server
   */
  async syncEmails() {
    // Mutex: prevent concurrent sync operations
    if (this.isSyncing) {
      this.skippedSyncs++;
      if (this.skippedSyncs % 5 === 0) { // Log every 5 skips
        logger.warn(`Sync skipped (${this.skippedSyncs} total) - previous still running`);
      }
      return;
    }

    this.isSyncing = true;
    this.skippedSyncs = 0;

    try {
      logger.debug('🔄 Starting email sync...');

      await this.connect();

      // Open mailbox
      await this.openMailbox();

      // Search for unseen emails
      const unseenUids = await this.searchUnseenEmails();

      if (unseenUids.length === 0) {
        logger.debug('✅ No new emails to sync');
        this.disconnect();
        return;
      }

      logger.info(`📧 Found ${unseenUids.length} new email(s)`);

      // Fetch and process emails
      await this.fetchAndProcessEmails(unseenUids);

      this.disconnect();
      logger.debug('✅ Email sync completed');

    } catch (error) {
      // Always disconnect on error
      this.disconnect();

      // Convert error message to string (IMAP errors can be arrays)
      const errorMessage = Array.isArray(error.message)
        ? error.message.join(' ')
        : String(error.message || 'Unknown error');

      // Check if this is a recoverable error
      if (this.isRecoverableError(error)) {
        // Log appropriate warning based on error type
        if (errorMessage.includes('Not authenticated') || errorMessage.includes('No supported authentication')) {
          logger.warn('⚠️  IMAP authentication failed, will retry on next cycle');
        } else if (error.code === 'ECONNRESET' || errorMessage.includes('Connection lost')) {
          logger.warn(`⚠️  IMAP connection lost (${error.code || errorMessage}), attempting reconnect...`);
          // Attempt one reconnection
          await this.attemptReconnect();
        } else {
          logger.warn(`⚠️  IMAP connection error (${errorMessage}), will retry on next cycle`);
        }
      } else {
        // Non-recoverable error, log as error but still don't crash
        logger.error('❌ Email sync failed:', errorMessage);
      }

      // IMPORTANT: Do not throw error - let the service continue running
      // The next sync cycle will retry automatically
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Open mailbox
   */
  openMailbox() {
    return new Promise((resolve, reject) => {
      this.imap.openBox(this.mailbox, false, (err, box) => {
        if (err) {
          logger.error(`❌ Failed to open mailbox ${this.mailbox}:`, err.message);
          reject(err);
        } else {
          logger.debug(`📬 Opened mailbox: ${this.mailbox}`);
          resolve(box);
        }
      });
    });
  }

  /**
   * Search for unseen emails
   */
  searchUnseenEmails() {
    return new Promise((resolve, reject) => {
      this.imap.search(['UNSEEN'], (err, results) => {
        if (err) {
          logger.error('❌ Search failed:', err.message);
          reject(err);
        } else {
          resolve(results || []);
        }
      });
    });
  }

  /**
   * Fetch and process emails
   */
  async fetchAndProcessEmails(uids) {
    return new Promise((resolve, reject) => {
      const fetch = this.imap.fetch(uids, {
        bodies: '',
        markSeen: this.markAsRead
      });

      let processed = 0;
      const errors = [];

      fetch.on('message', (msg, seqno) => {
        logger.debug(`📥 Fetching message ${seqno}`);

        msg.on('body', (stream, info) => {
          simpleParser(stream, async (err, parsed) => {
            if (err) {
              logger.error(`❌ Failed to parse email ${seqno}:`, err.message);
              errors.push(err);
              return;
            }

            try {
              // Convert parsed email to our Email model format
              const email = createEmailFromParsed(parsed);

              // Save to JSON storage
              await fileStorage.saveEmail(email);

              processed++;
              logger.info(`✅ Synced email: ${email.subject || '(no subject)'}`);
              logger.info(`   From: ${email.from?.address || 'unknown'}`);
              logger.info(`   Date: ${email.date}`);

            } catch (saveError) {
              logger.error(`❌ Failed to save email ${seqno}:`, saveError.message);
              errors.push(saveError);
            }
          });
        });

        msg.once('attributes', (attrs) => {
          logger.debug(`📋 Message ${seqno} attributes received`);
        });

        msg.once('end', () => {
          logger.debug(`✅ Message ${seqno} fetch completed`);
        });
      });

      fetch.once('error', (err) => {
        logger.error('❌ Fetch error:', err.message);
        reject(err);
      });

      fetch.once('end', () => {
        logger.info(`📊 Fetch completed: ${processed}/${uids.length} emails synced`);
        if (errors.length > 0) {
          logger.warn(`⚠️  ${errors.length} error(s) occurred during sync`);
        }
        resolve();
      });
    });
  }
}

// Singleton instance
let syncService = null;

/**
 * Create and start IMAP sync service
 */
export function createImapSyncService(config = {}) {
  if (!syncService) {
    syncService = new ImapSyncService(config);
  }
  return syncService;
}

/**
 * Start IMAP sync service
 */
export async function startImapSync(config = {}) {
  const service = createImapSyncService(config);
  await service.start();
  return service;
}

/**
 * Stop IMAP sync service
 */
export function stopImapSync() {
  if (syncService) {
    syncService.stop();
  }
}

export default {
  createImapSyncService,
  startImapSync,
  stopImapSync
};
