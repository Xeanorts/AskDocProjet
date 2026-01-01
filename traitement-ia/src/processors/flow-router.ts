/**
 * Flow Router
 * Detects the type of email flow (import vs question) and extracts model level
 */

import logger from '../utils/logger.js';

export type FlowType = 'import' | 'question';
export type ModelLevel = 'standard' | 'pro' | 'max';

export interface FlowDetectionResult {
  flowType: FlowType;
  modelLevel: ModelLevel;
  cleanSubject: string;  // Subject without the tags
}

/**
 * Detect if the email is an import request (contains "(add)")
 */
export function detectFlowType(subject: string): FlowType {
  const lowerSubject = subject.toLowerCase();
  return lowerSubject.includes('(add)') ? 'import' : 'question';
}

/**
 * Extract the model level from the subject
 * (max) -> mistral-large-latest
 * (pro) -> mistral-medium-latest
 * (none) -> mistral-small-latest (default)
 */
export function extractModelLevel(subject: string): ModelLevel {
  const lowerSubject = subject.toLowerCase();

  if (lowerSubject.includes('(max)')) {
    return 'max';
  }
  if (lowerSubject.includes('(pro)')) {
    return 'pro';
  }
  return 'standard';
}

/**
 * Get the Mistral model name from the model level
 */
export function getModelName(level: ModelLevel): string {
  switch (level) {
    case 'max':
      return 'mistral-large-latest';
    case 'pro':
      return 'mistral-medium-latest';
    case 'standard':
    default:
      return 'mistral-small-latest';
  }
}

/**
 * Remove flow tags from the subject
 */
export function cleanSubject(subject: string): string {
  return subject
    .replace(/\(add\)/gi, '')
    .replace(/\(max\)/gi, '')
    .replace(/\(pro\)/gi, '')
    .trim();
}

/**
 * Full flow detection: type, model level, and cleaned subject
 */
export function detectFlow(subject: string): FlowDetectionResult {
  const flowType = detectFlowType(subject);
  const modelLevel = extractModelLevel(subject);
  const cleaned = cleanSubject(subject);

  logger.debug(`Flow detected: type=${flowType}, level=${modelLevel}, subject="${cleaned}"`);

  return {
    flowType,
    modelLevel,
    cleanSubject: cleaned
  };
}

/**
 * Log the flow detection for debugging
 */
export function logFlowDetection(subject: string): FlowDetectionResult {
  const result = detectFlow(subject);

  logger.info(`[FLOW] Type: ${result.flowType.toUpperCase()}, Model: ${getModelName(result.modelLevel)}`);

  return result;
}
