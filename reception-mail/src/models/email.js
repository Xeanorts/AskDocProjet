/**
 * Email Model
 * Represents an email with all its properties
 */

import { randomUUID } from 'crypto';

// PDF size limits to prevent OOM
const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;  // 20MB per PDF
const MAX_TOTAL_SIZE_BYTES = 20 * 1024 * 1024; // 20MB total

/**
 * Create an Email model from parsed email data
 */
export class Email {
  constructor(data = {}) {
    this.id = data.id || randomUUID();
    this.from = data.from || null;
    this.to = data.to || null;
    this.cc = data.cc || null;
    this.bcc = data.bcc || null;
    this.subject = data.subject || null;
    this.date = data.date || new Date();
    this.receivedAt = data.receivedAt || new Date();
    this.headers = data.headers || {};
    this.text = data.text || null;
    this.html = data.html || null;
    this.textAsHtml = data.textAsHtml || null;
    this.attachments = data.attachments || [];
    this.size = data.size || 0;
    this.messageId = data.messageId || null;
    this.inReplyTo = data.inReplyTo || null;
    this.references = data.references || null;
    this.priority = data.priority || 'normal';
  }

  /**
   * Create an Email from mailparser parsed result
   */
  static fromParsed(parsed, envelope = {}) {
    return new Email({
      from: Email.formatAddress(parsed.from),
      to: Email.formatAddressList(parsed.to),
      cc: Email.formatAddressList(parsed.cc),
      bcc: Email.formatAddressList(parsed.bcc),
      subject: parsed.subject,
      date: parsed.date,
      receivedAt: new Date(),
      headers: Email.formatHeaders(parsed.headers),
      text: parsed.text,
      html: parsed.html,
      textAsHtml: parsed.textAsHtml,
      attachments: Email.formatAttachments(parsed.attachments),
      messageId: parsed.messageId,
      inReplyTo: parsed.inReplyTo,
      references: parsed.references,
      priority: parsed.priority,
      size: Email.calculateSize(parsed),
    });
  }

  /**
   * Format a single address object
   */
  static formatAddress(address) {
    if (!address) return null;
    if (address.value && address.value[0]) {
      return {
        name: address.value[0].name || null,
        address: address.value[0].address || null,
        text: address.text
      };
    }
    return address;
  }

  /**
   * Format address list
   */
  static formatAddressList(addressList) {
    if (!addressList || !addressList.value) return [];
    return addressList.value.map(addr => ({
      name: addr.name || null,
      address: addr.address || null
    }));
  }

  /**
   * Format headers to plain object
   */
  static formatHeaders(headers) {
    if (!headers) return {};
    const result = {};
    for (const [key, value] of headers) {
      result[key] = value;
    }
    return result;
  }

  /**
   * Format attachments
   * Includes base64 content for PDF files to enable Document Q&A
   * Enforces size limits to prevent OOM
   */
  static formatAttachments(attachments) {
    if (!attachments || attachments.length === 0) return [];

    let totalPdfSize = 0;

    return attachments.map(att => {
      const attachment = {
        id: randomUUID(),
        filename: att.filename,
        contentType: att.contentType,
        size: att.size,
        checksum: att.checksum,
        contentId: att.contentId,
        contentDisposition: att.contentDisposition,
        hasContent: !!att.content
      };

      // Include base64 content for PDF files (needed for Document Q&A)
      // Enforce size limits to prevent OOM
      if (att.content && att.contentType === 'application/pdf') {
        const pdfSize = att.size || att.content.length;

        if (pdfSize > MAX_PDF_SIZE_BYTES) {
          // Single PDF too large
          attachment.skipped_reason = 'size_exceeded';
          attachment.skipped_details = `PDF size ${Math.round(pdfSize / 1024 / 1024)}MB exceeds limit of ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB`;
          console.warn(`[EMAIL] PDF too large: ${att.filename} (${Math.round(pdfSize / 1024 / 1024)}MB > ${MAX_PDF_SIZE_BYTES / 1024 / 1024}MB)`);
        } else if (totalPdfSize + pdfSize > MAX_TOTAL_SIZE_BYTES) {
          // Total size would exceed limit
          attachment.skipped_reason = 'total_size_exceeded';
          attachment.skipped_details = `Total PDF size would exceed ${MAX_TOTAL_SIZE_BYTES / 1024 / 1024}MB limit`;
          console.warn(`[EMAIL] Total attachments exceeded: skipping ${att.filename}`);
        } else {
          // Within limits, include content
          attachment.content_base64 = att.content.toString('base64');
          totalPdfSize += pdfSize;
        }
      }

      return attachment;
    });
  }

  /**
   * Calculate approximate email size
   */
  static calculateSize(parsed) {
    let size = 0;
    if (parsed.text) size += parsed.text.length;
    if (parsed.html) size += parsed.html.length;
    if (parsed.attachments) {
      parsed.attachments.forEach(att => {
        size += att.size || 0;
      });
    }
    return size;
  }

  /**
   * Convert to JSON-serializable object
   * Uses standardized field names for file bus communication
   */
  toJSON() {
    return {
      schema_version: "1.0",
      pipeline_status: "mail_received",
      id: this.id,
      from: this.from,
      to: this.to,
      cc: this.cc,
      bcc: this.bcc,
      subject: this.subject,
      date: this.date,
      receivedAt: this.receivedAt,
      headers: this.headers,
      body_text: this.text,      // Standardized field name
      body_html: this.html,      // Standardized field name
      textAsHtml: this.textAsHtml,
      attachments: this.attachments,
      size: this.size,
      messageId: this.messageId,
      inReplyTo: this.inReplyTo,
      references: this.references,
      priority: this.priority
    };
  }

  /**
   * Get a summary of the email (for logging)
   */
  getSummary() {
    return {
      id: this.id,
      from: this.from?.address || this.from?.text || 'unknown',
      to: this.to.map(t => t.address).join(', ') || 'unknown',
      subject: this.subject || '(no subject)',
      date: this.date,
      size: this.size,
      attachmentCount: this.attachments.length
    };
  }
}
