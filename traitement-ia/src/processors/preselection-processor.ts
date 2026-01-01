/**
 * Preselection Processor
 * Analyzes a question and selects relevant documents from the database
 */

import { Mistral } from '@mistralai/mistralai';
import { getAllDocumentSummaries, DocumentSummary } from '../persistence/database-service.js';
import { loadLLMConfig } from '../utils/config-loader.js';
import { getModelName, ModelLevel } from './flow-router.js';
import logger from '../utils/logger.js';

// Interface for preselection result
export interface PreselectionResult {
  success: boolean;
  selectedDocuments: SelectedDocument[];
  noRelevantDocs: boolean;
  error?: string;
}

export interface SelectedDocument {
  documentId: string;
  reason: string;
}

// Interface for LLM response
interface PreselectionResponse {
  selected_documents: Array<{
    document_id: string;
    reason: string;
  }>;
  no_relevant_docs: boolean;
}

/**
 * Parse the preselection response from the LLM
 */
function parsePreselectionResponse(response: string): PreselectionResponse | null {
  try {
    // Try to extract JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn('No JSON found in preselection response');
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      selected_documents: Array.isArray(parsed.selected_documents)
        ? parsed.selected_documents.map((d: any) => ({
            document_id: d.document_id || '',
            reason: d.reason || ''
          }))
        : [],
      no_relevant_docs: parsed.no_relevant_docs === true
    };
  } catch (error) {
    const err = error as Error;
    logger.warn(`Failed to parse preselection response: ${err.message}`);
    return null;
  }
}

/**
 * Format document summaries for the LLM prompt
 */
function formatDocumentsForPrompt(documents: DocumentSummary[]): string {
  return documents.map(doc => {
    const lines = [
      `ID: ${doc.id}`,
      `Fichier: ${doc.filename}`,
    ];

    if (doc.title) {
      lines.push(`Titre: ${doc.title}`);
    }
    if (doc.document_type) {
      lines.push(`Type: ${doc.document_type}`);
    }
    if (doc.subjects && doc.subjects.length > 0) {
      lines.push(`Sujets: ${doc.subjects.join(', ')}`);
    }
    if (doc.keywords && doc.keywords.length > 0) {
      lines.push(`Mots-clés: ${doc.keywords.join(', ')}`);
    }
    if (doc.summary) {
      lines.push(`Résumé: ${doc.summary}`);
    }

    return lines.join('\n');
  }).join('\n\n---\n\n');
}

/**
 * Run preselection to find relevant documents
 */
export async function runPreselection(
  question: string,
  modelLevel: ModelLevel
): Promise<PreselectionResult> {
  try {
    // Get all document summaries from database
    const documents = getAllDocumentSummaries();

    if (documents.length === 0) {
      logger.info('[PRESELECTION] No documents in database');
      return {
        success: true,
        selectedDocuments: [],
        noRelevantDocs: true,
        error: 'Aucun document dans la base de données'
      };
    }

    logger.info(`[PRESELECTION] Analyzing ${documents.length} documents for question relevance...`);

    // Load config and get model
    const config = await loadLLMConfig('preselection');
    const model = getModelName(modelLevel);

    // Format documents for prompt
    const documentsText = formatDocumentsForPrompt(documents);

    // Build prompt
    const prompt = `Question de l'utilisateur:
"${question}"

Documents disponibles dans la base:

${documentsText}

---

Analyse la question et détermine quels documents sont pertinents pour y répondre.
Retourne ta réponse au format JSON suivant:

{
  "selected_documents": [
    {
      "document_id": "uuid-du-document",
      "reason": "Explication courte de pourquoi ce document est pertinent"
    }
  ],
  "no_relevant_docs": false
}

Si aucun document n'est pertinent, retourne:
{
  "selected_documents": [],
  "no_relevant_docs": true
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

    logger.info(`[PRESELECTION] Calling Mistral API with model ${model}...`);

    const response = await client.chat.complete({
      model,
      messages,
      maxTokens: config.max_output_tokens || 2000,
      safePrompt: true
    });

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Empty response from preselection');
    }

    const responseText = typeof content === 'string' ? content : JSON.stringify(content);
    const parsed = parsePreselectionResponse(responseText);

    if (!parsed) {
      throw new Error('Failed to parse preselection response');
    }

    // Filter to only include documents that exist in the database
    const validDocIds = new Set(documents.map(d => d.id));
    const validSelected = parsed.selected_documents.filter(s => validDocIds.has(s.document_id));

    if (validSelected.length !== parsed.selected_documents.length) {
      logger.warn(`[PRESELECTION] Filtered out ${parsed.selected_documents.length - validSelected.length} invalid document IDs`);
    }

    logger.info(`[PRESELECTION] Selected ${validSelected.length} document(s)`);

    return {
      success: true,
      selectedDocuments: validSelected.map(s => ({
        documentId: s.document_id,
        reason: s.reason
      })),
      noRelevantDocs: parsed.no_relevant_docs || validSelected.length === 0
    };
  } catch (error) {
    const err = error as Error;
    logger.error(`[PRESELECTION] Failed: ${err.message}`);
    return {
      success: false,
      selectedDocuments: [],
      noRelevantDocs: true,
      error: err.message
    };
  }
}

export default { runPreselection };
