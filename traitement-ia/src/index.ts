/**
 * Project Name - Entry Point
 * Processes emails with PDF attachments using Mistral Document Q&A
 */

import dotenv from 'dotenv';
import logger from './utils/logger.js';
import EmailAIProcessor from './processors/email-ai-processor.js';
import fileStorage from './persistence/file-storage.js';
import pdfCacheService from './services/pdf-cache-service.js';
import MistralService from './services/mistral-service.js';
import conversationThreadService, { PdfAttachment } from './services/conversation-thread-service.js';

// AskDoc imports
import { initializeDatabase, closeDatabase } from './persistence/database-service.js';
import { detectFlow, FlowDetectionResult, ModelLevel } from './processors/flow-router.js';
import { processImport, formatImportConfirmation, ImportResult } from './processors/import-processor.js';
import { processQuestion, QuestionResult } from './processors/question-processor.js';

dotenv.config();

let processor: EmailAIProcessor | null = null;

interface ServiceInstance {
  stop: () => void;
}

function validateConfiguration(): void {
  if (!process.env.STORAGE_PATH) {
    process.env.STORAGE_PATH = '/app/storage';
    logger.info('Using default STORAGE_PATH: /app/storage');
  }

  if (!process.env.IA_INPUT_DIR) {
    process.env.IA_INPUT_DIR = '00_mail_in';
    logger.info('Using default IA_INPUT_DIR: 00_mail_in');
  }

  if (!process.env.IA_OUTPUT_DIR) {
    process.env.IA_OUTPUT_DIR = '10_ia_requests';
    logger.info('Using default IA_OUTPUT_DIR: 10_ia_requests');
  }

  if (!process.env.MISTRAL_API_KEY) {
    logger.error('Missing required configuration: MISTRAL_API_KEY');
    logger.error('');
    logger.error('Please configure in .env:');
    logger.error('   MISTRAL_API_KEY=your-api-key');
    logger.error('');
    logger.error('Get your API key at: https://console.mistral.ai/api-keys');
    throw new Error('Missing required configuration: MISTRAL_API_KEY');
  }
}

export async function startProjectName(): Promise<ServiceInstance> {
  try {
    logger.info('Starting AskDocProjet...');
    logger.info('   Document Q&A via Email with Mistral AI');
    logger.info('');

    validateConfiguration();

    // Initialize SQLite database
    logger.info('Initializing database...');
    initializeDatabase();
    logger.info('   Database ready');

    logger.info('Configuration:');
    logger.info(`   LLM config: config/llm.json (dynamic reload per email)`);
    logger.info(`   API Timeout: ${process.env.MISTRAL_TIMEOUT_MS || '120000'}ms`);
    logger.info(`   Input: ${fileStorage.getInputPath()}`);
    logger.info(`   Output: ${fileStorage.getOutputPath()}`);
    logger.info(`   PDF Cache: ${fileStorage.getPdfCachePath()}`);
    logger.info(`   Poll Interval: ${process.env.IA_POLL_INTERVAL_SECONDS || 60}s`);
    logger.info('');

    // Run PDF cache cleanup at startup (delete files not used for > 7 days)
    logger.info('Running PDF cache cleanup...');
    const mistralService = new MistralService();
    const cleanedCount = await pdfCacheService.runCleanup(
      async (fileId) => mistralService.deleteFile(fileId)
    );
    const cacheStats = await pdfCacheService.getStats();
    logger.info(`   Cache entries: ${cacheStats.entryCount}, Total size: ${Math.round(cacheStats.totalSizeBytes / 1024)} KB`);

    // Run conversation thread cleanup (delete threads not updated for > 7 days)
    logger.info('Running thread cleanup...');
    const threadCleanedCount = await conversationThreadService.runCleanup();
    logger.info(`   Thread cleanup: ${threadCleanedCount} expired thread(s) removed`);
    logger.info('');

    processor = new EmailAIProcessor();
    await processor.start();

    logger.info('');
    logger.info('ProjectName is ready!');
    logger.info('Waiting for emails with PDF attachments...');
    logger.info('');

    return {
      stop: (): void => {
        if (processor) {
          processor.stop();
          processor = null;
        }
      }
    };
  } catch (error) {
    const err = error as Error;
    logger.error('Failed to start ProjectName:', err.message);
    logger.debug('Error stack:', err.stack);
    throw error;
  }
}

export function stopProjectName(): void {
  if (processor) {
    processor.stop();
    processor = null;
  }
  // Close database connection
  closeDatabase();
}

export const startTraitementIA = startProjectName;
export const stopTraitementIA = stopProjectName;

/**
 * Interface for email data passed from orchestrator
 */
interface EmailInput {
  id: string;
  from?: string | { text?: string; address?: string };
  body_text?: string;
  textAsHtml?: string;
  body_html?: string;
  subject?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content_base64?: string;
  }>;
}

/**
 * Result of processing an email
 */
interface ProcessingResult {
  success: boolean;
  response?: string;
  error?: string;
  model?: string;
  processingTime?: number;
  pdfCount?: number;
  usedPdfs?: Array<{ filename: string; content_base64: string }>;
}

// Lazy-loaded MistralService instance
let mistralServiceInstance: MistralService | null = null;

function getMistralService(): MistralService {
  if (!mistralServiceInstance) {
    mistralServiceInstance = new MistralService();
  }
  return mistralServiceInstance;
}

/**
 * Safely parse base64 string to Buffer with validation
 * @param str - Base64 encoded string
 * @returns Buffer if valid, null otherwise
 */
function tryParseBase64(str: string): Buffer | null {
  if (!str || str.length === 0) return null;

  try {
    // Normalize: remove whitespace, newlines
    const cleaned = str.replace(/[\s\n\r]/g, '');

    // Check minimum length (avoid empty strings)
    if (cleaned.length < 4) return null;

    const buffer = Buffer.from(cleaned, 'base64');

    // Verify buffer is not empty and size is consistent
    // Base64: 4 chars = 3 bytes, so buffer size ≈ str.length * 3/4
    const expectedMinSize = Math.floor(cleaned.length * 0.7);
    if (buffer.length < expectedMinSize || buffer.length === 0) {
      return null;
    }

    return buffer;
  } catch {
    return null;
  }
}

/**
 * Extract PDF attachments from email data
 */
function extractPdfAttachments(email: EmailInput): Array<{ filename: string; buffer: Buffer }> {
  const pdfs: Array<{ filename: string; buffer: Buffer }> = [];

  if (!email.attachments || email.attachments.length === 0) {
    return pdfs;
  }

  for (const attachment of email.attachments) {
    if (attachment.contentType === 'application/pdf' && attachment.content_base64) {
      // Use robust base64 parsing with validation
      const buffer = tryParseBase64(attachment.content_base64);

      if (buffer) {
        pdfs.push({
          filename: attachment.filename || 'document.pdf',
          buffer
        });
      } else {
        logger.warn(`[traitement-ia] Invalid/empty base64 for: ${attachment.filename || 'unnamed.pdf'}`);
      }
    }
  }

  return pdfs;
}

/**
 * Process an email and return the AI response
 * This function is meant to be called by the orchestrator
 *
 * Supports conversation threading: if an email is a reply (RE: Subject)
 * without PDF attachments, the system retrieves PDFs from the original
 * conversation to provide context to the LLM.
 *
 * @param email - Email data object
 * @returns Processing result with AI response
 */
export async function processEmailData(email: EmailInput): Promise<ProcessingResult> {
  try {
    const mistralService = getMistralService();
    const question = email.body_text || email.textAsHtml || email.body_html || '';

    if (!question.trim()) {
      return {
        success: false,
        error: 'Empty email body - no question provided'
      };
    }

    // Extract PDF attachments from email
    let pdfAttachments = extractPdfAttachments(email);
    let pdfsFromHistory = false;

    // If no PDFs attached, try to get from conversation thread history
    if (pdfAttachments.length === 0 && email.subject) {
      const threadResult = await conversationThreadService.getThreadPdfs(email.subject);
      if (threadResult && threadResult.pdfs.length > 0) {
        logger.info(`[traitement-ia] Retrieved ${threadResult.pdfs.length} PDF(s) from conversation thread`);
        pdfAttachments = threadResult.pdfs;
        pdfsFromHistory = true;
      }
    }

    // If PDFs present and NOT from history, store them in the thread for future replies
    if (pdfAttachments.length > 0 && !pdfsFromHistory && email.subject) {
      const senderAddress = typeof email.from === 'string' ? email.from : (email.from?.address || email.from?.text || 'unknown');
      await conversationThreadService.recordPdfsInThread(
        email.subject,
        senderAddress,
        pdfAttachments
      );
    }

    let result;

    if (pdfAttachments.length > 0) {
      // Process with PDFs (uses cache)
      const sourceLabel = pdfsFromHistory ? ' (from thread history)' : '';
      logger.info(`[traitement-ia] Processing ${pdfAttachments.length} PDF(s)${sourceLabel} for email ${email.id}`);
      result = await mistralService.processMultiDocumentQA(question, pdfAttachments, email.id, email.subject || '');
    } else {
      // Process text only
      logger.info(`[traitement-ia] Processing text-only email ${email.id}`);
      result = await mistralService.processEmail(question, email.id, email.subject || '');
    }

    if (result.success && result.data) {
      return {
        success: true,
        response: result.data,
        model: result.model,
        processingTime: result.processingTime,
        pdfCount: pdfAttachments.length,
        // Return PDFs used (for attaching to response email)
        usedPdfs: pdfAttachments.map(pdf => ({
          filename: pdf.filename,
          content_base64: pdf.buffer.toString('base64')
        }))
      };
    } else {
      return {
        success: false,
        error: result.errorMessage || 'Unknown error',
        processingTime: result.processingTime
      };
    }
  } catch (error) {
    const err = error as Error;
    logger.error(`[traitement-ia] Error processing email ${email.id}:`, err.message);
    return {
      success: false,
      error: err.message
    };
  }
}

// ============================================================
// AskDoc API - Import & Question Processing
// ============================================================

/**
 * Result of processing an AskDoc email (import or question)
 */
export interface AskDocResult {
  success: boolean;
  flowType: 'import' | 'question';
  response: string;
  error?: string;
  processingTimeMs?: number;
  // Import-specific
  importResult?: ImportResult;
  // Question-specific
  questionResult?: QuestionResult;
}

/**
 * Process an AskDoc email (import or question)
 * Detects the flow type from the subject and routes accordingly
 */
// Track if database has been initialized for AskDoc
let askDocDbInitialized = false;

export async function processAskDocEmail(email: EmailInput): Promise<AskDocResult> {
  const startTime = Date.now();

  // Lazy initialize database if not already done
  if (!askDocDbInitialized) {
    logger.info('[AskDoc] Initializing database...');
    initializeDatabase();
    askDocDbInitialized = true;
  }

  try {
    const subject = email.subject || '';
    const flowDetection = detectFlow(subject);

    logger.info(`[AskDoc] Flow detected: ${flowDetection.flowType}, level: ${flowDetection.modelLevel}`);

    if (flowDetection.flowType === 'import') {
      // Import flow
      return await processAskDocImport(email, flowDetection.modelLevel, startTime);
    } else {
      // Question flow
      return await processAskDocQuestion(email, flowDetection.modelLevel, startTime);
    }
  } catch (error) {
    const err = error as Error;
    logger.error(`[AskDoc] Error: ${err.message}`);
    return {
      success: false,
      flowType: 'question',
      response: 'Une erreur est survenue lors du traitement de votre demande.',
      error: err.message,
      processingTimeMs: Date.now() - startTime
    };
  }
}

/**
 * Process an import email
 */
async function processAskDocImport(
  email: EmailInput,
  modelLevel: ModelLevel,
  startTime: number
): Promise<AskDocResult> {
  logger.info(`[AskDoc] Processing IMPORT for email ${email.id}`);

  // Extract attachments
  const attachments = extractPdfAttachments(email);

  // Also check for ZIP files
  const allAttachments: Array<{ filename: string; buffer: Buffer }> = [];

  if (email.attachments) {
    for (const att of email.attachments) {
      if (att.content_base64) {
        const buffer = tryParseBase64(att.content_base64);
        if (buffer) {
          allAttachments.push({
            filename: att.filename || 'file',
            buffer
          });
        }
      }
    }
  }

  if (allAttachments.length === 0) {
    return {
      success: false,
      flowType: 'import',
      response: 'Aucune pièce jointe trouvée.\n\nPour importer des documents, joignez un ou plusieurs fichiers PDF ou une archive ZIP.',
      processingTimeMs: Date.now() - startTime
    };
  }

  const emailBody = email.body_text || email.textAsHtml || email.body_html || '';

  const importResult = await processImport(allAttachments, emailBody, modelLevel);
  const response = formatImportConfirmation(importResult);

  return {
    success: importResult.success,
    flowType: 'import',
    response,
    importResult,
    processingTimeMs: Date.now() - startTime
  };
}

/**
 * Process a question email
 */
async function processAskDocQuestion(
  email: EmailInput,
  modelLevel: ModelLevel,
  startTime: number
): Promise<AskDocResult> {
  logger.info(`[AskDoc] Processing QUESTION for email ${email.id}`);

  const question = email.body_text || email.textAsHtml || email.body_html || '';

  if (!question.trim()) {
    return {
      success: false,
      flowType: 'question',
      response: 'Votre email ne contient pas de question.\n\nVeuillez formuler votre question dans le corps du message.',
      processingTimeMs: Date.now() - startTime
    };
  }

  const questionResult = await processQuestion(question, modelLevel);

  return {
    success: questionResult.success,
    flowType: 'question',
    response: questionResult.formattedResponse,
    questionResult,
    processingTimeMs: Date.now() - startTime
  };
}

// ============================================================
// Legacy API - Kept for backward compatibility
// ============================================================

/**
 * Run PDF cache cleanup
 * Call this at startup to remove stale cache entries
 */
export async function runCacheCleanup(): Promise<{ cleaned: number; remaining: number }> {
  const mistralService = getMistralService();
  const cleaned = await pdfCacheService.runCleanup(
    async (fileId) => mistralService.deleteFile(fileId)
  );
  const stats = await pdfCacheService.getStats();
  return { cleaned, remaining: stats.entryCount };
}

/**
 * Run thread cleanup
 * Call this at startup to remove threads not updated for > 7 days
 */
export async function runThreadCleanup(): Promise<number> {
  return conversationThreadService.runCleanup();
}

async function main(): Promise<void> {
  try {
    await startProjectName();
  } catch (error) {
    logger.error('Application failed to start');
    process.exit(1);
  }

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM signal');
    stopProjectName();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    logger.info('Received SIGINT signal');
    stopProjectName();
    process.exit(0);
  });
}

const isMainModule = import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  main();
}

export default {
  startProjectName,
  stopProjectName,
  startTraitementIA,
  stopTraitementIA,
  processEmailData,
  processAskDocEmail,
  runCacheCleanup,
  runThreadCleanup
};
