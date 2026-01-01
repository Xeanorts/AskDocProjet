/**
 * File Storage - Opérations I/O atomiques pour module-email-send
 *
 * Fournit des méthodes pour écrire et lire des fichiers de manière atomique
 * en utilisant le pattern tmp → rename
 */

import { writeFile, rename, readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

class FileStorage {
  /**
   * Écrit un objet JSON de manière atomique
   * @param {string} filepath - Chemin complet du fichier
   * @param {object} data - Données à sauvegarder
   */
  async saveJSON(filepath, data) {
    const temp = `${filepath}.tmp`;

    // Écriture dans fichier temporaire
    await writeFile(temp, JSON.stringify(data, null, 2), 'utf-8');

    // Rename atomique
    await rename(temp, filepath);
  }

  /**
   * Lit un fichier JSON
   * @param {string} filepath - Chemin complet du fichier
   * @returns {object} Données parsées
   */
  async readJSON(filepath) {
    const content = await readFile(filepath, 'utf-8');
    return JSON.parse(content);
  }

  /**
   * Lit un fichier binaire
   * @param {string} filepath - Chemin complet du fichier
   * @returns {Buffer}
   */
  async readBinary(filepath) {
    return await readFile(filepath);
  }

  /**
   * Liste tous les fichiers d'un répertoire avec un pattern
   * @param {string} directory - Répertoire à scanner
   * @param {string} pattern - Extension ou pattern (ex: '.json', '.pptx')
   * @returns {Array<string>} Liste des noms de fichiers
   */
  async listFiles(directory, pattern = '') {
    if (!existsSync(directory)) {
      return [];
    }

    const files = await readdir(directory);

    if (pattern) {
      return files.filter(f => f.endsWith(pattern));
    }

    return files;
  }

  /**
   * Extrait l'email_id d'un nom de fichier
   * @param {string} filename - Nom du fichier (ex: "20241106_143022_abc.pptx_download.json")
   * @param {string} suffix - Suffixe à retirer (ex: ".pptx_download.json")
   * @returns {string} Email ID
   */
  extractEmailId(filename, suffix) {
    return filename.replace(suffix, '');
  }

  /**
   * Vérifie si un fichier existe
   * @param {string} filepath - Chemin du fichier
   * @returns {boolean}
   */
  fileExists(filepath) {
    return existsSync(filepath);
  }

  /**
   * Construit un chemin de fichier
   * @param {...string} parts - Parties du chemin
   * @returns {string} Chemin complet
   */
  buildPath(...parts) {
    return path.join(...parts);
  }
}

// Singleton
export default new FileStorage();
