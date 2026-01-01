/**
 * Thread Utils - Utilities for email conversation thread management
 *
 * Handles subject line parsing to extract base subjects and compute hashes
 * for identifying email conversation threads.
 */

import { createHash } from 'crypto';

/**
 * Extract the base subject by removing RE:/FW:/FWD: prefixes
 * Handles nested prefixes like "RE: RE: RE: Original Subject"
 *
 * @param subject - Raw email subject line
 * @returns Base subject without reply/forward prefixes
 *
 * @example
 * extractBaseSubject("RE: RE: Question sur contrat") // "Question sur contrat"
 * extractBaseSubject("FW: RE: Document PDF")         // "Document PDF"
 * extractBaseSubject("Re : Demande info")            // "Demande info"
 */
export function extractBaseSubject(subject: string): string {
  if (!subject) return '';

  let base = subject.trim();

  // Pattern matches: RE:, Re:, re:, RE :, FWD:, Fwd:, fwd:, FW:, Fw:, fw:
  // Also handles French style with space before colon: "RE :", "Fwd :"
  const prefixPattern = /^(re|fwd|fw)[\s]*:[\s]*/i;

  // Keep removing prefixes until none remain
  let previousBase = '';
  while (previousBase !== base) {
    previousBase = base;
    base = base.replace(prefixPattern, '');
  }

  return base.trim();
}

/**
 * Compute a hash to identify the conversation thread
 * Uses the normalized base subject to generate a consistent identifier
 *
 * @param subject - Raw email subject line
 * @returns 16-character hex hash identifying the thread
 *
 * @example
 * computeSubjectHash("RE: Question sur contrat")
 * // Same hash as computeSubjectHash("Question sur contrat")
 */
export function computeSubjectHash(subject: string): string {
  const base = extractBaseSubject(subject).toLowerCase();

  if (!base) {
    // Return a hash for empty subjects (rare but handled)
    return createHash('sha256').update('__empty_subject__').digest('hex').substring(0, 16);
  }

  return createHash('sha256').update(base).digest('hex').substring(0, 16);
}

/**
 * Check if a subject indicates a reply (has RE:/FW: prefix)
 *
 * @param subject - Raw email subject line
 * @returns true if the subject starts with a reply/forward prefix
 */
export function isReplySubject(subject: string): boolean {
  if (!subject) return false;
  return /^(re|fwd|fw)[\s]*:/i.test(subject.trim());
}
