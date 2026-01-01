/**
 * File Storage Service
 * Manages reading and writing of JSON files for email processing
 */

import { readdir, readFile, writeFile, rename, mkdir, unlink } from 'fs/promises';
import { join, basename } from 'path';
import { existsSync } from 'fs';
import logger from '../utils/logger.js';

export interface EmailData {
  id: string;
  from?: {
    text?: string;
    address?: string;
  };
  subject?: string;
  body_text?: string;
  body_html?: string;
  textAsHtml?: string;
  date?: string;
  receivedAt?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content_base64?: string;
  }>;
}

export interface ProcessedEmailData {
  email_id: string;
  from: string;
  subject: string;
  received_at: string;
  ai_response: string | null;
  ai_model: string | null;
  status: 'ok' | 'error';
  error_message?: string;
  processed_at: string;
  processing_time_ms?: number;
  api_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  pdf_filename?: string;
  pdf_filenames?: string[];  // List of all processed PDFs
  processing_type?: string;
  error_type?: string;
}

class FileStorage {
  private basePath: string;
  private inputDir: string;
  private outputDir: string;
  private pdfCacheDir: string;

  constructor() {
    this.basePath = process.env.STORAGE_PATH || '/app/storage';
    this.inputDir = process.env.IA_INPUT_DIR || '00_mail_in';
    this.outputDir = process.env.IA_OUTPUT_DIR || '10_ia_requests';
    this.pdfCacheDir = '11_pdf_cache';
  }

  getBasePath(): string {
    return this.basePath;
  }

  getInputDir(): string {
    return this.inputDir;
  }

  getOutputDir(): string {
    return this.outputDir;
  }

  getInputPath(): string {
    return join(this.basePath, this.inputDir);
  }

  getOutputPath(): string {
    return join(this.basePath, this.outputDir);
  }

  getPdfCachePath(): string {
    return join(this.basePath, this.pdfCacheDir);
  }

  async ensureOutputDir(): Promise<void> {
    const outputPath = this.getOutputPath();
    if (!existsSync(outputPath)) {
      await mkdir(outputPath, { recursive: true });
      logger.info(`Created output directory: ${outputPath}`);
    }
  }

  async getProcessedEmailIds(): Promise<Set<string>> {
    const outputPath = this.getOutputPath();
    const processedIds = new Set<string>();

    try {
      if (!existsSync(outputPath)) {
        return processedIds;
      }

      const files = await readdir(outputPath);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        try {
          const filePath = join(outputPath, file);
          const content = await readFile(filePath, 'utf-8');
          const data = JSON.parse(content) as ProcessedEmailData;

          if (data.email_id) {
            processedIds.add(data.email_id);
          }
        } catch (error) {
          const err = error as Error;
          logger.warn(`Could not read processed file ${file}:`, err.message);
        }
      }

      logger.debug(`Found ${processedIds.size} already processed emails`);
    } catch (error) {
      const err = error as Error;
      logger.error('Error scanning processed emails:', err.message);
    }

    return processedIds;
  }

  async listUnprocessedEmails(): Promise<string[]> {
    const inputPath = this.getInputPath();

    try {
      const files = await readdir(inputPath);
      const jsonFiles = files.filter(f => f.endsWith('.json')).sort();

      const processedIds = await this.getProcessedEmailIds();

      const unprocessed: string[] = [];

      for (const file of jsonFiles) {
        const filePath = join(inputPath, file);

        try {
          const content = await readFile(filePath, 'utf-8');
          const email = JSON.parse(content) as EmailData;

          if (!processedIds.has(email.id)) {
            unprocessed.push(filePath);
          }
        } catch (error) {
          const err = error as Error;
          logger.warn(`Could not read email file ${file}:`, err.message);
        }
      }

      logger.debug(`Found ${unprocessed.length} unprocessed emails`);
      return unprocessed;
    } catch (error) {
      const err = error as Error;
      logger.error('Error listing unprocessed emails:', err.message);
      return [];
    }
  }

  async readEmail(filepath: string): Promise<EmailData> {
    try {
      const content = await readFile(filepath, 'utf-8');
      const email = JSON.parse(content) as EmailData;
      logger.debug(`Read email: ${email.id}`);
      return email;
    } catch (error) {
      const err = error as Error;
      logger.error(`Error reading email from ${filepath}:`, err.message);
      throw error;
    }
  }

  async saveProcessedEmail(data: ProcessedEmailData): Promise<string> {
    await this.ensureOutputDir();

    const filename = `${data.email_id}.ia.json`;
    const filepath = join(this.getOutputPath(), filename);
    const tempPath = `${filepath}.tmp`;

    try {
      await writeFile(tempPath, JSON.stringify(data, null, 2), 'utf-8');
      await rename(tempPath, filepath);

      logger.info(`Saved processed email: ${filename}`);
      return filepath;
    } catch (error) {
      const err = error as Error;
      logger.error(`Error saving processed email ${filename}:`, err.message);
      throw error;
    }
  }

  async isAlreadyProcessed(emailId: string): Promise<boolean> {
    const processedIds = await this.getProcessedEmailIds();
    return processedIds.has(emailId);
  }

  async deleteEmailFile(filepath: string): Promise<void> {
    try {
      await unlink(filepath);
      logger.info(`[CLEANUP] Deleted processed email file: ${basename(filepath)}`);
    } catch (error) {
      const err = error as Error;
      logger.error(`[CLEANUP] Failed to delete ${basename(filepath)}:`, err.message);
    }
  }
}

const fileStorage = new FileStorage();

export const getProcessedEmailIds = (): Promise<Set<string>> => fileStorage.getProcessedEmailIds();
export const listUnprocessedEmails = (): Promise<string[]> => fileStorage.listUnprocessedEmails();
export const readEmail = (filepath: string): Promise<EmailData> => fileStorage.readEmail(filepath);
export const saveProcessedEmail = (data: ProcessedEmailData): Promise<string> => fileStorage.saveProcessedEmail(data);
export const isAlreadyProcessed = (emailId: string): Promise<boolean> => fileStorage.isAlreadyProcessed(emailId);
export const deleteEmailFile = (filepath: string): Promise<void> => fileStorage.deleteEmailFile(filepath);
export const getPdfCachePath = (): string => fileStorage.getPdfCachePath();

export default fileStorage;
