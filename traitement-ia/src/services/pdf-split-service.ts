/**
 * PDF Split Service
 * Handles splitting of large PDFs into smaller parts
 */

import { PDFDocument } from 'pdf-lib';
import logger from '../utils/logger.js';

// Maximum pages per part (to stay under Mistral's 131k token limit)
// ~800 tokens per page average for dense documents
const MAX_PAGES_PER_PART = 100;

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
 * Calculate how many parts a PDF should be split into based on page count
 */
function calculatePartCount(pageCount: number): number {
  if (pageCount <= MAX_PAGES_PER_PART) {
    return 1;
  }
  return Math.ceil(pageCount / MAX_PAGES_PER_PART);
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
 * Check if a PDF might need to be split
 * Returns true for PDFs > 1MB (will check page count during split)
 */
export function needsSplit(sizeBytes: number): boolean {
  // Check any PDF > 1MB for potential split (based on page count)
  return sizeBytes > 1 * 1024 * 1024;
}

/**
 * Split a PDF buffer into multiple parts
 * Returns the original if no split needed, or array of parts
 * Splits by page count only (max 100 pages per part)
 */
export async function splitPdf(
  buffer: Buffer,
  filename: string
): Promise<SplitResult> {
  const originalSize = buffer.length;

  // Load PDF to get page count
  const pdfDoc = await PDFDocument.load(buffer);
  const totalPages = pdfDoc.getPageCount();

  // Calculate parts based on page count
  const partCount = calculatePartCount(totalPages);

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
        pageEnd: totalPages
      }],
      originalFilename: filename,
      originalSize,
      wasSplit: false
    };
  }

  logger.info(`[PDF-SPLIT] Splitting ${filename} (${totalPages} pages) into ${partCount} parts (max ${MAX_PAGES_PER_PART} pages/part)`);

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
 * Get max pages per part
 */
export function getMaxPagesPerPart(): number {
  return MAX_PAGES_PER_PART;
}
