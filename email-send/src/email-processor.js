/**
 * Email Processor - Envoi des présentations PPTX par email
 *
 * Responsabilités :
 * - Polling de 40_pptx_downloads/ pour les fichiers pptx_completed
 * - Récupération de l'expéditeur original depuis 00_mail_in/
 * - Envoi email SMTP avec pièce jointe PPTX
 * - Retry simple (3 tentatives avec sleep 2s)
 * - Sauvegarde atomique des métadonnées
 */

import nodemailer from 'nodemailer';
import path from 'path';
import fileStorage from './file-storage.js';

export class EmailProcessor {
  constructor(config) {
    this.config = config;
    this.isRunning = false;
    this.pollingTimer = null;
    this.transporter = null;

    // Chemins storage
    this.inputDir = path.join(config.storageBase, '40_pptx_downloads');
    this.mailInboxDir = path.join(config.storageBase, '00_mail_in');
    this.outputDir = path.join(config.storageBase, '50_emails_sent');

    console.log('[Email Processor] Initialized', {
      inputDir: this.inputDir,
      outputDir: this.outputDir,
      pollingInterval: config.pollingInterval
    });
  }

  /**
   * Démarre le processor avec polling
   */
  async start() {
    // Initialiser le transporteur SMTP
    await this.initializeTransporter();

    this.isRunning = true;
    console.log('[Email Processor] Started');

    // Premier cycle immédiat
    await this.processCycle();

    // Cycles suivants
    this.pollingTimer = setInterval(
      () => this.processCycle(),
      this.config.pollingInterval
    );
  }

  /**
   * Arrête le processor
   */
  stop() {
    this.isRunning = false;
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    if (this.transporter) {
      this.transporter.close();
    }
    console.log('[Email Processor] Stopped');
  }

  /**
   * Initialise le transporteur SMTP
   */
  async initializeTransporter() {
    this.transporter = nodemailer.createTransport({
      host: this.config.smtp.host,
      port: this.config.smtp.port,
      secure: this.config.smtp.secure,
      auth: {
        user: this.config.smtp.user,
        pass: this.config.smtp.password
      }
    });

    // Vérifier la connexion
    try {
      await this.transporter.verify();
      console.log('[Email Processor] SMTP connection verified');
    } catch (error) {
      console.error('[Email Processor] SMTP verification failed', error);
      throw error;
    }
  }

  /**
   * Cycle de traitement (traite 1 item maximum)
   */
  async processCycle() {
    if (!this.isRunning) return;

    try {
      const unprocessedIds = await this.listUnprocessedItems();

      if (unprocessedIds.length === 0) {
        return; // Rien à traiter
      }

      // Traiter UNIQUEMENT le premier item
      const emailId = unprocessedIds[0];
      console.log(`[Email Processor] Processing ${emailId}`);

      await this.processItem(emailId);

    } catch (error) {
      console.error('[Email Processor] Error in cycle', error);
      // Ne pas throw : continuer le polling
    }
  }

  /**
   * Liste les items non encore traités
   * @returns {Array<string>} Liste des email_ids
   */
  async listUnprocessedItems() {
    // 1. Lister tous les fichiers pptx_download avec status completed
    const inputFiles = await fileStorage.listFiles(this.inputDir, '.pptx_download.json');
    const inputIds = [];

    // Filtrer uniquement ceux avec status "pptx_completed"
    for (const filename of inputFiles) {
      const filepath = fileStorage.buildPath(this.inputDir, filename);
      try {
        const data = await fileStorage.readJSON(filepath);
        if (data.pipeline_status === 'pptx_completed') {
          const emailId = fileStorage.extractEmailId(filename, '.pptx_download.json');
          inputIds.push(emailId);
        }
      } catch (error) {
        console.error(`[Email Processor] Error reading ${filename}`, error);
      }
    }

    // 2. Lister tous les fichiers de sortie déjà créés
    const outputFiles = await fileStorage.listFiles(this.outputDir, '.email_sent.json');
    const processedIds = outputFiles.map(f =>
      fileStorage.extractEmailId(f, '.email_sent.json')
    );

    // 3. Retourner uniquement les items non encore traités
    return inputIds.filter(id => !processedIds.includes(id));
  }

  /**
   * Traite un item (envoie l'email)
   * @param {string} emailId
   */
  async processItem(emailId) {
    const startTime = Date.now();

    try {
      // 1. Lire le fichier pptx_download
      const downloadPath = fileStorage.buildPath(
        this.inputDir,
        `${emailId}.pptx_download.json`
      );
      const downloadData = await fileStorage.readJSON(downloadPath);

      // 2. Récupérer l'email original pour connaître l'expéditeur
      const originalEmail = await this.findOriginalEmail(emailId);
      if (!originalEmail) {
        throw new Error(`Original email not found for ${emailId}`);
      }

      const recipientEmail = originalEmail.from?.address;
      if (!recipientEmail) {
        throw new Error(`No recipient email found in original email ${emailId}`);
      }

      console.log(`[Email Processor] Sending email to ${recipientEmail}`);

      // 3. Charger le fichier PPTX
      const pptxPath = downloadData.local_path;
      const pptxBuffer = await fileStorage.readBinary(pptxPath);

      // 4. Envoyer l'email avec retry
      const messageId = await this.sendEmailWithRetry({
        to: recipientEmail,
        pptxBuffer,
        emailId
      });

      const duration = Date.now() - startTime;

      console.log(`[Email Processor] Email sent successfully`, {
        emailId,
        to: recipientEmail,
        attachmentSizeMB: (pptxBuffer.length / 1024 / 1024).toFixed(2),
        duration_ms: duration,
        messageId
      });

      // 5. Sauvegarder les métadonnées
      const metadata = {
        schema_version: '1.0',
        email_id: emailId,
        timestamp: new Date().toISOString(),
        pipeline_status: 'email_sent',
        from: this.config.email.from,
        to: recipientEmail,
        subject: this.config.email.subject,
        attachment_path: pptxPath,
        attachment_size_bytes: pptxBuffer.length,
        smtp_message_id: messageId,
        send_duration_ms: duration,
        error: null
      };

      const metadataPath = fileStorage.buildPath(
        this.outputDir,
        `${emailId}.email_sent.json`
      );
      await fileStorage.saveJSON(metadataPath, metadata);

      console.log(`[Email Processor] Completed ${emailId}`);

    } catch (error) {
      console.error(`[Email Processor] Failed ${emailId}`, error);

      // Sauvegarder l'erreur
      await this.saveError(emailId, error, Date.now() - startTime);
    }
  }

  /**
   * Trouve l'email original dans 00_mail_in
   * @param {string} emailId
   * @returns {Object|null}
   */
  async findOriginalEmail(emailId) {
    // L'email_id peut être soit le nom exact, soit commencer par YYYYMMDD_HHMMSS_
    const files = await fileStorage.listFiles(this.mailInboxDir, '.json');

    for (const filename of files) {
      if (filename.includes(emailId) || filename.startsWith(emailId)) {
        const filepath = fileStorage.buildPath(this.mailInboxDir, filename);
        try {
          return await fileStorage.readJSON(filepath);
        } catch (error) {
          console.error(`[Email Processor] Error reading ${filename}`, error);
        }
      }
    }

    return null;
  }

  /**
   * Envoie un email avec retry simple
   * @param {Object} params
   * @returns {string} Message ID
   */
  async sendEmailWithRetry({ to, pptxBuffer, emailId }) {
    const maxRetries = this.config.retryCount || 3;
    const retryDelay = this.config.retryDelay || 2000;

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const mailOptions = {
          from: {
            name: this.config.email.fromName,
            address: this.config.email.from
          },
          to,
          subject: this.config.email.subject,
          text: this.buildEmailBody(),
          attachments: [
            {
              filename: `${emailId}.pptx`,
              content: pptxBuffer,
              contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
            }
          ]
        };

        const info = await this.transporter.sendMail(mailOptions);
        return info.messageId;

      } catch (error) {
        lastError = error;
        console.error(`[Email Processor] Send attempt ${attempt}/${maxRetries} failed`, {
          error: error.message,
          code: error.code
        });

        // Ne pas retry pour les erreurs d'email invalide
        if (error.responseCode === 550 || error.message.includes('Invalid email')) {
          throw new Error(`Invalid email address: ${to}`);
        }

        // Sleep avant le prochain essai
        if (attempt < maxRetries) {
          await this.sleep(retryDelay);
        }
      }
    }

    throw lastError;
  }

  /**
   * Construit le corps de l'email (texte brut MVP)
   * @returns {string}
   */
  buildEmailBody() {
    return `Bonjour,

Votre présentation générée par intelligence artificielle est prête.

Vous trouverez le fichier PowerPoint (.pptx) en pièce jointe de cet email.

Vous pouvez l'ouvrir avec Microsoft PowerPoint, Google Slides, LibreOffice Impress ou tout autre logiciel compatible.

Cordialement,
L'equipe Project Name`;
  }

  /**
   * Sauvegarde les informations d'erreur
   * @param {string} emailId
   * @param {Error} error
   * @param {number} duration
   */
  async saveError(emailId, error, duration) {
    try {
      // Essayer de récupérer les infos de base
      let recipientEmail = 'unknown';
      let attachmentPath = null;
      let attachmentSize = null;

      try {
        const downloadPath = fileStorage.buildPath(
          this.inputDir,
          `${emailId}.pptx_download.json`
        );
        const downloadData = await fileStorage.readJSON(downloadPath);
        attachmentPath = downloadData.local_path;
        attachmentSize = downloadData.file_size_bytes;

        const originalEmail = await this.findOriginalEmail(emailId);
        if (originalEmail) {
          recipientEmail = originalEmail.from?.address || 'unknown';
        }
      } catch (e) {
        // Ignore
      }

      const metadata = {
        schema_version: '1.0',
        email_id: emailId,
        timestamp: new Date().toISOString(),
        pipeline_status: 'email_error',
        from: this.config.email.from,
        to: recipientEmail,
        subject: this.config.email.subject,
        attachment_path: attachmentPath,
        attachment_size_bytes: attachmentSize,
        smtp_message_id: null,
        send_duration_ms: duration,
        error: {
          code: error.code || 'EMAIL_SEND_FAILED',
          message: error.message,
          stack: error.stack
        }
      };

      const metadataPath = fileStorage.buildPath(
        this.outputDir,
        `${emailId}.email_sent.json`
      );
      await fileStorage.saveJSON(metadataPath, metadata);

    } catch (saveError) {
      console.error('[Email Processor] Failed to save error metadata', saveError);
    }
  }

  /**
   * Sleep helper
   * @param {number} ms - Millisecondes
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
