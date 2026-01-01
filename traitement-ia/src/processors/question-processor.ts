/**
 * Question Processor
 * Orchestrates the full question-answering pipeline:
 * 1. Preselection - Find relevant documents
 * 2. Readers - Extract information from each document
 * 3. Compiler - Synthesize into final answer
 */

import { runPreselection, PreselectionResult } from './preselection-processor.js';
import { runReaders, ReaderResult } from './reader-processor.js';
import { runCompiler, formatCompilerResult, CompilerResult } from './compiler-processor.js';
import { getDocumentCount } from '../persistence/database-service.js';
import { ModelLevel } from './flow-router.js';
import logger from '../utils/logger.js';

// Interface for question result
export interface QuestionResult {
  success: boolean;
  answer: string;
  formattedResponse: string;
  preselection: PreselectionResult | null;
  readerResults: ReaderResult[];
  compilerResult: CompilerResult | null;
  error?: string;
  processingTimeMs: number;
}

/**
 * Process a question through the full pipeline
 */
export async function processQuestion(
  question: string,
  modelLevel: ModelLevel
): Promise<QuestionResult> {
  const startTime = Date.now();

  logger.info(`[QUESTION] Processing question with model level: ${modelLevel}`);
  logger.info(`[QUESTION] Question: "${question.substring(0, 100)}${question.length > 100 ? '...' : ''}"`);

  // Check if we have any documents
  const docCount = getDocumentCount();
  if (docCount === 0) {
    logger.warn('[QUESTION] No documents in database');
    return {
      success: false,
      answer: '',
      formattedResponse: 'Aucun document n\'est présent dans la base de données.\n\nPour ajouter des documents, envoyez un email avec "(add)" dans l\'objet et le(s) document(s) PDF en pièce jointe.',
      preselection: null,
      readerResults: [],
      compilerResult: null,
      error: 'No documents in database',
      processingTimeMs: Date.now() - startTime
    };
  }

  logger.info(`[QUESTION] Database contains ${docCount} document(s)`);

  // Step 1: Preselection
  logger.info('[QUESTION] Step 1: Preselection');
  const preselection = await runPreselection(question, modelLevel);

  if (!preselection.success) {
    logger.error('[QUESTION] Preselection failed');
    return {
      success: false,
      answer: '',
      formattedResponse: 'Une erreur est survenue lors de l\'analyse des documents.\n\nVeuillez réessayer ultérieurement.',
      preselection,
      readerResults: [],
      compilerResult: null,
      error: preselection.error,
      processingTimeMs: Date.now() - startTime
    };
  }

  if (preselection.noRelevantDocs || preselection.selectedDocuments.length === 0) {
    logger.info('[QUESTION] No relevant documents found');
    return {
      success: true,
      answer: 'Aucun document pertinent',
      formattedResponse: `Aucun document dans la base ne semble traiter du sujet de votre question.\n\nDocuments analysés : ${docCount}\n\nSi vous pensez qu'un document devrait être pertinent, vérifiez qu'il a bien été importé avec "(add)".`,
      preselection,
      readerResults: [],
      compilerResult: null,
      processingTimeMs: Date.now() - startTime
    };
  }

  logger.info(`[QUESTION] Selected ${preselection.selectedDocuments.length} document(s) for analysis`);

  // Step 2: Readers
  logger.info('[QUESTION] Step 2: Readers');
  const documentIds = preselection.selectedDocuments.map(d => d.documentId);
  const readerResults = await runReaders(documentIds, question, modelLevel);

  // Check if we got any useful extractions
  const hasExtractions = readerResults.some(r => r.relevant || r.extractions.length > 0);

  if (!hasExtractions) {
    logger.info('[QUESTION] No relevant extractions found');
    return {
      success: true,
      answer: 'Pas d\'information pertinente',
      formattedResponse: `Les documents analysés ne contiennent pas d'information directement pertinente pour votre question.\n\nDocuments analysés : ${readerResults.length}\n\nEssayez de reformuler votre question ou vérifiez que les documents appropriés ont été importés.`,
      preselection,
      readerResults,
      compilerResult: null,
      processingTimeMs: Date.now() - startTime
    };
  }

  // Step 3: Compiler
  logger.info('[QUESTION] Step 3: Compiler');
  const compilerResult = await runCompiler(question, readerResults, modelLevel);

  if (!compilerResult.success) {
    logger.error('[QUESTION] Compiler failed');
    return {
      success: false,
      answer: '',
      formattedResponse: 'Une erreur est survenue lors de la synthèse des informations.\n\nVeuillez réessayer ultérieurement.',
      preselection,
      readerResults,
      compilerResult,
      error: compilerResult.error,
      processingTimeMs: Date.now() - startTime
    };
  }

  const processingTimeMs = Date.now() - startTime;
  const formattedResponse = formatCompilerResult(compilerResult);

  logger.info(`[QUESTION] Complete in ${processingTimeMs}ms`);

  return {
    success: true,
    answer: compilerResult.answer,
    formattedResponse,
    preselection,
    readerResults,
    compilerResult,
    processingTimeMs
  };
}

/**
 * Quick check if the database has documents
 */
export function hasDatabaseDocuments(): boolean {
  return getDocumentCount() > 0;
}

export default { processQuestion, hasDatabaseDocuments };
