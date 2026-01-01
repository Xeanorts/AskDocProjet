/**
 * Project Name - Module Réception (Entry Point)
 * IMAP sync service that saves emails to JSON files
 */

import dotenv from 'dotenv';
import { startImapSync } from './imap/imap-sync.js';
import logger from './utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Main application function
 */
async function main() {
  // Check IMAP credentials (only fail fast on missing config)
  if (!process.env.IMAP_HOST || !process.env.IMAP_USER || !process.env.IMAP_PASSWORD) {
    logger.error('❌ IMAP credentials missing!');
    logger.error('Please configure the following in .env:');
    logger.error('  - IMAP_HOST (e.g., ssl0.ovh.net)');
    logger.error('  - IMAP_USER (e.g., user@domain.com)');
    logger.error('  - IMAP_PASSWORD');
    logger.error('');
    logger.error('Copy .env.example to .env and edit it with your credentials.');
    process.exit(1);
  }

  logger.info('📬 Starting IMAP Mail Sync Service...');
  logger.info('');

  try {
    // Start IMAP sync (this will handle its own errors and reconnections)
    await startImapSync();

    logger.info('');
    logger.info('✅ IMAP Mail Sync Service is ready!');
    logger.info(`📡 Server: ${process.env.IMAP_HOST}`);
    logger.info(`📧 User: ${process.env.IMAP_USER}`);
    logger.info(`🔄 Sync interval: ${(parseInt(process.env.IMAP_SYNC_INTERVAL || '300000') / 60000)} minutes`);
    logger.info('💾 Storage: ' + (process.env.STORAGE_PATH || './storage/emails'));
    logger.info('');
    logger.info('ℹ️  Service will automatically reconnect on connection errors');
    logger.info('');

  } catch (error) {
    // This should rarely happen now, as syncEmails() handles errors internally
    // Only log and continue - the service will retry on next cycle
    logger.warn('⚠️  Initial sync failed, will retry on next cycle:', error.message);
    logger.info('');
    logger.info('✅ IMAP Mail Sync Service is running');
    logger.info(`📡 Server: ${process.env.IMAP_HOST}`);
    logger.info(`📧 User: ${process.env.IMAP_USER}`);
    logger.info(`🔄 Sync interval: ${(parseInt(process.env.IMAP_SYNC_INTERVAL || '300000') / 60000)} minutes`);
    logger.info('💾 Storage: ' + (process.env.STORAGE_PATH || './storage/emails'));
    logger.info('');
  }
}

// Start the application
main();
