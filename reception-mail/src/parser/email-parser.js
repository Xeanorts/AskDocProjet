/**
 * Email Parser
 * Converts parsed email from mailparser to our Email model format
 */

import { Email } from '../models/email.js';

/**
 * Create an Email model from mailparser parsed result
 * @param {Object} parsed - Parsed email from mailparser
 * @param {Object} envelope - Optional IMAP envelope data
 * @returns {Email} - Email model instance
 */
export function createEmailFromParsed(parsed, envelope = {}) {
  return Email.fromParsed(parsed, envelope);
}

/**
 * Parse email address string to object
 * @param {string} addressString - Email address string
 * @returns {Object} - Address object with name and address
 */
export function parseAddress(addressString) {
  if (!addressString) return null;

  // Simple email parsing (name <email@domain.com> or email@domain.com)
  const match = addressString.match(/^(?:([^<]+)\s*<)?([^>]+)>?$/);

  if (match) {
    return {
      name: match[1] ? match[1].trim() : null,
      address: match[2].trim()
    };
  }

  return {
    name: null,
    address: addressString.trim()
  };
}

/**
 * Extract plain text from HTML
 * @param {string} html - HTML content
 * @returns {string} - Plain text content
 */
export function htmlToText(html) {
  if (!html) return '';

  return html
    .replace(/<style[^>]*>.*?<\/style>/gis, '')
    .replace(/<script[^>]*>.*?<\/script>/gis, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

export default {
  createEmailFromParsed,
  parseAddress,
  htmlToText
};
