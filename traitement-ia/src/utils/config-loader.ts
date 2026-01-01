/**
 * Configuration loader for LLM settings
 * Loads llm.json with fallback to defaults
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface LLMConfig {
  model: string;
  max_output_tokens: number;
  text_verbosity?: string;
  reasoning_effort?: string;
  system_prompt: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  model: 'mistral-small-latest',
  max_output_tokens: 4000,
  system_prompt: 'Tu es un assistant IA specialise dans l\'analyse de documents PDF et la reponse aux questions. Reponds en francais de maniere claire et structuree.'
};

/**
 * Load LLM configuration from file
 * @param type - 'text' for emails without PDF, 'pdf' for emails with PDF
 */
export async function loadLLMConfig(type: 'text' | 'pdf' = 'text'): Promise<LLMConfig> {
  const configFile = type === 'pdf' ? 'llm-pdf.json' : 'llm.json';
  const configPath = join(__dirname, '../../config/', configFile);

  try {
    const configData = await readFile(configPath, 'utf-8');
    const config = JSON.parse(configData) as Partial<LLMConfig>;

    const finalConfig: LLMConfig = { ...DEFAULT_CONFIG, ...config };

    if (!config.model) {
      logger.warn('llm.json missing "model", using default:', DEFAULT_CONFIG.model);
    }

    if (!config.system_prompt) {
      logger.warn('llm.json missing "system_prompt", using default');
    }

    logger.info(`LLM configuration loaded from ${configFile}`);
    logger.debug('LLM Config:', {
      model: finalConfig.model,
      max_output_tokens: finalConfig.max_output_tokens
    });

    return finalConfig;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;

    if (err.code === 'ENOENT') {
      logger.warn(`${configFile} not found, using default configuration`);
    } else if (error instanceof SyntaxError) {
      logger.error(`Invalid JSON in ${configFile}, using default configuration`);
      logger.error('   JSON parse error:', error.message);
    } else {
      logger.error(`Error loading ${configFile}:`, err.message);
    }

    logger.info('Using default LLM configuration');
    return DEFAULT_CONFIG;
  }
}

export default { loadLLMConfig };
