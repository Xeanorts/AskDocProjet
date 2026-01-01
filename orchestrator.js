/**
 * Email Processing Orchestrator
 *
 * Workflow:
 * 1. Get new emails from reception-mail
 * 2. Process each email with traitement-ia (LLM)
 * 3. Send response email via email-send
 */

import { readdir, readFile, unlink, writeFile, mkdir, rename } from 'fs/promises';
import { join, basename } from 'path';
import dotenv from 'dotenv';

// Load environment
dotenv.config();

// Import modules
import { sendEmail, initEmailService } from './email-send/src/index.js';
import { processAskDocEmail, runCacheCleanup, runThreadCleanup } from './traitement-ia/dist/index.js';

// Configuration
const STORAGE_PATH = process.env.STORAGE_PATH || './storage';
const INPUT_DIR = join(STORAGE_PATH, '00_mail_in');
// Poll interval is short since we process all emails in one cycle
// No need to configure - just check frequently for new emails
const POLL_INTERVAL = 5000; // 5 seconds
const WHITELIST_CONFIG_PATH = './config/whitelist.json';
const QUARANTINE_PATH = join(STORAGE_PATH, 'quarantine');
const PROCESSED_IDS_PATH = join(STORAGE_PATH, 'processed_ids.json');

// LLM Timeout and Retry Configuration
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10);
const MAX_RETRIES = 3;
const RETRY_DELAYS = [30000, 60000, 120000]; // 30s, 1min, 2min

// Global state for mutex and shutdown
let isProcessing = false;
let skippedCycles = 0;
let isShuttingDown = false;
let pollInterval = null;

// Simple logger
const logger = {
  info: (...args) => console.log(new Date().toISOString(), '[ORCHESTRATOR]', ...args),
  error: (...args) => console.error(new Date().toISOString(), '[ORCHESTRATOR]', ...args),
  debug: (...args) => process.env.LOG_LEVEL === 'debug' && console.log(new Date().toISOString(), '[ORCHESTRATOR]', ...args),
  warn: (...args) => console.warn(new Date().toISOString(), '[ORCHESTRATOR]', ...args)
};

/**
 * Load whitelist configuration
 * @returns {Promise<Object>} Whitelist configuration
 * @throws {Error} If whitelist file is missing or invalid
 */
async function loadWhitelist() {
  try {
    const content = await readFile(WHITELIST_CONFIG_PATH, 'utf-8');
    const whitelist = JSON.parse(content);

    // Validate structure
    if (!whitelist.allowed_emails || !Array.isArray(whitelist.allowed_emails)) {
      throw new Error('Whitelist must contain "allowed_emails" array');
    }
    if (!whitelist.allowed_domains || !Array.isArray(whitelist.allowed_domains)) {
      throw new Error('Whitelist must contain "allowed_domains" array');
    }

    // Normalize all entries to lowercase
    whitelist.allowed_emails = whitelist.allowed_emails.map(email =>
      email.toLowerCase().trim()
    );
    whitelist.allowed_domains = whitelist.allowed_domains.map(domain =>
      domain.toLowerCase().trim()
    );

    logger.debug(`Whitelist reloaded: ${whitelist.allowed_emails.length} email(s), ${whitelist.allowed_domains.length} domain(s)`);
    return whitelist;

  } catch (error) {
    if (error.code === 'ENOENT') {
      logger.error(`❌ Whitelist file not found: ${WHITELIST_CONFIG_PATH}`);
      logger.error('   Create this file from whitelist.json.example');
    } else if (error instanceof SyntaxError) {
      logger.error(`❌ Whitelist file has invalid JSON: ${error.message}`);
    } else {
      logger.error(`❌ Failed to load whitelist: ${error.message}`);
    }
    throw new Error('Whitelist configuration error - refusing to start');
  }
}

/**
 * Check if an email address is whitelisted
 * @param {string} emailAddress - Email address to check
 * @param {Object} whitelist - Whitelist configuration
 * @returns {boolean} True if email is allowed
 */
function isEmailAllowed(emailAddress, whitelist) {
  // Normalize email address
  const normalizedEmail = emailAddress.toLowerCase().trim();

  // Check exact email match
  if (whitelist.allowed_emails.includes(normalizedEmail)) {
    return true;
  }

  // Check domain match
  const emailDomain = normalizedEmail.split('@')[1];
  if (!emailDomain) {
    return false; // Invalid email format
  }

  // Check if domain is in allowed_domains (with or without @ prefix)
  const domainWithAt = `@${emailDomain}`;
  return whitelist.allowed_domains.includes(emailDomain) ||
         whitelist.allowed_domains.includes(domainWithAt);
}


/**
 * Load processed email IDs for idempotence
 * @returns {Promise<Object>} Map of email ID -> timestamp
 */
async function loadProcessedIds() {
  try {
    const content = await readFile(PROCESSED_IDS_PATH, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {};
  }
}

/**
 * Mark an email as processed (idempotence)
 * @param {string} emailId - Email ID to mark
 */
async function markAsProcessed(emailId) {
  const ids = await loadProcessedIds();
  ids[emailId] = new Date().toISOString();
  // Keep only last 1000 entries (cleanup)
  const entries = Object.entries(ids).sort((a, b) => b[1].localeCompare(a[1]));
  const cleaned = Object.fromEntries(entries.slice(0, 1000));
  await writeFile(PROCESSED_IDS_PATH, JSON.stringify(cleaned, null, 2));
}

/**
 * Check if email was already processed
 * @param {string} emailId - Email ID to check
 * @returns {Promise<boolean>} True if already processed
 */
async function isAlreadyProcessed(emailId) {
  const ids = await loadProcessedIds();
  return !!ids[emailId];
}

/**
 * Move email to quarantine folder
 * @param {string} emailPath - Path to email file
 * @param {string} reason - Reason for quarantine
 */
async function moveToQuarantine(emailPath, reason) {
  await mkdir(QUARANTINE_PATH, { recursive: true });
  const filename = basename(emailPath);
  const destPath = join(QUARANTINE_PATH, `${reason}_${filename}`);
  await rename(emailPath, destPath);
  logger.error(`Email moved to quarantine: ${reason} → ${destPath}`);
}

/**
 * Get list of unprocessed emails
 * @returns {Promise<string[]>} List of email file paths
 */
async function getUnprocessedEmails() {
  try {
    const files = await readdir(INPUT_DIR);
    const emailFiles = files.filter(f => f.endsWith('.json'));
    return emailFiles.map(f => join(INPUT_DIR, f));
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Read email from JSON file
 * @param {string} filePath - Path to email JSON file
 * @returns {Promise<Object>} Email object
 */
async function readEmail(filePath) {
  const content = await readFile(filePath, 'utf-8');
  return JSON.parse(content);
}

/**
 * Process a single email through the workflow
 * @param {string} emailPath - Path to email file
 * @param {Object} whitelist - Whitelist configuration
 */
async function processEmail(emailPath, whitelist) {
  try {
    logger.info(`Processing email: ${emailPath}`);

    // 1. Read email
    const email = await readEmail(emailPath);

    // 1b. Idempotence check - prevent double responses
    if (await isAlreadyProcessed(email.id)) {
      logger.warn(`⚠️ Email ${email.id} already processed, skipping (idempotence)`);
      await unlink(emailPath);
      return;
    }

    // 2. Extract email body
    const emailBody = email.body_text || email.textAsHtml || email.body_html || email.text || '';

    if (!emailBody.trim()) {
      logger.error(`Email ${email.id} has empty body`);
      await moveToQuarantine(emailPath, 'empty_body');
      return;
    }

    // Extract sender email with validation
    const senderEmail = email.from?.address || email.from?.text ||
      (typeof email.from === 'string' ? email.from : null);

    if (!senderEmail || typeof senderEmail !== 'string') {
      logger.error(`Email ${email.id} has invalid sender format`);
      await moveToQuarantine(emailPath, 'invalid_sender');
      return;
    }

    logger.info(`From: ${senderEmail}`);
    logger.info(`Subject: ${email.subject || '(no subject)'}`);

    // ✅ WHITELIST CHECK - Before LLM processing
    if (!isEmailAllowed(senderEmail, whitelist)) {
      logger.warn(`⛔ Sender not whitelisted, email rejected: ${senderEmail} (ID: ${email.id})`);
      logger.warn(`   Subject: ${email.subject || '(no subject)'}`);
      await moveToQuarantine(emailPath, 'not_whitelisted');
      return;
    }

    logger.debug(`✅ Sender whitelisted: ${senderEmail}`);
    logger.debug(`Body preview: ${emailBody.substring(0, 100)}...`);

    // 3. Process with AskDoc (import or question flow) with TIMEOUT
    const subject = email.subject || '';
    const isImportFlow = subject.toLowerCase().includes('(add)');
    logger.info(`Processing as ${isImportFlow ? 'IMPORT' : 'QUESTION'} flow...`);

    let aiResult;
    try {
      aiResult = await Promise.race([
        processAskDocEmail(email),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('LLM_TIMEOUT')), LLM_TIMEOUT_MS)
        )
      ]);
    } catch (error) {
      if (error.message === 'LLM_TIMEOUT') {
        const retryCount = email._retryCount || 0;
        if (retryCount < MAX_RETRIES) {
          email._retryCount = retryCount + 1;
          email._nextRetryAt = Date.now() + RETRY_DELAYS[retryCount];
          await writeFile(emailPath, JSON.stringify(email, null, 2));
          logger.warn(`⏱️ LLM timeout, will retry (#${retryCount + 1}) in ${RETRY_DELAYS[retryCount] / 1000}s`);
          return;
        } else {
          logger.error(`❌ LLM timeout after ${MAX_RETRIES} retries`);
          await moveToQuarantine(emailPath, 'max_retries_exceeded');
          return;
        }
      }
      throw error;
    }

    if (!aiResult.success) {
      logger.error(`${aiResult.flowType.toUpperCase()} failed: ${aiResult.error}`);
      // Keep the email file for retry (will be retried next cycle)
      return;
    }

    const aiResponse = aiResult.response;
    const flowInfo = aiResult.flowType === 'import'
      ? `${aiResult.importResult?.imported || 0} doc(s) imported`
      : `${aiResult.questionResult?.documentsAnalyzed || 0} doc(s) analyzed`;
    logger.info(`${aiResult.flowType.toUpperCase()} completed: ${flowInfo}`);
    logger.debug(`Response preview: ${aiResponse.substring(0, 100)}...`);

    // 4. Send response email (no PDF attachments for AskDoc flows)
    logger.info(`Sending response email to ${senderEmail}...`);
    const emailResult = await sendEmail(
      senderEmail,
      `Re: ${email.subject || 'Your request'}`,
      aiResponse
    );

    if (!emailResult.success) {
      logger.error(`Failed to send email: ${emailResult.error}`);
      // Keep the email file for retry
      return;
    }

    logger.info(`✅ Email sent successfully to ${senderEmail}`);

    // 6. Mark as processed BEFORE deleting (idempotence)
    await markAsProcessed(email.id);

    // 7. Delete processed email file
    await unlink(emailPath);
    logger.info(`Email ${email.id} processed and deleted`);

  } catch (error) {
    logger.error(`Error processing email ${emailPath}:`, error.message);
    logger.debug('Error stack:', error.stack);
  }
}

/**
 * Main processing cycle
 * Whitelist is reloaded dynamically at each cycle (like llm.json)
 */
async function processCycle() {
  // Check shutdown flag
  if (isShuttingDown) {
    logger.debug('Shutdown in progress, skipping cycle');
    return;
  }

  // Dynamic whitelist reload (allows changes without restart)
  let whitelist;
  try {
    whitelist = await loadWhitelist();
  } catch (error) {
    logger.error('Failed to reload whitelist, skipping cycle:', error.message);
    return;
  }

  // Mutex: prevent concurrent cycles
  if (isProcessing) {
    skippedCycles++;
    if (skippedCycles % 5 === 0) { // Log every 5 skips
      logger.warn(`⚠️ Cycle skipped (${skippedCycles} total) - previous still running`);
    }
    return;
  }

  isProcessing = true;
  skippedCycles = 0; // Reset at start of successful cycle

  try {
    logger.debug('Starting processing cycle...');

    // Get unprocessed emails
    const emailPaths = await getUnprocessedEmails();

    if (emailPaths.length === 0) {
      logger.debug('No new emails to process');
      return;
    }

    logger.info(`Found ${emailPaths.length} email(s) to process`);

    // Process all emails in this cycle (sequential to avoid rate limits)
    for (let i = 0; i < emailPaths.length; i++) {
      logger.info(`Processing email ${i + 1}/${emailPaths.length}...`);
      await processEmail(emailPaths[i], whitelist);
    }

    logger.debug('Processing cycle completed');

  } catch (error) {
    logger.error('Error in processing cycle:', error.message);
    logger.debug('Error stack:', error.stack);
  } finally {
    isProcessing = false;
  }
}

/**
 * Main function
 */
async function main() {
  logger.info('🚀 Starting Email Processing Orchestrator...');
  logger.info('');

  try {
    // Initialize services
    logger.info('Initializing services...');

    // Validate whitelist at startup (fail-fast if missing/invalid)
    // Note: whitelist is reloaded dynamically in each processCycle()
    await loadWhitelist();

    // Run PDF cache cleanup at startup
    logger.info('Running PDF cache cleanup...');
    const cacheResult = await runCacheCleanup();
    logger.info(`✅ Cache cleanup: ${cacheResult.cleaned} expired, ${cacheResult.remaining} cached`);

    // Run thread cleanup at startup (remove threads > 7 days old)
    logger.info('Running thread cleanup...');
    const threadCleaned = await runThreadCleanup();
    logger.info(`✅ Thread cleanup: ${threadCleaned} expired thread(s) removed`);

    // Initialize email service
    await initEmailService();
    logger.info('✅ Email service initialized');

    logger.info('');
    logger.info('📋 Configuration:');
    logger.info(`   Input directory: ${INPUT_DIR}`);
    logger.info(`   Processing: all emails per cycle (every ${POLL_INTERVAL / 1000}s)`);
    logger.info(`   LLM config: traitement-ia/config/llm.json (dynamic reload)`);
    logger.info(`   Whitelist: config/whitelist.json (dynamic reload)`);
    logger.info('');
    logger.info('✅ Orchestrator ready! Processing emails...');
    logger.info('');

    // Initial cycle
    await processCycle();

    // Set up polling (store reference for graceful shutdown)
    pollInterval = setInterval(() => {
      processCycle();
    }, POLL_INTERVAL);

  } catch (error) {
    logger.error('❌ Failed to start orchestrator:', error.message);
    logger.debug('Error stack:', error.stack);
    process.exit(1);
  }
}

/**
 * Graceful shutdown handler
 * @param {string} signal - Signal name
 */
async function gracefulShutdown(signal) {
  logger.info(`📪 Received ${signal} signal, graceful shutdown...`);
  isShuttingDown = true;

  // 1. Stop polling
  if (pollInterval) {
    clearInterval(pollInterval);
    pollInterval = null;
  }

  // 2. Wait for current cycle to finish (max 30s)
  const maxWait = 30000;
  const start = Date.now();
  while (isProcessing && (Date.now() - start < maxWait)) {
    logger.info('Waiting for current cycle to finish...');
    await new Promise(r => setTimeout(r, 1000));
  }

  if (isProcessing) {
    logger.warn('Cycle still running after 30s, forcing shutdown');
  }

  // 3. Close connections (email service)
  try {
    const { closeEmailService } = await import('./email-send/src/index.js');
    if (typeof closeEmailService === 'function') {
      closeEmailService();
    }
  } catch {
    // closeEmailService may not exist, ignore
  }

  logger.info('✅ Shutdown complete');
  process.exit(0);
}

// Handle graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Start
main();
