/**
 * Conversation Thread Service
 *
 * Manages PDF context across email conversation threads.
 * When a user sends a PDF with an email, the PDF is stored with the thread.
 * When the user replies (RE: Subject) without attaching the PDF again,
 * the service retrieves the original PDF(s) for context.
 *
 * Storage: storage/12_conversation_threads/[subject-hash].json
 */

import { mkdir, readFile, writeFile, rename, readdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import logger from '../utils/logger.js';
import { extractBaseSubject, computeSubjectHash } from '../utils/thread-utils.js';

/**
 * PDF stored in a conversation thread
 */
interface ThreadPdf {
  filename: string;
  hash: string;               // SHA256 of PDF content for deduplication
  content_base64: string;     // Full PDF content
  captured_at: string;        // ISO timestamp
}

/**
 * Conversation thread data structure
 */
interface ConversationThread {
  base_subject: string;
  base_subject_hash: string;
  created_at: string;
  last_updated: string;
  sender: string;
  pdf_context: ThreadPdf[];
}

/**
 * PDF attachment as expected from email
 */
export interface PdfAttachment {
  filename: string;
  buffer: Buffer;
}

/**
 * Result from getThreadPdfs - includes metadata about source
 */
export interface ThreadPdfResult {
  pdfs: PdfAttachment[];
  fromHistory: boolean;
  threadHash: string;
}

class ConversationThreadService {
  private threadDir: string;
  private initialized: boolean = false;

  constructor() {
    const storagePath = process.env.STORAGE_PATH || '/app/storage';
    this.threadDir = join(storagePath, '12_conversation_threads');
  }

  /**
   * Ensure thread storage directory exists
   */
  private async ensureDirectory(): Promise<void> {
    if (this.initialized) return;

    if (!existsSync(this.threadDir)) {
      await mkdir(this.threadDir, { recursive: true });
      logger.info(`[ThreadService] Created thread directory: ${this.threadDir}`);
    }
    this.initialized = true;
  }

  /**
   * Get thread file path from subject
   */
  private getThreadPath(subject: string): string {
    const hash = computeSubjectHash(subject);
    return join(this.threadDir, `${hash}.json`);
  }

  /**
   * Compute SHA256 hash of PDF content for deduplication
   */
  private computePdfHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Load existing thread or return null
   */
  private async loadThread(subject: string): Promise<ConversationThread | null> {
    const threadPath = this.getThreadPath(subject);

    if (!existsSync(threadPath)) {
      return null;
    }

    try {
      const content = await readFile(threadPath, 'utf-8');
      return JSON.parse(content) as ConversationThread;
    } catch (error) {
      const err = error as Error;
      logger.warn(`[ThreadService] Failed to load thread: ${err.message}`);
      return null;
    }
  }

  /**
   * Save thread atomically (tmp file + rename)
   */
  private async saveThread(thread: ConversationThread): Promise<void> {
    await this.ensureDirectory();

    const threadPath = join(this.threadDir, `${thread.base_subject_hash}.json`);
    const tempPath = `${threadPath}.tmp`;

    await writeFile(tempPath, JSON.stringify(thread, null, 2), 'utf-8');
    await rename(tempPath, threadPath);
  }

  /**
   * Record PDFs from an email into the conversation thread
   * Called when processing an email WITH PDF attachments
   *
   * @param subject - Email subject
   * @param sender - Email sender address
   * @param pdfs - PDF attachments to store
   */
  async recordPdfsInThread(
    subject: string,
    sender: string,
    pdfs: PdfAttachment[]
  ): Promise<void> {
    if (pdfs.length === 0) return;

    await this.ensureDirectory();

    const baseSubject = extractBaseSubject(subject);
    const subjectHash = computeSubjectHash(subject);

    // Load existing thread or create new
    let thread = await this.loadThread(subject);
    const now = new Date().toISOString();

    if (!thread) {
      thread = {
        base_subject: baseSubject,
        base_subject_hash: subjectHash,
        created_at: now,
        last_updated: now,
        sender,
        pdf_context: []
      };
    }

    // Add new PDFs (deduplicate by hash)
    const existingHashes = new Set(thread.pdf_context.map(p => p.hash));
    let addedCount = 0;

    for (const pdf of pdfs) {
      const pdfHash = this.computePdfHash(pdf.buffer);

      if (!existingHashes.has(pdfHash)) {
        thread.pdf_context.push({
          filename: pdf.filename,
          hash: pdfHash,
          content_base64: pdf.buffer.toString('base64'),
          captured_at: now
        });
        existingHashes.add(pdfHash);
        addedCount++;
      }
    }

    thread.last_updated = now;

    await this.saveThread(thread);

    if (addedCount > 0) {
      logger.info(`[ThreadService] Stored ${addedCount} PDF(s) in thread "${baseSubject.substring(0, 50)}..."`);
    } else {
      logger.debug(`[ThreadService] All PDFs already in thread (deduplicated)`);
    }
  }

  /**
   * Get PDFs from conversation thread history
   * Called when processing an email WITHOUT PDF attachments
   *
   * @param subject - Email subject (may include RE:/FW: prefixes)
   * @returns PDFs from thread history, or null if no thread exists
   */
  async getThreadPdfs(subject: string): Promise<ThreadPdfResult | null> {
    const thread = await this.loadThread(subject);

    if (!thread || thread.pdf_context.length === 0) {
      return null;
    }

    const pdfs: PdfAttachment[] = [];

    for (const threadPdf of thread.pdf_context) {
      try {
        const buffer = Buffer.from(threadPdf.content_base64, 'base64');
        pdfs.push({
          filename: threadPdf.filename,
          buffer
        });
      } catch (error) {
        const err = error as Error;
        logger.warn(`[ThreadService] Failed to decode PDF "${threadPdf.filename}": ${err.message}`);
        // Continue with other PDFs
      }
    }

    if (pdfs.length === 0) {
      return null;
    }

    const baseSubject = extractBaseSubject(subject);
    logger.info(`[ThreadService] Retrieved ${pdfs.length} PDF(s) from thread "${baseSubject.substring(0, 50)}..."`);

    return {
      pdfs,
      fromHistory: true,
      threadHash: thread.base_subject_hash
    };
  }

  /**
   * Check if a thread exists for a given subject
   */
  async hasThread(subject: string): Promise<boolean> {
    const threadPath = this.getThreadPath(subject);
    return existsSync(threadPath);
  }

  /**
   * Get thread info without loading full PDF content
   */
  async getThreadInfo(subject: string): Promise<{ exists: boolean; pdfCount: number; baseSubject: string } | null> {
    const thread = await this.loadThread(subject);

    if (!thread) {
      return null;
    }

    return {
      exists: true,
      pdfCount: thread.pdf_context.length,
      baseSubject: thread.base_subject
    };
  }

  /**
   * Clean up expired threads (not updated for > 7 days)
   * Called at startup to free storage space
   *
   * @returns Number of threads removed
   */
  async runCleanup(): Promise<number> {
    await this.ensureDirectory();

    const maxAge = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
    const now = Date.now();
    let cleanedCount = 0;

    try {
      const files = await readdir(this.threadDir);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = join(this.threadDir, file);

        try {
          const content = await readFile(filePath, 'utf-8');
          const thread = JSON.parse(content) as ConversationThread;
          const lastUpdated = new Date(thread.last_updated).getTime();

          if (now - lastUpdated > maxAge) {
            await unlink(filePath);
            cleanedCount++;
            logger.debug(`[ThreadService] Removed expired thread: ${thread.base_subject}`);
          }
        } catch (error) {
          const err = error as Error;
          logger.warn(`[ThreadService] Failed to process ${file}: ${err.message}`);
        }
      }

      if (cleanedCount > 0) {
        logger.info(`[ThreadService] Cleanup: ${cleanedCount} expired thread(s) removed`);
      }
    } catch (error) {
      const err = error as Error;
      logger.warn(`[ThreadService] Cleanup failed: ${err.message}`);
    }

    return cleanedCount;
  }
}

// Export singleton instance
export const conversationThreadService = new ConversationThreadService();
export default conversationThreadService;
