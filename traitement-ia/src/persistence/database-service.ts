/**
 * Database Service
 * Manages SQLite database for document metadata storage
 */

import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';
import logger from '../utils/logger.js';

// Document metadata interface
export interface DocumentMetadata {
  id: string;
  mistral_file_id: string;
  filename: string;
  source_path: string | null;
  title: string | null;
  document_type: string | null;
  subjects: string[];
  keywords: string[];
  summary: string | null;
  page_count: number | null;
  content_hash: string;
  created_at: string;
}

// Document insert interface (without id and created_at which are auto-generated)
export interface DocumentInsert {
  mistral_file_id: string;
  filename: string;
  source_path?: string | null;
  title?: string | null;
  document_type?: string | null;
  subjects?: string[];
  keywords?: string[];
  summary?: string | null;
  page_count?: number | null;
  content_hash: string;
}

// Document metadata for preselection (lighter version for LLM context)
export interface DocumentSummary {
  id: string;
  filename: string;
  title: string | null;
  document_type: string | null;
  subjects: string[];
  keywords: string[];
  summary: string | null;
}

class DatabaseService {
  private db: Database.Database | null = null;
  private dbPath: string;

  constructor() {
    const dataDir = process.env.DATA_PATH || join(process.cwd(), 'data');
    this.dbPath = join(dataDir, 'askdoc.db');
  }

  /**
   * Initialize the database connection and create tables if needed
   */
  initialize(): void {
    try {
      // Ensure data directory exists
      const dataDir = join(this.dbPath, '..');
      if (!existsSync(dataDir)) {
        mkdirSync(dataDir, { recursive: true });
        logger.info(`Created data directory: ${dataDir}`);
      }

      // Open database connection
      this.db = new Database(this.dbPath);

      // Enable WAL mode for better concurrency
      this.db.pragma('journal_mode = WAL');

      // Create tables
      this.createTables();

      logger.info(`Database initialized: ${this.dbPath}`);
    } catch (error) {
      const err = error as Error;
      logger.error(`Failed to initialize database: ${err.message}`);
      throw error;
    }
  }

  /**
   * Create the documents table if it doesn't exist
   */
  private createTables(): void {
    if (!this.db) throw new Error('Database not initialized');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        mistral_file_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        source_path TEXT,
        title TEXT,
        document_type TEXT,
        subjects TEXT,
        keywords TEXT,
        summary TEXT,
        page_count INTEGER,
        content_hash TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_documents_content_hash ON documents(content_hash);
      CREATE INDEX IF NOT EXISTS idx_documents_filename ON documents(filename);
    `);

    logger.debug('Database tables created/verified');
  }

  /**
   * Check if a document with the given hash already exists
   */
  documentExistsByHash(contentHash: string): boolean {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT 1 FROM documents WHERE content_hash = ?');
    const result = stmt.get(contentHash);
    return result !== undefined;
  }

  /**
   * Get a document by its content hash
   */
  getDocumentByHash(contentHash: string): DocumentMetadata | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM documents WHERE content_hash = ?');
    const row = stmt.get(contentHash) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToDocument(row);
  }

  /**
   * Get a document by its ID
   */
  getDocumentById(id: string): DocumentMetadata | null {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM documents WHERE id = ?');
    const row = stmt.get(id) as Record<string, unknown> | undefined;

    if (!row) return null;

    return this.rowToDocument(row);
  }

  /**
   * Insert a new document
   */
  insertDocument(doc: DocumentInsert): DocumentMetadata {
    if (!this.db) throw new Error('Database not initialized');

    const id = randomUUID();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO documents (
        id, mistral_file_id, filename, source_path, title,
        document_type, subjects, keywords, summary, page_count,
        content_hash, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      doc.mistral_file_id,
      doc.filename,
      doc.source_path || null,
      doc.title || null,
      doc.document_type || null,
      JSON.stringify(doc.subjects || []),
      JSON.stringify(doc.keywords || []),
      doc.summary || null,
      doc.page_count || null,
      doc.content_hash,
      now
    );

    logger.info(`Document inserted: ${doc.filename} (${id})`);

    return {
      id,
      mistral_file_id: doc.mistral_file_id,
      filename: doc.filename,
      source_path: doc.source_path || null,
      title: doc.title || null,
      document_type: doc.document_type || null,
      subjects: doc.subjects || [],
      keywords: doc.keywords || [],
      summary: doc.summary || null,
      page_count: doc.page_count || null,
      content_hash: doc.content_hash,
      created_at: now
    };
  }

  /**
   * Update an existing document's metadata
   */
  updateDocument(id: string, updates: Partial<DocumentInsert>): void {
    if (!this.db) throw new Error('Database not initialized');

    const fields: string[] = [];
    const values: unknown[] = [];

    if (updates.mistral_file_id !== undefined) {
      fields.push('mistral_file_id = ?');
      values.push(updates.mistral_file_id);
    }
    if (updates.title !== undefined) {
      fields.push('title = ?');
      values.push(updates.title);
    }
    if (updates.document_type !== undefined) {
      fields.push('document_type = ?');
      values.push(updates.document_type);
    }
    if (updates.subjects !== undefined) {
      fields.push('subjects = ?');
      values.push(JSON.stringify(updates.subjects));
    }
    if (updates.keywords !== undefined) {
      fields.push('keywords = ?');
      values.push(JSON.stringify(updates.keywords));
    }
    if (updates.summary !== undefined) {
      fields.push('summary = ?');
      values.push(updates.summary);
    }
    if (updates.page_count !== undefined) {
      fields.push('page_count = ?');
      values.push(updates.page_count);
    }

    if (fields.length === 0) return;

    values.push(id);
    const stmt = this.db.prepare(`UPDATE documents SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    logger.info(`Document updated: ${id}`);
  }

  /**
   * Get all documents (for preselection)
   */
  getAllDocuments(): DocumentMetadata[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM documents ORDER BY created_at DESC');
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => this.rowToDocument(row));
  }

  /**
   * Get all document summaries (lighter version for LLM context)
   */
  getAllDocumentSummaries(): DocumentSummary[] {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare(`
      SELECT id, filename, title, document_type, subjects, keywords, summary
      FROM documents
      ORDER BY created_at DESC
    `);
    const rows = stmt.all() as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      filename: row.filename as string,
      title: row.title as string | null,
      document_type: row.document_type as string | null,
      subjects: this.parseJsonArray(row.subjects as string | null),
      keywords: this.parseJsonArray(row.keywords as string | null),
      summary: row.summary as string | null
    }));
  }

  /**
   * Get documents by their IDs
   */
  getDocumentsByIds(ids: string[]): DocumentMetadata[] {
    if (!this.db) throw new Error('Database not initialized');
    if (ids.length === 0) return [];

    const placeholders = ids.map(() => '?').join(', ');
    const stmt = this.db.prepare(`SELECT * FROM documents WHERE id IN (${placeholders})`);
    const rows = stmt.all(...ids) as Record<string, unknown>[];

    return rows.map(row => this.rowToDocument(row));
  }

  /**
   * Get the total count of documents
   */
  getDocumentCount(): number {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM documents');
    const result = stmt.get() as { count: number };
    return result.count;
  }

  /**
   * Delete a document by ID
   */
  deleteDocument(id: string): void {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM documents WHERE id = ?');
    stmt.run(id);

    logger.info(`Document deleted: ${id}`);
  }

  /**
   * Close the database connection
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      logger.info('Database connection closed');
    }
  }

  /**
   * Convert a database row to DocumentMetadata
   */
  private rowToDocument(row: Record<string, unknown>): DocumentMetadata {
    return {
      id: row.id as string,
      mistral_file_id: row.mistral_file_id as string,
      filename: row.filename as string,
      source_path: row.source_path as string | null,
      title: row.title as string | null,
      document_type: row.document_type as string | null,
      subjects: this.parseJsonArray(row.subjects as string | null),
      keywords: this.parseJsonArray(row.keywords as string | null),
      summary: row.summary as string | null,
      page_count: row.page_count as number | null,
      content_hash: row.content_hash as string,
      created_at: row.created_at as string
    };
  }

  /**
   * Parse a JSON array string, returning empty array on failure
   */
  private parseJsonArray(json: string | null): string[] {
    if (!json) return [];
    try {
      const parsed = JSON.parse(json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

// Singleton instance
const databaseService = new DatabaseService();

// Export functions
export const initializeDatabase = (): void => databaseService.initialize();
export const documentExistsByHash = (hash: string): boolean => databaseService.documentExistsByHash(hash);
export const getDocumentByHash = (hash: string): DocumentMetadata | null => databaseService.getDocumentByHash(hash);
export const getDocumentById = (id: string): DocumentMetadata | null => databaseService.getDocumentById(id);
export const insertDocument = (doc: DocumentInsert): DocumentMetadata => databaseService.insertDocument(doc);
export const updateDocument = (id: string, updates: Partial<DocumentInsert>): void => databaseService.updateDocument(id, updates);
export const getAllDocuments = (): DocumentMetadata[] => databaseService.getAllDocuments();
export const getAllDocumentSummaries = (): DocumentSummary[] => databaseService.getAllDocumentSummaries();
export const getDocumentsByIds = (ids: string[]): DocumentMetadata[] => databaseService.getDocumentsByIds(ids);
export const getDocumentCount = (): number => databaseService.getDocumentCount();
export const deleteDocument = (id: string): void => databaseService.deleteDocument(id);
export const closeDatabase = (): void => databaseService.close();

export default databaseService;
