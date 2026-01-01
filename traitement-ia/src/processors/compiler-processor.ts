/**
 * Compiler Processor
 * IA Compilatrice - Synthesizes all reader extractions into a final answer
 */

import { Mistral } from '@mistralai/mistralai';
import { loadLLMConfig } from '../utils/config-loader.js';
import { getModelName, ModelLevel } from './flow-router.js';
import { ReaderResult } from './reader-processor.js';
import logger from '../utils/logger.js';

// Interface for source citation
export interface Source {
  documentTitle: string;
  page: number | null;
  quote: string;
}

// Interface for compiler result
export interface CompilerResult {
  success: boolean;
  answer: string;
  sources: Source[];
  confidence: number;
  documentsAnalyzed: number;
  error?: string;
}

// Interface for LLM response
interface CompilerResponse {
  answer: string;
  sources: Array<{
    document_title: string;
    page?: number;
    quote: string;
  }>;
  confidence: number;
}

/**
 * Parse the compiler response from the LLM
 */
function parseCompilerResponse(response: string): CompilerResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in compiler response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      answer: parsed.answer || '',
      sources: Array.isArray(parsed.sources)
        ? parsed.sources.map((s: any) => ({
            document_title: s.document_title || '',
            page: typeof s.page === 'number' ? s.page : null,
            quote: s.quote || ''
          }))
        : [],
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5
    };
  } catch (error) {
    const err = error as Error;
    logger.warn(`Failed to parse compiler response: ${err.message}`);
    return null;
  }
}

/**
 * Format reader results for the compiler prompt
 */
function formatExtractionsForPrompt(readerResults: ReaderResult[]): string {
  const relevantResults = readerResults.filter(r => r.relevant || r.extractions.length > 0);

  if (relevantResults.length === 0) {
    return 'Aucune information pertinente trouvée dans les documents analysés.';
  }

  return relevantResults.map(result => {
    const lines = [
      `## Document: ${result.documentTitle}`,
      `Fichier: ${result.filename}`,
      `Confiance: ${Math.round(result.confidence * 100)}%`,
      `Résumé: ${result.summary}`,
      ''
    ];

    if (result.extractions.length > 0) {
      lines.push('Extractions:');
      for (const extraction of result.extractions) {
        const location = [
          extraction.page ? `Page ${extraction.page}` : null,
          extraction.section ? `Section: ${extraction.section}` : null
        ].filter(Boolean).join(', ');

        lines.push(`- ${location ? `[${location}] ` : ''}${extraction.content}`);
        if (extraction.relevanceToQuestion) {
          lines.push(`  → ${extraction.relevanceToQuestion}`);
        }
      }
    }

    return lines.join('\n');
  }).join('\n\n---\n\n');
}

/**
 * Compile reader results into a final answer
 */
export async function runCompiler(
  question: string,
  readerResults: ReaderResult[],
  modelLevel: ModelLevel
): Promise<CompilerResult> {
  const documentsAnalyzed = readerResults.length;

  // Check if we have any relevant extractions
  const hasRelevantData = readerResults.some(r => r.relevant || r.extractions.length > 0);

  if (!hasRelevantData) {
    logger.info('[COMPILER] No relevant data from readers');
    return {
      success: true,
      answer: 'Aucun document analysé ne contient d\'information pertinente pour répondre à cette question.',
      sources: [],
      confidence: 0,
      documentsAnalyzed
    };
  }

  try {
    logger.info(`[COMPILER] Synthesizing ${documentsAnalyzed} document(s)...`);

    // Load config
    const config = await loadLLMConfig('compiler');
    const model = getModelName(modelLevel);

    // Format extractions for prompt
    const extractionsText = formatExtractionsForPrompt(readerResults);

    // Build prompt
    const prompt = `Question de l'utilisateur:
"${question}"

Informations extraites des documents:

${extractionsText}

---

Synthétise ces informations pour répondre à la question de l'utilisateur.
Ta réponse doit être:
- Claire et bien structurée
- Basée uniquement sur les informations extraites
- Avec des citations précises des sources

Retourne ta réponse au format JSON suivant:

{
  "answer": "Réponse détaillée et argumentée basée sur les documents...",
  "sources": [
    {
      "document_title": "Nom du document",
      "page": 12,
      "quote": "Citation exacte du document"
    }
  ],
  "confidence": 0.85
}

Retourne UNIQUEMENT le JSON, sans texte additionnel.`;

    // Build messages
    const messages: any[] = [];

    if (config.system_prompt) {
      messages.push({
        role: 'system',
        content: config.system_prompt
      });
    }

    messages.push({
      role: 'user',
      content: prompt
    });

    // Call Mistral API
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('MISTRAL_API_KEY not configured');
    }

    const client = new Mistral({ apiKey });

    logger.info(`[COMPILER] Calling Mistral API with model ${model}...`);

    const response = await client.chat.complete({
      model,
      messages,
      maxTokens: config.max_output_tokens || 4000,
      safePrompt: true
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from compiler');
    }

    const responseText = typeof content === 'string' ? content : JSON.stringify(content);
    const parsed = parseCompilerResponse(responseText);

    if (!parsed) {
      throw new Error('Failed to parse compiler response');
    }

    logger.info(`[COMPILER] Complete: ${parsed.sources.length} sources cited`);

    return {
      success: true,
      answer: parsed.answer,
      sources: parsed.sources.map(s => ({
        documentTitle: s.document_title,
        page: s.page || null,
        quote: s.quote
      })),
      confidence: parsed.confidence,
      documentsAnalyzed
    };
  } catch (error) {
    const err = error as Error;
    logger.error(`[COMPILER] Failed: ${err.message}`);
    return {
      success: false,
      answer: '',
      sources: [],
      confidence: 0,
      documentsAnalyzed,
      error: err.message
    };
  }
}

/**
 * Format compiler result for email response
 */
export function formatCompilerResult(result: CompilerResult): string {
  const lines: string[] = [];

  if (!result.success) {
    lines.push('Une erreur est survenue lors de la génération de la réponse.');
    if (result.error) {
      lines.push(`Erreur: ${result.error}`);
    }
    return lines.join('\n');
  }

  // Main answer
  lines.push(result.answer);

  // Sources
  if (result.sources.length > 0) {
    lines.push('');
    lines.push('---');
    lines.push('Sources :');
    for (const source of result.sources) {
      const location = source.page ? `, page ${source.page}` : '';
      lines.push(`- ${source.documentTitle}${location} : "${source.quote}"`);
    }
  }

  // Footer
  lines.push('');
  lines.push(`Confiance : ${Math.round(result.confidence * 100)}%`);
  lines.push(`Documents analysés : ${result.documentsAnalyzed}`);

  return lines.join('\n');
}

export default { runCompiler, formatCompilerResult };
