/**
 * Import Processor
 * Handles the import of PDF documents (single PDF or ZIP archive)
 * Uploads to Mistral OCR, analyzes with IA Indexation, and stores in SQLite
 */

import { createHash } from 'crypto';
import MistralService from '../services/mistral-service.js';
import { extractPdfsFromZip, isZipFile, isZipFilename, formatExtractionStats, ExtractionStats } from '../services/zip-extraction-service.js';
import { documentExistsByHash, insertDocument, getDocumentByHash, updateDocument, DocumentInsert, DocumentMetadata } from '../persistence/database-service.js';
import { loadLLMConfig } from '../utils/config-loader.js';
import { getModelName, ModelLevel } from './flow-router.js';
import { needsSplit, splitPdf, SplitPdfPart } from '../services/pdf-split-service.js';
import logger from '../utils/logger.js';

// Delay between API calls to avoid rate limiting (1 second)
const API_DELAY_MS = 1000;

// Interface for import result
export interface ImportResult {
  success: boolean;
  isZip: boolean;
  documents: ImportedDocument[];
  stats: ImportStats;
  error?: string;
}

export interface ImportedDocument {
  filename: string;
  sourcePath: string | null;
  title: string | null;
  documentType: string | null;
  subjects: string[];
  summary: string | null;
  isDuplicate: boolean;
  error?: string;
  // Split info (only present if document was split)
  wasSplit?: boolean;
  partIndex?: number;
  totalParts?: number;
  pageRange?: string;  // e.g., "1-20"
}

export interface ImportStats {
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  ignored: number;  // For ZIP: non-PDF files
  splitParts: number;  // Number of parts from split PDFs
}

// Interface for indexation IA response
interface IndexationResponse {
  title: string;
  document_type: string;
  subjects: string[];
  keywords: string[];
  summary: string;
  page_count: number;
}

/**
 * Compute SHA256 hash of a buffer
 */
function computeHash(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse the indexation response from the LLM
 */
function parseIndexationResponse(response: string): IndexationResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in indexation response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      title: parsed.title || null,
      document_type: parsed.document_type || null,
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
      summary: parsed.summary || null,
      page_count: typeof parsed.page_count === 'number' ? parsed.page_count : null
    };
  } catch (error) {
    const err = error as Error;
    logger.warn(`Failed to parse indexation response: ${err.message}`);
    return null;
  }
}

/**
 * Import Processor class
 */
class ImportProcessor {
  private mistralService: MistralService;

  constructor() {
    this.mistralService = new MistralService();
  }

  /**
   * Process an import email (single PDF or ZIP)
   */
  async processImport(
    attachments: Array<{ filename: string; buffer: Buffer }>,
    emailBody: string,
    modelLevel: ModelLevel
  ): Promise<ImportResult> {
    const stats: ImportStats = {
      total: 0,
      imported: 0,
      duplicates: 0,
      errors: 0,
      ignored: 0,
      splitParts: 0
    };

    const documents: ImportedDocument[] = [];
    let isZip = false;

    // Collect all PDFs to process
    const pdfsToProcess: Array<{ filename: string; sourcePath: string; buffer: Buffer }> = [];

    for (const attachment of attachments) {
      // Check if it's a ZIP file
      if (isZipFilename(attachment.filename) || isZipFile(attachment.buffer)) {
        isZip = true;
        logger.info(`[IMPORT] Processing ZIP archive: ${attachment.filename}`);

        try {
          const extractionResult = extractPdfsFromZip(attachment.buffer);

          stats.ignored = extractionResult.stats.ignoredCount;

          for (const pdf of extractionResult.pdfs) {
            pdfsToProcess.push({
              filename: pdf.filename,
              sourcePath: pdf.sourcePath,
              buffer: pdf.buffer
            });
          }
        } catch (error) {
          const err = error as Error;
          logger.error(`[IMPORT] Failed to extract ZIP: ${err.message}`);
          return {
            success: false,
            isZip: true,
            documents: [],
            stats,
            error: `Failed to extract ZIP archive: ${err.message}`
          };
        }
      } else if (attachment.filename.toLowerCase().endsWith('.pdf')) {
        // Single PDF
        pdfsToProcess.push({
          filename: attachment.filename,
          sourcePath: '',
          buffer: attachment.buffer
        });
      } else {
        // Ignore non-PDF files
        stats.ignored++;
        logger.debug(`[IMPORT] Ignoring non-PDF file: ${attachment.filename}`);
      }
    }

    stats.total = pdfsToProcess.length;

    if (pdfsToProcess.length === 0) {
      return {
        success: false,
        isZip,
        documents: [],
        stats,
        error: 'No PDF files found to import'
      };
    }

    logger.info(`[IMPORT] Processing ${pdfsToProcess.length} PDF(s)...`);

    // Process each PDF (with potential splitting for large files)
    let apiCallIndex = 0;
    for (let i = 0; i < pdfsToProcess.length; i++) {
      const pdf = pdfsToProcess[i];

      // Check if PDF needs splitting (> 20MB)
      if (needsSplit(pdf.buffer.length)) {
        logger.info(`[IMPORT] Large PDF detected: ${pdf.filename} (${(pdf.buffer.length / 1024 / 1024).toFixed(1)} MB) - splitting...`);

        try {
          const splitResult = await splitPdf(pdf.buffer, pdf.filename);

          logger.info(`[IMPORT] Split into ${splitResult.parts.length} parts`);
          stats.splitParts += splitResult.parts.length;

          // Process each part
          for (const part of splitResult.parts) {
            // Add delay between API calls
            if (apiCallIndex > 0) {
              await sleep(API_DELAY_MS);
            }
            apiCallIndex++;

            const result = await this.processSinglePdf(
              part.filename,
              pdf.sourcePath,
              part.buffer,
              emailBody,
              modelLevel
            );

            // Add split metadata
            result.wasSplit = true;
            result.partIndex = part.partIndex;
            result.totalParts = part.totalParts;
            result.pageRange = `${part.pageStart}-${part.pageEnd}`;

            documents.push(result);

            if (result.isDuplicate) {
              stats.duplicates++;
            } else if (result.error) {
              stats.errors++;
            } else {
              stats.imported++;
            }
          }
        } catch (splitError) {
          const err = splitError as Error;
          logger.error(`[IMPORT] Failed to split ${pdf.filename}: ${err.message}`);
          documents.push({
            filename: pdf.filename,
            sourcePath: pdf.sourcePath || null,
            title: null,
            documentType: null,
            subjects: [],
            summary: null,
            isDuplicate: false,
            error: `Failed to split PDF: ${err.message}`
          });
          stats.errors++;
        }
      } else {
        // Normal processing for PDFs <= 20MB
        // Add delay between API calls (except for the first one)
        if (apiCallIndex > 0) {
          await sleep(API_DELAY_MS);
        }
        apiCallIndex++;

        const result = await this.processSinglePdf(
          pdf.filename,
          pdf.sourcePath,
          pdf.buffer,
          emailBody,
          modelLevel
        );

        documents.push(result);

        if (result.isDuplicate) {
          stats.duplicates++;
        } else if (result.error) {
          stats.errors++;
        } else {
          stats.imported++;
        }
      }
    }

    logger.info(`[IMPORT] Complete: ${stats.imported} imported, ${stats.duplicates} duplicates, ${stats.errors} errors`);

    // Success if at least one document was imported or found as duplicate
    // (duplicates mean the doc is already in the database = OK)
    const hasResults = stats.imported > 0 || stats.duplicates > 0;

    return {
      success: hasResults || stats.errors === 0,
      isZip,
      documents,
      stats
    };
  }

  /**
   * Process a single PDF file
   */
  private async processSinglePdf(
    filename: string,
    sourcePath: string,
    buffer: Buffer,
    emailBody: string,
    modelLevel: ModelLevel
  ): Promise<ImportedDocument> {
    logger.info(`[IMPORT] Processing: ${sourcePath}${filename}`);

    // Step 1: Compute hash for deduplication
    const contentHash = computeHash(buffer);

    // Step 2: Check if document already exists
    if (documentExistsByHash(contentHash)) {
      const existing = getDocumentByHash(contentHash);
      logger.info(`[IMPORT] Duplicate detected: ${filename} (existing: ${existing?.filename})`);

      return {
        filename,
        sourcePath: sourcePath || null,
        title: existing?.title || null,
        documentType: existing?.document_type || null,
        subjects: existing?.subjects || [],
        summary: existing?.summary || null,
        isDuplicate: true
      };
    }

    try {
      // Step 3: Upload to Mistral OCR
      const fileId = await this.mistralService.uploadPdf(buffer, filename);

      // Step 4: Get signed URL for the document
      const documentUrl = await this.mistralService.getSignedUrl(fileId);

      // Step 5: Call IA Indexation
      const indexationResult = await this.callIndexationIA(
        documentUrl,
        filename,
        sourcePath,
        emailBody,
        modelLevel
      );

      if (!indexationResult) {
        throw new Error('Failed to analyze document with IA Indexation');
      }

      // Step 6: Insert into database
      const docInsert: DocumentInsert = {
        mistral_file_id: fileId,
        filename,
        source_path: sourcePath || null,
        title: indexationResult.title,
        document_type: indexationResult.document_type,
        subjects: indexationResult.subjects,
        keywords: indexationResult.keywords,
        summary: indexationResult.summary,
        page_count: indexationResult.page_count,
        content_hash: contentHash
      };

      insertDocument(docInsert);

      logger.info(`[IMPORT] Successfully imported: ${filename}`);

      return {
        filename,
        sourcePath: sourcePath || null,
        title: indexationResult.title,
        documentType: indexationResult.document_type,
        subjects: indexationResult.subjects,
        summary: indexationResult.summary,
        isDuplicate: false
      };
    } catch (error) {
      const err = error as Error;
      logger.error(`[IMPORT] Failed to import ${filename}: ${err.message}`);

      return {
        filename,
        sourcePath: sourcePath || null,
        title: null,
        documentType: null,
        subjects: [],
        summary: null,
        isDuplicate: false,
        error: err.message
      };
    }
  }

  /**
   * Call the IA Indexation to analyze a document
   */
  private async callIndexationIA(
    documentUrl: string,
    filename: string,
    sourcePath: string,
    emailBody: string,
    modelLevel: ModelLevel
  ): Promise<IndexationResponse | null> {
    try {
      const config = await loadLLMConfig('indexation');
      const model = getModelName(modelLevel);

      // Build context from email body and source path
      let context = '';
      if (emailBody && emailBody.trim()) {
        context += `Contexte fourni par l'utilisateur:\n${emailBody.trim()}\n\n`;
      }
      if (sourcePath) {
        context += `Chemin dans l'archive: ${sourcePath}\n\n`;
      }

      const prompt = `${context}Analyse ce document PDF et retourne les métadonnées au format JSON suivant:

{
  "title": "Titre du document",
  "document_type": "Type de document (ex: cahier des charges, spécifications, compte-rendu, contrat, documentation technique, etc.)",
  "subjects": ["Sujet 1", "Sujet 2"],
  "keywords": ["mot-clé 1", "mot-clé 2", "mot-clé 3"],
  "summary": "Résumé de 2-3 phrases décrivant le contenu et l'objectif du document",
  "page_count": 42
}

Retourne UNIQUEMENT le JSON, sans texte additionnel.`;

      // Build message with document
      const messages: any[] = [];

      if (config.system_prompt) {
        messages.push({
          role: 'system',
          content: config.system_prompt
        });
      }

      messages.push({
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'document_url', documentUrl }
        ]
      });

      // We need direct access to Mistral client - use a workaround
      // For now, we'll create a temporary client call
      const { Mistral } = await import('@mistralai/mistralai');
      const apiKey = process.env.MISTRAL_API_KEY;

      if (!apiKey) {
        throw new Error('MISTRAL_API_KEY not configured');
      }

      const client = new Mistral({ apiKey });

      logger.info(`[INDEXATION] Analyzing ${filename} with ${model}...`);

      const response = await client.chat.complete({
        model,
        messages,
        maxTokens: config.max_output_tokens || 2000,
        safePrompt: true
      });

      const content = response.choices?.[0]?.message?.content;
      if (!content) {
        throw new Error('Empty response from IA Indexation');
      }

      const responseText = typeof content === 'string' ? content : JSON.stringify(content);

      return parseIndexationResponse(responseText);
    } catch (error) {
      const err = error as Error;
      logger.error(`[INDEXATION] Failed: ${err.message}`);
      return null;
    }
  }
}

// Export singleton and functions
const importProcessor = new ImportProcessor();

export async function processImport(
  attachments: Array<{ filename: string; buffer: Buffer }>,
  emailBody: string,
  modelLevel: ModelLevel
): Promise<ImportResult> {
  return importProcessor.processImport(attachments, emailBody, modelLevel);
}

/**
 * Format import result for email confirmation
 */
export function formatImportConfirmation(result: ImportResult): string {
  const lines: string[] = [];

  if (result.isZip) {
    // ZIP format: stats only
    if (result.success) {
      lines.push('Import terminé');
    } else {
      lines.push('Import terminé avec des erreurs');
    }
    lines.push('');
    lines.push(`Documents importés : ${result.stats.imported}`);

    if (result.stats.splitParts > 0) {
      lines.push(`PDFs découpés : ${result.stats.splitParts} parties (fichiers > 20 MB)`);
    }
    if (result.stats.duplicates > 0) {
      lines.push(`Documents existants (mis à jour) : ${result.stats.duplicates}`);
    }
    if (result.stats.ignored > 0) {
      lines.push(`Fichiers ignorés : ${result.stats.ignored} (formats non supportés)`);
    }
    if (result.stats.errors > 0) {
      lines.push(`Erreurs : ${result.stats.errors}`);
    }
  } else {
    // Single PDF (or split into multiple parts)
    const doc = result.documents[0];

    if (!doc) {
      lines.push('Erreur: Aucun document traité');
      if (result.error) {
        lines.push(`Raison: ${result.error}`);
      }
    } else if (doc.error && !doc.wasSplit) {
      lines.push('Échec de l\'import');
      lines.push(`Fichier : ${doc.filename}`);
      lines.push(`Erreur : ${doc.error}`);
    } else if (result.stats.splitParts > 0) {
      // PDF was split into multiple parts
      lines.push('Document importé avec succès (découpé)');
      lines.push('');
      lines.push(`Fichier original : trop volumineux (> 20 MB)`);
      lines.push(`Parties créées : ${result.stats.splitParts}`);
      lines.push('');

      // Show each part
      for (const partDoc of result.documents) {
        if (partDoc.error) {
          lines.push(`- ${partDoc.filename} : ERREUR - ${partDoc.error}`);
        } else if (partDoc.isDuplicate) {
          lines.push(`- ${partDoc.filename} (pages ${partDoc.pageRange}) : déjà existant`);
        } else {
          lines.push(`- ${partDoc.filename} (pages ${partDoc.pageRange}) : importé`);
          if (partDoc.title) {
            lines.push(`  Titre : ${partDoc.title}`);
          }
        }
      }
    } else {
      if (doc.isDuplicate) {
        lines.push('Document existant mis à jour');
      } else {
        lines.push('Document importé avec succès');
      }

      lines.push('');
      lines.push(`Fichier : ${doc.filename}`);

      if (doc.title) {
        lines.push(`Titre : ${doc.title}`);
      }
      if (doc.documentType) {
        lines.push(`Type : ${doc.documentType}`);
      }
      if (doc.subjects && doc.subjects.length > 0) {
        lines.push(`Sujets : ${doc.subjects.join(', ')}`);
      }
      if (doc.summary) {
        lines.push(`Résumé : ${doc.summary}`);
      }

      if (doc.isDuplicate) {
        lines.push('');
        lines.push('Note : Ce document existait déjà dans la base.');
      }
    }
  }

  return lines.join('\n');
}

export default importProcessor;
