/**
 * ZIP Extraction Service
 * Handles extraction of PDF files from ZIP archives
 */

import AdmZip from 'adm-zip';
import logger from '../utils/logger.js';

// Constants for limits
const MAX_PDF_SIZE_BYTES = 30 * 1024 * 1024;  // 30 MB per PDF
const MAX_TOTAL_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB total
const MAX_PDF_COUNT = 10;
const MAX_DEPTH = 5;  // Maximum folder depth

// System files/folders to ignore silently (not counted in report)
const SYSTEM_PATTERNS = [
  '__MACOSX',
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.Spotlight-',
  '.Trashes',
  '.fseventsd'
];

export interface ExtractedPdf {
  filename: string;
  sourcePath: string;  // Path within the ZIP (e.g., "specs/architecture/")
  buffer: Buffer;
  size: number;
}

export interface ExtractionResult {
  pdfs: ExtractedPdf[];
  stats: ExtractionStats;
}

export interface ExtractionStats {
  totalFiles: number;
  pdfCount: number;
  ignoredCount: number;  // Non-PDF files
  errorCount: number;    // PDFs too large or other errors
  duplicateCount: number; // Same filename in different folders (kept first)
}

/**
 * Check if a file is a PDF based on extension
 */
function isPdfFile(filename: string): boolean {
  return filename.toLowerCase().endsWith('.pdf');
}

/**
 * Check if a path is a system file/folder to ignore silently
 */
function isSystemFile(fullPath: string): boolean {
  return SYSTEM_PATTERNS.some(pattern => fullPath.includes(pattern));
}

/**
 * Get the directory path from a full path
 */
function getDirectoryPath(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash === -1) return '';
  return fullPath.substring(0, lastSlash + 1);
}

/**
 * Get the filename from a full path
 */
function getFilename(fullPath: string): string {
  const lastSlash = fullPath.lastIndexOf('/');
  if (lastSlash === -1) return fullPath;
  return fullPath.substring(lastSlash + 1);
}

/**
 * Get the depth of a path (number of folder levels)
 */
function getPathDepth(path: string): number {
  if (!path) return 0;
  return path.split('/').filter(part => part.length > 0).length;
}

/**
 * Extract all PDFs from a ZIP buffer
 */
export function extractPdfsFromZip(zipBuffer: Buffer): ExtractionResult {
  const stats: ExtractionStats = {
    totalFiles: 0,
    pdfCount: 0,
    ignoredCount: 0,
    errorCount: 0,
    duplicateCount: 0
  };

  const pdfs: ExtractedPdf[] = [];
  const seenFilenames = new Set<string>();
  let totalSize = 0;

  try {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    logger.info(`[ZIP] Opening archive with ${entries.length} entries`);

    for (const entry of entries) {
      // Skip directories
      if (entry.isDirectory) continue;

      const fullPath = entry.entryName;
      const filename = getFilename(fullPath);
      const sourcePath = getDirectoryPath(fullPath);
      const depth = getPathDepth(fullPath);

      // Skip system files silently (not counted)
      if (isSystemFile(fullPath) || filename.startsWith('.')) {
        continue;
      }

      stats.totalFiles++;

      // Skip if too deep in folder structure
      if (depth > MAX_DEPTH) {
        logger.warn(`[ZIP] Skipping ${fullPath}: exceeds max depth of ${MAX_DEPTH}`);
        stats.ignoredCount++;
        continue;
      }

      // Check if it's a PDF
      if (!isPdfFile(filename)) {
        stats.ignoredCount++;
        continue;
      }

      // Check for duplicates (same filename in different folders)
      if (seenFilenames.has(filename.toLowerCase())) {
        logger.warn(`[ZIP] Duplicate filename: ${filename} (keeping first occurrence)`);
        stats.duplicateCount++;
        continue;
      }

      // Check max count
      if (pdfs.length >= MAX_PDF_COUNT) {
        logger.warn(`[ZIP] Maximum PDF count (${MAX_PDF_COUNT}) reached, skipping remaining`);
        stats.errorCount++;
        continue;
      }

      try {
        const buffer = entry.getData();
        const size = buffer.length;

        // Check individual file size
        if (size > MAX_PDF_SIZE_BYTES) {
          logger.warn(`[ZIP] PDF too large: ${filename} (${(size / 1024 / 1024).toFixed(2)} MB > 30 MB)`);
          stats.errorCount++;
          continue;
        }

        // Check total size
        if (totalSize + size > MAX_TOTAL_SIZE_BYTES) {
          logger.warn(`[ZIP] Total size limit exceeded, skipping: ${filename}`);
          stats.errorCount++;
          continue;
        }

        pdfs.push({
          filename,
          sourcePath,
          buffer,
          size
        });

        seenFilenames.add(filename.toLowerCase());
        totalSize += size;
        stats.pdfCount++;

        logger.debug(`[ZIP] Extracted: ${sourcePath}${filename} (${(size / 1024).toFixed(1)} KB)`);
      } catch (error) {
        const err = error as Error;
        logger.error(`[ZIP] Failed to extract ${fullPath}: ${err.message}`);
        stats.errorCount++;
      }
    }

    logger.info(`[ZIP] Extraction complete: ${stats.pdfCount} PDFs, ${stats.ignoredCount} ignored, ${stats.errorCount} errors`);

  } catch (error) {
    const err = error as Error;
    logger.error(`[ZIP] Failed to open archive: ${err.message}`);
    throw error;
  }

  return { pdfs, stats };
}

/**
 * Check if a buffer is a valid ZIP file
 */
export function isZipFile(buffer: Buffer): boolean {
  // ZIP files start with PK (0x50 0x4B)
  if (buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4B;
}

/**
 * Check if a filename suggests it's a ZIP file
 */
export function isZipFilename(filename: string): boolean {
  return filename.toLowerCase().endsWith('.zip');
}

/**
 * Format extraction stats for email confirmation
 */
export function formatExtractionStats(stats: ExtractionStats, archiveName: string): string {
  const lines: string[] = [
    `Archive : ${archiveName}`,
    '',
    `Documents importés : ${stats.pdfCount}`,
  ];

  if (stats.ignoredCount > 0) {
    lines.push(`Fichiers ignorés : ${stats.ignoredCount} (formats non supportés)`);
  }

  if (stats.errorCount > 0) {
    lines.push(`Erreurs : ${stats.errorCount} (PDF trop volumineux ou illisibles)`);
  }

  if (stats.duplicateCount > 0) {
    lines.push(`Doublons ignorés : ${stats.duplicateCount}`);
  }

  return lines.join('\n');
}
