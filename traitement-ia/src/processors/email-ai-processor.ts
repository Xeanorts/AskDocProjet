/**
 * Email AI Processor
 * Processes emails with PDF attachments using Mistral Document Q&A
 */

import { basename } from 'path';
import logger from '../utils/logger.js';
import MistralService, { PdfDocument } from '../services/mistral-service.js';
import fileStorage, { EmailData, ProcessedEmailData } from '../persistence/file-storage.js';
import { createProcessedEmail, createErrorProcessedEmail } from '../models/processed-email.js';

// PDF size and count limits
const MAX_PDF_SIZE_MB = 20;
const MAX_TOTAL_SIZE_MB = 20;
const MAX_PDF_COUNT = 10;

interface PdfAttachment {
  filename: string;
  buffer: Buffer;
  size: number;
}

interface PdfValidationResult {
  valid: boolean;
  error?: string;
}

interface ProcessingResult {
  success: boolean;
  data?: string;
  error?: string;
  errorMessage?: string;
  processingTime: number;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}

class EmailAIProcessor {
  private mistralService: MistralService;
  private pollInterval: number;
  private timer: NodeJS.Timeout | null;
  private isProcessing: boolean;
  private skippedCycles: number;

  constructor() {
    this.mistralService = new MistralService();
    this.pollInterval = parseInt(process.env.IA_POLL_INTERVAL_SECONDS || '60', 10) * 1000;
    this.timer = null;
    this.isProcessing = false;
    this.skippedCycles = 0;

    logger.info('PDF Q&A Processor initialized');
    logger.info(`   Polling interval: ${this.pollInterval / 1000}s`);
  }

  async start(): Promise<void> {
    logger.info('Starting PDF Q&A Processor...');

    await this.processCycle();

    this.timer = setInterval(() => {
      this.processCycle();
    }, this.pollInterval);

    logger.info('PDF Q&A Processor started');
  }

  stop(): void {
    logger.info('Stopping PDF Q&A Processor...');

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    logger.info('PDF Q&A Processor stopped');
  }

  async processCycle(): Promise<void> {
    // Mutex: prevent concurrent cycles
    if (this.isProcessing) {
      this.skippedCycles++;
      if (this.skippedCycles % 5 === 0) { // Log every 5 skips
        logger.warn(`Cycle skipped (${this.skippedCycles} total) - previous still running`);
      }
      return;
    }

    this.isProcessing = true;
    this.skippedCycles = 0; // Reset at start of successful cycle

    try {
      logger.info('Starting processing cycle...');

      const unprocessedEmails = await fileStorage.listUnprocessedEmails();

      if (unprocessedEmails.length === 0) {
        logger.info('No new emails to process');
        return;
      }

      logger.info(`Found ${unprocessedEmails.length} email(s) to process`);

      const emailPath = unprocessedEmails[0];
      await this.processEmail(emailPath);

      logger.info('Processing cycle completed');
    } catch (error) {
      const err = error as Error;
      logger.error('Error in processing cycle:', err.message);
      logger.debug('Error stack:', err.stack);
    } finally {
      this.isProcessing = false;
    }
  }

  extractPdfAttachments(email: EmailData): PdfAttachment[] {
    const pdfs: PdfAttachment[] = [];

    if (!email.attachments || email.attachments.length === 0) {
      return pdfs;
    }

    for (const attachment of email.attachments) {
      if (attachment.contentType === 'application/pdf' && attachment.content_base64) {
        pdfs.push({
          filename: attachment.filename,
          buffer: Buffer.from(attachment.content_base64, 'base64'),
          size: attachment.size
        });
      }
    }

    return pdfs;
  }

  /**
   * Validate PDF attachments against size and count limits
   */
  validatePdfAttachments(pdfs: PdfAttachment[]): PdfValidationResult {
    // Check PDF count
    if (pdfs.length > MAX_PDF_COUNT) {
      return {
        valid: false,
        error: `Too many PDFs: ${pdfs.length} (max: ${MAX_PDF_COUNT})`
      };
    }

    // Check individual PDF sizes and calculate total
    let totalSize = 0;
    for (const pdf of pdfs) {
      const sizeMB = pdf.size / (1024 * 1024);
      if (sizeMB > MAX_PDF_SIZE_MB) {
        return {
          valid: false,
          error: `PDF "${pdf.filename}" too large: ${sizeMB.toFixed(1)} MB (max: ${MAX_PDF_SIZE_MB} MB)`
        };
      }
      totalSize += pdf.size;
    }

    // Check total size
    const totalSizeMB = totalSize / (1024 * 1024);
    if (totalSizeMB > MAX_TOTAL_SIZE_MB) {
      return {
        valid: false,
        error: `Total PDF size too large: ${totalSizeMB.toFixed(1)} MB (max: ${MAX_TOTAL_SIZE_MB} MB)`
      };
    }

    return { valid: true };
  }

  async processEmail(emailPath: string): Promise<void> {
    const sourceFile = basename(emailPath);

    try {
      logger.info(`Processing email: ${sourceFile}`);
      const email = await fileStorage.readEmail(emailPath);

      const isProcessed = await fileStorage.isAlreadyProcessed(email.id);
      if (isProcessed) {
        logger.info(`Email ${email.id} already processed, skipping`);
        return;
      }

      const question = email.body_text || email.textAsHtml || email.body_html || '';

      if (!question.trim()) {
        logger.warn(`Email ${email.id} has empty body (no question), skipping`);
        const errorEmail = createErrorProcessedEmail(email, 'Empty email body - no question provided');
        await fileStorage.saveProcessedEmail(errorEmail);
        await fileStorage.deleteEmailFile(emailPath);
        return;
      }

      const pdfAttachments = this.extractPdfAttachments(email);

      if (pdfAttachments.length === 0) {
        logger.warn(`Email ${email.id} has no PDF attachments`);
        logger.info(`Processing text-only question...`);
        const result = await this.mistralService.processEmail(question, email.id, email.subject || '');
        await this.handleResult(email, emailPath, result, []);
        return;
      }

      // Log PDF attachments found
      logger.info(`Found ${pdfAttachments.length} PDF attachment(s):`);
      pdfAttachments.forEach((pdf, i) => {
        logger.info(`   ${i + 1}. ${pdf.filename} (${Math.round(pdf.size / 1024)} KB)`);
      });

      // Validate PDF attachments against limits
      const validation = this.validatePdfAttachments(pdfAttachments);
      if (!validation.valid) {
        logger.error(`PDF validation failed: ${validation.error}`);
        const errorEmail = createErrorProcessedEmail(email, validation.error || 'PDF validation failed');
        await fileStorage.saveProcessedEmail(errorEmail);
        await fileStorage.deleteEmailFile(emailPath);
        return;
      }

      logger.info(`Processing Multi-Document Q&A with Mistral...`);
      logger.info(`   Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);

      // Convert to PdfDocument format for MistralService
      const pdfDocs: PdfDocument[] = pdfAttachments.map(pdf => ({
        filename: pdf.filename,
        buffer: pdf.buffer
      }));

      // Get all PDF filenames for result
      const pdfFilenames = pdfAttachments.map(p => p.filename);

      // Process with multi-document Q&A
      const result = await this.mistralService.processMultiDocumentQA(question, pdfDocs, email.id, email.subject || '');
      await this.handleResult(email, emailPath, result, pdfFilenames);

    } catch (error) {
      const err = error as Error;
      logger.error(`Failed to process email ${sourceFile}:`, err.message);
      logger.debug('Error stack:', err.stack);

      try {
        const email = await fileStorage.readEmail(emailPath);
        const errorEmail = createErrorProcessedEmail(
          email,
          `Processing error: ${err.message}`
        );
        await fileStorage.saveProcessedEmail(errorEmail);
        await fileStorage.deleteEmailFile(emailPath);
      } catch (saveError) {
        const saveErr = saveError as Error;
        logger.error(`Could not save error file:`, saveErr.message);
      }
    }
  }

  async handleResult(
    email: EmailData,
    emailPath: string,
    result: ProcessingResult,
    pdfFilenames: string[]
  ): Promise<void> {
    let processedEmail: ProcessedEmailData;

    if (result.success && result.data && result.model) {
      logger.info(`Processing successful`);
      processedEmail = createProcessedEmail(email, result.data, result.model);

      if (result.processingTime) {
        processedEmail.processing_time_ms = result.processingTime;
      }

      if (result.usage) {
        processedEmail.api_usage = result.usage;
      }

      if (pdfFilenames.length > 0) {
        processedEmail.pdf_filenames = pdfFilenames;
        processedEmail.pdf_filename = pdfFilenames[0]; // Backward compatibility
        processedEmail.processing_type = 'document_qa';
      } else {
        processedEmail.processing_type = 'text_only';
      }
    } else {
      logger.error(`Processing failed: ${result.errorMessage}`);
      processedEmail = createErrorProcessedEmail(email, result.errorMessage || 'Unknown error');

      processedEmail.error_type = result.error;

      if (result.processingTime) {
        processedEmail.processing_time_ms = result.processingTime;
      }
    }

    await fileStorage.saveProcessedEmail(processedEmail);
    await fileStorage.deleteEmailFile(emailPath);

    logger.info(`Email ${email.id} processed and saved`);
    logger.info(`   From: ${email.from?.text || email.from?.address || 'unknown'}`);
    logger.info(`   Subject: ${email.subject || '(no subject)'}`);
    logger.info(`   Status: ${processedEmail.status}`);
    logger.info(`   Type: ${processedEmail.processing_type || 'unknown'}`);
    if (pdfFilenames.length > 0) {
      logger.info(`   PDFs: ${pdfFilenames.length} (${pdfFilenames.join(', ')})`);
    }

    if (processedEmail.status === 'ok' && processedEmail.ai_response) {
      const responsePreview = processedEmail.ai_response.substring(0, 100);
      logger.info(`   Response: ${responsePreview}...`);
    }
  }
}

export default EmailAIProcessor;
