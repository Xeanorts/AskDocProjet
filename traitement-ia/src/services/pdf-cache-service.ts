/**
 * PDF Cache Service
 * Caches PDF uploads to Mistral to avoid re-uploading identical files
 * Identifies PDFs by SHA256 hash of content (not filename)
 */

import { createHash } from 'crypto';
import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import logger from '../utils/logger.js';
import fileStorage from '../persistence/file-storage.js';

/**
 * Cache entry stored on disk
 */
export interface PdfCacheEntry {
  hash: string;
  fileId: string;
  uploadedAt: string;
  lastUsedAt: string;
  originalFilename: string;
  sizeBytes: number;
}

/**
 * Result returned when getting or creating a cache entry
 */
export interface CacheResult {
  fileId: string;
  fromCache: boolean;
  hash: string;
}

/**
 * Internal structure for cache index
 */
interface CacheIndex {
  version: number;
  entries: Record<string, PdfCacheEntry>;
}

const CACHE_VERSION = 1;
const CACHE_TTL_DAYS = 7;
const CACHE_TTL_MS = CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
const CACHE_INDEX_FILE = 'cache-index.json';

class PdfCacheService {
  private cacheDir: string;
  private indexPath: string;

  constructor() {
    this.cacheDir = join(fileStorage.getBasePath(), '11_pdf_cache');
    this.indexPath = join(this.cacheDir, CACHE_INDEX_FILE);
  }

  /**
   * Get cached fileId or upload and cache
   * @param buffer PDF content buffer
   * @param filename Original filename (for logging)
   * @param uploadFn Function to call if upload needed
   */
  async getOrUpload(
    buffer: Buffer,
    filename: string,
    uploadFn: () => Promise<string>
  ): Promise<CacheResult> {
    const hash = this.computeHash(buffer);

    await this.ensureCacheDir();
    const index = await this.loadIndex();

    const entry = index.entries[hash];

    if (entry && !this.isExpired(entry)) {
      // Cache hit - update lastUsedAt
      entry.lastUsedAt = new Date().toISOString();
      await this.saveIndex(index);

      logger.debug(`[PDF Cache] Hit for ${filename} (hash: ${hash.substring(0, 8)}...)`);
      return { fileId: entry.fileId, fromCache: true, hash };
    }

    // Cache miss or expired - upload
    logger.debug(`[PDF Cache] Miss for ${filename}, uploading...`);
    const fileId = await uploadFn();

    // Store in cache
    index.entries[hash] = {
      hash,
      fileId,
      uploadedAt: new Date().toISOString(),
      lastUsedAt: new Date().toISOString(),
      originalFilename: filename,
      sizeBytes: buffer.length
    };

    await this.saveIndex(index);

    logger.debug(`[PDF Cache] Cached ${filename} (hash: ${hash.substring(0, 8)}...)`);
    return { fileId, fromCache: false, hash };
  }

  /**
   * Update lastUsedAt for an existing entry
   */
  async markAsUsed(hash: string): Promise<void> {
    const index = await this.loadIndex();

    if (index.entries[hash]) {
      index.entries[hash].lastUsedAt = new Date().toISOString();
      await this.saveIndex(index);
    }
  }

  /**
   * Invalidate a cache entry (e.g., when Mistral reports fileId invalid)
   */
  async invalidateEntry(hash: string): Promise<void> {
    const index = await this.loadIndex();

    if (index.entries[hash]) {
      logger.info(`[PDF Cache] Invalidating entry for hash ${hash.substring(0, 8)}...`);
      delete index.entries[hash];
      await this.saveIndex(index);
    }
  }

  /**
   * Run cleanup of expired entries (not used for > 7 days)
   * @param deleteFn Function to delete file from Mistral
   * @returns Number of entries cleaned up
   */
  async runCleanup(deleteFn: (fileId: string) => Promise<void>): Promise<number> {
    logger.info('[PDF Cache] Running cleanup...');

    await this.ensureCacheDir();
    const index = await this.loadIndex();
    let cleanedCount = 0;

    for (const [hash, entry] of Object.entries(index.entries)) {
      if (this.isExpired(entry)) {
        logger.info(`[PDF Cache] Cleaning expired: ${entry.originalFilename} (last used ${entry.lastUsedAt})`);

        try {
          await deleteFn(entry.fileId);
          logger.debug(`[PDF Cache] Deleted from Mistral: ${entry.fileId}`);
        } catch (error) {
          const err = error as Error;
          logger.debug(`[PDF Cache] Delete failed (may be already gone): ${err.message}`);
        }

        delete index.entries[hash];
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      await this.saveIndex(index);
    }

    logger.info(`[PDF Cache] Cleanup complete: ${cleanedCount} entries removed, ${Object.keys(index.entries).length} remaining`);
    return cleanedCount;
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{ entryCount: number; totalSizeBytes: number }> {
    const index = await this.loadIndex();

    let totalSize = 0;
    for (const entry of Object.values(index.entries)) {
      totalSize += entry.sizeBytes;
    }

    return {
      entryCount: Object.keys(index.entries).length,
      totalSizeBytes: totalSize
    };
  }

  /**
   * Compute SHA256 hash of buffer
   */
  private computeHash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  /**
   * Ensure cache directory exists
   */
  private async ensureCacheDir(): Promise<void> {
    if (!existsSync(this.cacheDir)) {
      await mkdir(this.cacheDir, { recursive: true });
      logger.info(`[PDF Cache] Created cache directory: ${this.cacheDir}`);
    }
  }

  /**
   * Load cache index from disk
   */
  private async loadIndex(): Promise<CacheIndex> {
    try {
      if (!existsSync(this.indexPath)) {
        return { version: CACHE_VERSION, entries: {} };
      }

      const content = await readFile(this.indexPath, 'utf-8');
      const index = JSON.parse(content) as CacheIndex;

      // Version check for future migrations
      if (index.version !== CACHE_VERSION) {
        logger.warn(`[PDF Cache] Index version mismatch (found ${index.version}, expected ${CACHE_VERSION}), resetting cache`);
        return { version: CACHE_VERSION, entries: {} };
      }

      return index;
    } catch (error) {
      const err = error as Error;
      logger.warn(`[PDF Cache] Could not load index: ${err.message}`);
      return { version: CACHE_VERSION, entries: {} };
    }
  }

  /**
   * Save cache index to disk (atomic write)
   */
  private async saveIndex(index: CacheIndex): Promise<void> {
    const tempPath = `${this.indexPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(index, null, 2), 'utf-8');
    await rename(tempPath, this.indexPath);
  }

  /**
   * Check if entry is expired (not used for > 7 days)
   */
  private isExpired(entry: PdfCacheEntry): boolean {
    const lastUsed = new Date(entry.lastUsedAt).getTime();
    return (Date.now() - lastUsed) > CACHE_TTL_MS;
  }
}

const pdfCacheService = new PdfCacheService();

export default pdfCacheService;
