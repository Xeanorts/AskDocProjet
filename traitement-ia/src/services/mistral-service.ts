/**
 * Mistral AI Service
 * Handles Document Q&A with PDF attachments via Mistral API
 * Uses file upload method as per official documentation
 */

import { Mistral } from '@mistralai/mistralai';
import logger from '../utils/logger.js';
import { loadLLMConfig } from '../utils/config-loader.js';
import pdfCacheService, { CacheResult } from './pdf-cache-service.js';

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

interface LLMConfig {
  model?: string;
  max_output_tokens?: number;
  system_prompt?: string;
}

export interface PdfDocument {
  filename: string;
  buffer: Buffer;
}

class MistralService {
  private client: Mistral;
  private timeout: number;
  private dryRun: boolean;

  constructor() {
    this.dryRun = process.env.DRY_RUN === 'true';

    if (this.dryRun) {
      logger.info('🧪 DRY_RUN mode enabled - API calls will be simulated');
      // Create a dummy client (won't be used)
      this.client = {} as Mistral;
      this.timeout = 0;
      return;
    }

    const apiKey = process.env.MISTRAL_API_KEY;

    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY environment variable is required');
    }

    this.client = new Mistral({
      apiKey: apiKey
    });

    this.timeout = parseInt(process.env.MISTRAL_TIMEOUT_MS || '120000', 10);

    logger.info('Mistral client initialized');
    logger.info('   Config will be loaded dynamically on each processing');
  }

  /**
   * Resolve the model to use based on email subject tags
   * Tags: (pro) -> mistral-medium, (max) -> mistral-large
   * Default: use config model or mistral-small
   */
  private resolveModelForEmail(subject: string, configModel: string): string {
    const s = (subject || '').toLowerCase();

    if (s.includes('(max)')) return 'mistral-large-latest';
    if (s.includes('(pro)')) return 'mistral-medium-latest';

    return configModel || 'mistral-small-latest';
  }

  /**
   * Remove markdown formatting from LLM response
   * Keeps plain text only for email output
   */
  private sanitizeMarkdown(text: string): string {
    return text
      // Remove bold **text** ([\s\S] matches newlines too)
      .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
      // Remove italic *text* (but not **)
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
      // Remove headers # ## ### at start of line
      .replace(/^#{1,6}\s+/gm, '');
  }

  /**
   * Generate a mock response for dry-run mode
   */
  private generateDryRunResponse(question: string, pdfCount: number = 0): string {
    const timestamp = new Date().toISOString();
    const pdfInfo = pdfCount > 0 ? `\n- PDFs analysés: ${pdfCount}` : '';

    return `[DRY-RUN MODE - Réponse simulée]

Ceci est une réponse de test générée automatiquement.

Détails de la requête:
- Timestamp: ${timestamp}
- Question reçue: "${question.substring(0, 200)}${question.length > 200 ? '...' : ''}"${pdfInfo}

En mode production (sans DRY_RUN=true), cette réponse serait générée par l'API Mistral AI.`;
  }

  /**
   * Upload a PDF file to Mistral for OCR processing
   */
  async uploadPdf(pdfBuffer: Buffer, filename: string): Promise<string> {
    logger.info(`   Uploading PDF: ${filename} (${Math.round(pdfBuffer.length / 1024)} KB)`);

    const uploadedFile = await this.client.files.upload({
      file: {
        fileName: filename,
        content: pdfBuffer,
      },
      purpose: 'ocr'
    });

    logger.info(`   Upload successful, file ID: ${uploadedFile.id}`);
    return uploadedFile.id;
  }

  /**
   * Get a signed URL for an uploaded file
   */
  async getSignedUrl(fileId: string): Promise<string> {
    const signedUrl = await this.client.files.getSignedUrl({
      fileId: fileId,
    });

    logger.debug(`   Signed URL obtained`);
    return signedUrl.url;
  }

  /**
   * Delete an uploaded file
   */
  async deleteFile(fileId: string): Promise<void> {
    try {
      await this.client.files.delete({
        fileId: fileId
      });
      logger.debug(`   File ${fileId} deleted from Mistral`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      logger.warn(`   Failed to delete file ${fileId}: ${errorMessage}`);
    }
  }

  /**
   * Process a question about a PDF document using file upload
   */
  async processDocumentQA(
    question: string,
    pdfBuffer: Buffer,
    emailId: string,
    filename: string = 'document.pdf',
    emailSubject: string = ''
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    let fileId: string | null = null;

    // Dry-run mode - return mock response
    if (this.dryRun) {
      logger.info(`🧪 [DRY-RUN] Processing Document Q&A for email ${emailId}`);
      logger.info(`   Document: ${filename} (${Math.round(pdfBuffer.length / 1024)} KB)`);
      logger.info(`   Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);

      const mockResponse = this.generateDryRunResponse(question, 1);
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        data: mockResponse,
        processingTime,
        usage: { prompt_tokens: 300, completion_tokens: 80, total_tokens: 380 },
        model: 'dry-run-mock'
      };
    }

    try {
      const config: LLMConfig = await loadLLMConfig('pdf');
      const model = this.resolveModelForEmail(emailSubject, config.model || 'mistral-small-latest');

      logger.info(`Processing Document Q&A for email ${emailId}...`);
      logger.info(`   Model: ${model}${emailSubject.toLowerCase().includes('(pro)') || emailSubject.toLowerCase().includes('(max)') ? ' (from subject tag)' : ''}`);
      logger.info(`   Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);

      // Step 1: Upload PDF
      fileId = await this.uploadPdf(pdfBuffer, filename);

      // Step 2: Get signed URL
      const documentUrl = await this.getSignedUrl(fileId);

      // Step 3: Build messages
      const messages: Array<{role: string; content: string | Array<{type: string; text?: string; documentUrl?: string}>}> = [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: question
            },
            {
              type: 'document_url',
              documentUrl: documentUrl
            }
          ]
        }
      ];

      // Add system prompt if configured
      if (config.system_prompt) {
        messages.unshift({
          role: 'system',
          content: config.system_prompt
        });
      }

      // Step 4: Call Mistral Chat API with safe_prompt enabled
      logger.info(`   Calling Mistral API...`);
      const response = await this.client.chat.complete({
        model: model,
        messages: messages as any,
        maxTokens: config.max_output_tokens || 4000,
        safePrompt: true
      });

      const processingTime = Date.now() - startTime;

      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from Mistral API');
      }

      const responseText = typeof content === 'string' ? content : JSON.stringify(content);

      logger.info(`Document Q&A completed in ${processingTime}ms`);
      logger.debug(`Response length: ${responseText.length} chars`);

      return {
        success: true,
        data: this.sanitizeMarkdown(responseText.trim()),
        processingTime,
        usage: response.usage as any,
        model: model
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const err = error as any;

      if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        logger.error('Mistral API timeout:', err.message);
        return {
          success: false,
          error: 'API timeout',
          errorMessage: `Request timed out after ${processingTime}ms`,
          processingTime
        };
      }

      if (err.status === 429) {
        logger.error('Mistral API rate limit exceeded');
        return {
          success: false,
          error: 'Rate limit exceeded',
          errorMessage: 'Too many requests, please try again later',
          processingTime
        };
      }

      if (err.status === 401) {
        logger.error('Mistral API authentication failed');
        return {
          success: false,
          error: 'Authentication failed',
          errorMessage: 'Invalid API key',
          processingTime
        };
      }

      if (err.status === 413 || err.message?.includes('too large')) {
        logger.error('PDF file too large');
        return {
          success: false,
          error: 'File too large',
          errorMessage: 'PDF exceeds maximum size (50 MB)',
          processingTime
        };
      }

      logger.error('Mistral API error:', err.message);
      return {
        success: false,
        error: err.name || 'Unknown error',
        errorMessage: err.message,
        processingTime
      };
    } finally {
      if (fileId) {
        await this.deleteFile(fileId);
      }
    }
  }

  /**
   * Process a question about multiple PDF documents
   * Uses cache to avoid re-uploading identical PDFs (identified by SHA256 hash)
   * Uploads all PDFs, gets signed URLs, and includes all in the chat completion
   */
  async processMultiDocumentQA(
    question: string,
    pdfs: PdfDocument[],
    emailId: string,
    emailSubject: string = ''
  ): Promise<ProcessingResult> {
    const startTime = Date.now();
    const cacheResults: Array<{ pdf: PdfDocument; cache: CacheResult }> = [];

    // Dry-run mode - return mock response
    if (this.dryRun) {
      logger.info(`🧪 [DRY-RUN] Processing Multi-Document Q&A for email ${emailId}`);
      logger.info(`   Documents: ${pdfs.length} PDF(s)`);
      for (const pdf of pdfs) {
        logger.info(`   - ${pdf.filename} (${Math.round(pdf.buffer.length / 1024)} KB)`);
      }
      logger.info(`   Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);

      const mockResponse = this.generateDryRunResponse(question, pdfs.length);
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        data: mockResponse,
        processingTime,
        usage: { prompt_tokens: 500, completion_tokens: 100, total_tokens: 600 },
        model: 'dry-run-mock'
      };
    }

    try {
      const config: LLMConfig = await loadLLMConfig('pdf');
      const model = this.resolveModelForEmail(emailSubject, config.model || 'mistral-small-latest');

      logger.info(`Processing Multi-Document Q&A for email ${emailId}...`);
      logger.info(`   Model: ${model}${emailSubject.toLowerCase().includes('(pro)') || emailSubject.toLowerCase().includes('(max)') ? ' (from subject tag)' : ''}`);
      logger.info(`   Documents: ${pdfs.length} PDF(s)`);
      logger.info(`   Question: ${question.substring(0, 100)}${question.length > 100 ? '...' : ''}`);

      // Step 1: Get or upload all PDFs (with caching)
      for (const pdf of pdfs) {
        const cacheResult = await pdfCacheService.getOrUpload(
          pdf.buffer,
          pdf.filename,
          async () => this.uploadPdf(pdf.buffer, pdf.filename)
        );

        if (cacheResult.fromCache) {
          logger.info(`   [CACHE HIT] ${pdf.filename}`);
        } else {
          logger.info(`   [UPLOADED] ${pdf.filename} (now cached)`);
        }

        cacheResults.push({ pdf, cache: cacheResult });
      }

      // Step 2: Get all signed URLs (with stale cache handling)
      const documentUrls: string[] = [];
      for (const { pdf, cache } of cacheResults) {
        try {
          const url = await this.getSignedUrl(cache.fileId);
          documentUrls.push(url);
        } catch (error) {
          // Stale cache - file no longer exists in Mistral
          logger.warn(`   [CACHE STALE] ${pdf.filename}, re-uploading...`);
          await pdfCacheService.invalidateEntry(cache.hash);

          // Re-upload and get new signed URL
          const newFileId = await this.uploadPdf(pdf.buffer, pdf.filename);
          const url = await this.getSignedUrl(newFileId);
          documentUrls.push(url);

          // Update cache result for potential future use
          cache.fileId = newFileId;
          cache.fromCache = false;
        }
      }

      // Step 3: Build message content with all documents
      const contentItems: Array<{type: string; text?: string; documentUrl?: string}> = [
        { type: 'text', text: question }
      ];

      for (const url of documentUrls) {
        contentItems.push({ type: 'document_url', documentUrl: url });
      }

      // Step 4: Build messages array
      const messages: Array<{role: string; content: string | Array<{type: string; text?: string; documentUrl?: string}>}> = [
        { role: 'user', content: contentItems }
      ];

      // Add system prompt if configured
      if (config.system_prompt) {
        messages.unshift({
          role: 'system',
          content: config.system_prompt
        });
      }

      // Step 5: Call Mistral Chat API
      logger.info(`   Calling Mistral API with ${pdfs.length} document(s)...`);
      const response = await this.client.chat.complete({
        model: model,
        messages: messages as any,
        maxTokens: config.max_output_tokens || 4000,
        safePrompt: true
      });

      const processingTime = Date.now() - startTime;
      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from Mistral API');
      }

      const responseText = typeof content === 'string' ? content : JSON.stringify(content);

      logger.info(`Multi-Document Q&A completed in ${processingTime}ms`);
      logger.debug(`Response length: ${responseText.length} chars`);

      return {
        success: true,
        data: this.sanitizeMarkdown(responseText.trim()),
        processingTime,
        usage: response.usage as any,
        model: model
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const err = error as any;

      if (err.code === 'ETIMEDOUT' || err.message?.includes('timeout')) {
        logger.error('Mistral API timeout:', err.message);
        return {
          success: false,
          error: 'API timeout',
          errorMessage: `Request timed out after ${processingTime}ms`,
          processingTime
        };
      }

      if (err.status === 429) {
        logger.error('Mistral API rate limit exceeded');
        return {
          success: false,
          error: 'Rate limit exceeded',
          errorMessage: 'Too many requests, please try again later',
          processingTime
        };
      }

      if (err.status === 401) {
        logger.error('Mistral API authentication failed');
        return {
          success: false,
          error: 'Authentication failed',
          errorMessage: 'Invalid API key',
          processingTime
        };
      }

      logger.error('Mistral API error:', err.message);
      return {
        success: false,
        error: err.name || 'Unknown error',
        errorMessage: err.message,
        processingTime
      };
    }
    // Note: No cleanup - files are cached on Mistral for reuse
    // Cleanup is done by pdfCacheService.runCleanup() at service startup
  }

  /**
   * Process email with question (no PDF - text only)
   */
  async processEmail(
    emailBody: string,
    emailId: string,
    emailSubject: string = ''
  ): Promise<ProcessingResult> {
    const startTime = Date.now();

    // Dry-run mode - return mock response
    if (this.dryRun) {
      logger.info(`🧪 [DRY-RUN] Processing email ${emailId} (text-only)`);
      const mockResponse = this.generateDryRunResponse(emailBody, 0);
      const processingTime = Date.now() - startTime;

      return {
        success: true,
        data: mockResponse,
        processingTime,
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'dry-run-mock'
      };
    }

    try {
      const config: LLMConfig = await loadLLMConfig('text');
      const model = this.resolveModelForEmail(emailSubject, config.model || 'mistral-small-latest');

      logger.info(`Processing email ${emailId} with Mistral...`);
      logger.info(`   Model: ${model}${emailSubject.toLowerCase().includes('(pro)') || emailSubject.toLowerCase().includes('(max)') ? ' (from subject tag)' : ''}`);

      const messages: Array<{role: string; content: string}> = [];

      if (config.system_prompt) {
        messages.push({
          role: 'system',
          content: config.system_prompt
        });
      }

      messages.push({
        role: 'user',
        content: emailBody
      });

      const response = await this.client.chat.complete({
        model: model,
        messages: messages as any,
        maxTokens: config.max_output_tokens || 4000,
        safePrompt: true
      });

      const processingTime = Date.now() - startTime;
      const content = response.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error('Empty response from Mistral API');
      }

      const responseText = typeof content === 'string' ? content : JSON.stringify(content);

      logger.info(`Processing completed in ${processingTime}ms`);

      return {
        success: true,
        data: this.sanitizeMarkdown(responseText.trim()),
        processingTime,
        usage: response.usage as any,
        model: model
      };
    } catch (error) {
      const processingTime = Date.now() - startTime;
      const err = error as Error;
      logger.error('Mistral API error:', err.message);

      return {
        success: false,
        error: err.name || 'Unknown error',
        errorMessage: err.message,
        processingTime
      };
    }
  }
}

export default MistralService;
