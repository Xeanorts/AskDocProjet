/**
 * Reader Processor
 * IA Lectrices - Analyze documents in parallel to extract relevant information
 */

import { Mistral } from '@mistralai/mistralai';
import { getDocumentsByIds, DocumentMetadata } from '../persistence/database-service.js';
import { loadLLMConfig } from '../utils/config-loader.js';
import { getModelName, ModelLevel } from './flow-router.js';
import logger from '../utils/logger.js';

// Delay between API calls to avoid rate limiting (1 second)
const API_DELAY_MS = 1000;

// Maximum concurrent readers
const MAX_CONCURRENT_READERS = 5;

// Timeout per document (60 seconds)
const READER_TIMEOUT_MS = 60000;

// Interface for extraction
export interface Extraction {
  content: string;
  page: number | null;
  section: string | null;
  relevanceToQuestion: string;
}

// Interface for reader result
export interface ReaderResult {
  documentId: string;
  documentTitle: string;
  filename: string;
  relevant: boolean;
  extractions: Extraction[];
  summary: string;
  confidence: number;
  error?: string;
}

// Interface for LLM response
interface ReaderResponse {
  relevant: boolean;
  confidence: number;
  extractions: Array<{
    content: string;
    page?: number;
    section?: string;
    relevance_to_question?: string;
  }>;
  summary: string;
}

/**
 * Parse the reader response from the LLM
 */
function parseReaderResponse(response: string): ReaderResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in reader response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      relevant: parsed.relevant === true,
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      extractions: Array.isArray(parsed.extractions)
        ? parsed.extractions.map((e: any) => ({
            content: e.content || '',
            page: typeof e.page === 'number' ? e.page : null,
            section: e.section || null,
            relevance_to_question: e.relevance_to_question || ''
          }))
        : [],
      summary: parsed.summary || ''
    };
  } catch (error) {
    const err = error as Error;
    logger.warn(`Failed to parse reader response: ${err.message}`);
    return null;
  }
}

/**
 * Sleep for a given number of milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Read a single document and extract relevant information
 */
async function readDocument(
  document: DocumentMetadata,
  question: string,
  model: string,
  systemPrompt: string,
  maxTokens: number
): Promise<ReaderResult> {
  const startTime = Date.now();

  try {
    logger.info(`[READER] Analyzing: ${document.filename}`);

    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY not configured');
    }

    const client = new Mistral({ apiKey });

    // Get signed URL for the document
    const signedUrl = await client.files.getSignedUrl({
      fileId: document.mistral_file_id
    });

    // Build prompt
    const prompt = `Question de l'utilisateur:
"${question}"

Document à analyser:
- Titre: ${document.title || document.filename}
- Type: ${document.document_type || 'Non spécifié'}
- Résumé: ${document.summary || 'Non disponible'}

Analyse ce document et extrais toutes les informations pertinentes pour répondre à la question.

Retourne ta réponse au format JSON suivant:

{
  "relevant": true,
  "confidence": 0.85,
  "extractions": [
    {
      "content": "Texte exact extrait du document",
      "page": 12,
      "section": "3.2 Architecture",
      "relevance_to_question": "Cette information répond à la question car..."
    }
  ],
  "summary": "Résumé de ce que ce document apporte à la question"
}

Si le document ne contient aucune information pertinente:
{
  "relevant": false,
  "confidence": 0.9,
  "extractions": [],
  "summary": "Ce document ne contient pas d'information pertinente pour cette question"
}

Retourne UNIQUEMENT le JSON, sans texte additionnel.`;

    // Build messages
    const messages: any[] = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt
      });
    }

    messages.push({
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'document_url', documentUrl: signedUrl.url }
      ]
    });

    // Call Mistral API with timeout
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Reader timeout')), READER_TIMEOUT_MS);
    });

    const apiPromise = client.chat.complete({
      model,
      messages,
      maxTokens,
      safePrompt: true
    });

    const response = await Promise.race([apiPromise, timeoutPromise]);

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from reader');
    }

    const responseText = typeof content === 'string' ? content : JSON.stringify(content);
    const parsed = parseReaderResponse(responseText);

    if (!parsed) {
      throw new Error('Failed to parse reader response');
    }

    const processingTime = Date.now() - startTime;
    logger.info(`[READER] Completed: ${document.filename} (${processingTime}ms, ${parsed.extractions.length} extractions)`);

    return {
      documentId: document.id,
      documentTitle: document.title || document.filename,
      filename: document.filename,
      relevant: parsed.relevant,
      extractions: parsed.extractions.map(e => ({
        content: e.content,
        page: e.page || null,
        section: e.section || null,
        relevanceToQuestion: e.relevance_to_question || ''
      })),
      summary: parsed.summary,
      confidence: parsed.confidence
    };
  } catch (error) {
    const err = error as Error;
    const processingTime = Date.now() - startTime;
    logger.error(`[READER] Failed: ${document.filename} (${processingTime}ms) - ${err.message}`);

    return {
      documentId: document.id,
      documentTitle: document.title || document.filename,
      filename: document.filename,
      relevant: false,
      extractions: [],
      summary: '',
      confidence: 0,
      error: err.message
    };
  }
}

/**
 * Run readers on multiple documents in parallel
 */
export async function runReaders(
  documentIds: string[],
  question: string,
  modelLevel: ModelLevel
): Promise<ReaderResult[]> {
  if (documentIds.length === 0) {
    logger.info('[READER] No documents to analyze');
    return [];
  }

  // Get documents from database
  const documents = getDocumentsByIds(documentIds);

  if (documents.length === 0) {
    logger.warn('[READER] No documents found in database');
    return [];
  }

  logger.info(`[READER] Analyzing ${documents.length} document(s)...`);

  // Load config
  const config = await loadLLMConfig('reader');
  const model = getModelName(modelLevel);
  const systemPrompt = config.system_prompt || '';
  const maxTokens = config.max_output_tokens || 4000;

  const results: ReaderResult[] = [];

  // Process documents with rate limiting
  // Use batches to limit concurrent requests
  for (let i = 0; i < documents.length; i += MAX_CONCURRENT_READERS) {
    const batch = documents.slice(i, i + MAX_CONCURRENT_READERS);

    // Add delay between batches (except for the first batch)
    if (i > 0) {
      await sleep(API_DELAY_MS);
    }

    // Process batch in parallel
    const batchPromises = batch.map((doc, index) =>
      // Stagger requests within batch
      sleep(index * API_DELAY_MS).then(() =>
        readDocument(doc, question, model, systemPrompt, maxTokens)
      )
    );

    const batchResults = await Promise.allSettled(batchPromises);

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        logger.error(`[READER] Batch error: ${result.reason}`);
      }
    }
  }

  // Filter to only relevant results
  const relevantResults = results.filter(r => r.relevant || r.extractions.length > 0);
  logger.info(`[READER] Found ${relevantResults.length} relevant document(s) out of ${results.length}`);

  return results;
}

export default { runReaders };
