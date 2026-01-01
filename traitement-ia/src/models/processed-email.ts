/**
 * Processed Email Model
 * Defines simple structure for AI-processed emails
 */

import { EmailData, ProcessedEmailData } from '../persistence/file-storage.js';

/**
 * Create a processed email object from raw email and AI response
 */
export function createProcessedEmail(
  email: EmailData,
  aiResponse: string,
  aiModel: string
): ProcessedEmailData {
  return {
    email_id: email.id,
    from: email.from?.text || email.from?.address || 'unknown',
    subject: email.subject || '(no subject)',
    received_at: email.receivedAt || email.date || new Date().toISOString(),

    ai_response: aiResponse,
    ai_model: aiModel,

    status: 'ok',
    processed_at: new Date().toISOString()
  };
}

/**
 * Create an error processed email object (when AI analysis fails)
 */
export function createErrorProcessedEmail(
  email: EmailData,
  errorMessage: string
): ProcessedEmailData {
  return {
    email_id: email.id,
    from: email.from?.text || email.from?.address || 'unknown',
    subject: email.subject || '(no subject)',
    received_at: email.receivedAt || email.date || new Date().toISOString(),

    ai_response: null,
    ai_model: null,
    status: 'error',
    error_message: errorMessage,
    processed_at: new Date().toISOString()
  };
}

export default {
  createProcessedEmail,
  createErrorProcessedEmail
};
