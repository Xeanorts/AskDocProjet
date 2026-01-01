/**
 * PDF Split Service
 * Handles splitting of large PDFs into smaller parts
 */

import { PDFDocument } from 'pdf-lib';
import logger from '../utils/logger.js';

// Size threshold for splitting (20 MB)
const MAX_SIZE_BYTES = 20 * 1024 * 1024;

// Maximum size we can handle (even with splitting)
const MAX_SPLITTABLE_SIZE = 200 * 1024 * 1024;  // 200 MB

export interface SplitPdfPart {
  filename: string;
  buffer: Buffer;
  size: number;
  partIndex: number;
  totalParts: number;
  pageStart: number;
  pageEnd: number;
}

export interface SplitResult {
  parts: SplitPdfPart[];
  originalFilename: string;
  originalSize: number;
  wasSplit: boolean;
}

/**
 * Calculate how many parts a PDF should be split into based on size
 * 20-39 MB: 2 parts
 * 40-59 MB: 3 parts
 * 60-79 MB: 4 parts
 * etc.
 */
function calculatePartCount(sizeBytes: number): number {
  if (sizeBytes <= MAX_SIZE_BYTES) {
    return 1;
  }
  return Math.ceil(sizeBytes / MAX_SIZE_BYTES);
}

/**
 * Remove .pdf extension from filename
 */
function removeExtension(filename: string): string {
  if (filename.toLowerCase().endsWith('.pdf')) {
    return filename.slice(0, -4);
  }
  return filename;
}

/**
 * Check if a PDF needs to be split based on its size
 */
export function needsSplit(sizeBytes: number): boolean {
  return sizeBytes > MAX_SIZE_BYTES;
}

/**
 * Split a PDF buffer into multiple parts
 * Returns the original if no split needed, or array of parts
 * Splits by 20 MB chunks, dividing pages evenly
 */
export async function splitPdf(
  buffer: Buffer,
  filename: string
): Promise<SplitResult> {
  const originalSize = buffer.length;
  const partCount = calculatePartCount(originalSize);

  // No split needed
  if (partCount === 1) {
    return {
      parts: [{
        filename,
        buffer,
        size: originalSize,
        partIndex: 0,
        totalParts: 1,
        pageStart: 1,
        pageEnd: -1
      }],
      originalFilename: filename,
      originalSize,
      wasSplit: false
    };
  }

  // Check if too large even for splitting
  if (originalSize > MAX_SPLITTABLE_SIZE) {
    throw new Error(`PDF too large to split: ${(originalSize / 1024 / 1024).toFixed(1)} MB (max: ${MAX_SPLITTABLE_SIZE / 1024 / 1024} MB)`);
  }

  // Load PDF to get page count
  const pdfDoc = await PDFDocument.load(buffer);
  const totalPages = pdfDoc.getPageCount();

  logger.info(`[PDF-SPLIT] Splitting ${filename} (${(originalSize / 1024 / 1024).toFixed(1)} MB, ${totalPages} pages) into ${partCount} parts`);

  try {
    // Calculate pages per part (distribute evenly)
    const pagesPerPart = Math.ceil(totalPages / partCount);

    if (totalPages < partCount) {
      logger.warn(`[PDF-SPLIT] PDF has only ${totalPages} pages but needs ${partCount} parts`);
    }

    const parts: SplitPdfPart[] = [];
    const baseName = removeExtension(filename);

    for (let i = 0; i < partCount; i++) {
      const startPage = i * pagesPerPart;
      const endPage = Math.min((i + 1) * pagesPerPart, totalPages);

      // Skip if no pages for this part
      if (startPage >= totalPages) {
        break;
      }

      // Create new PDF with subset of pages
      const newPdf = await PDFDocument.create();
      const pageIndices = [];
      for (let p = startPage; p < endPage; p++) {
        pageIndices.push(p);
      }

      const copiedPages = await newPdf.copyPages(pdfDoc, pageIndices);
      for (const page of copiedPages) {
        newPdf.addPage(page);
      }

      // Save to buffer
      const pdfBytes = await newPdf.save();
      const partBuffer = Buffer.from(pdfBytes);

      const partFilename = `${baseName}-Part-${i}.pdf`;

      parts.push({
        filename: partFilename,
        buffer: partBuffer,
        size: partBuffer.length,
        partIndex: i,
        totalParts: partCount,
        pageStart: startPage + 1,  // 1-indexed for display
        pageEnd: endPage
      });

      logger.debug(`[PDF-SPLIT] Created ${partFilename}: pages ${startPage + 1}-${endPage} (${(partBuffer.length / 1024 / 1024).toFixed(1)} MB)`);
    }

    logger.info(`[PDF-SPLIT] Split complete: ${parts.length} parts created from ${totalPages} pages`);

    return {
      parts,
      originalFilename: filename,
      originalSize,
      wasSplit: true
    };
  } catch (error) {
    const err = error as Error;
    logger.error(`[PDF-SPLIT] Failed to split ${filename}: ${err.message}`);
    throw error;
  }
}

/**
 * Get size threshold for splitting
 */
export function getSplitThreshold(): number {
  return MAX_SIZE_BYTES;
}
