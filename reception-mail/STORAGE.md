# 💾 Système de Stockage - Guide Complet

## Vue d'ensemble

Le système de stockage sauvegarde automatiquement tous les emails reçus dans des fichiers JSON structurés.

## Architecture

### Composants

1. **File Storage Service** (`src/persistence/file-storage.js`)
   - Gestion du stockage sur disque
   - Sauvegarde et lecture des emails
   - Génération de noms de fichiers uniques
   - Statistiques de stockage

2. **Email Model** (`src/models/email.js`)
   - Modèle de données structuré
   - Conversion depuis mailparser
   - Sérialisation JSON

3. **CLI Utility** (`scripts/list-emails.js`)
   - Liste des emails stockés
   - Affichage détaillé
   - Statistiques

## Format de stockage

### Nom de fichier

Format : `YYYYMMDD_HHMMSS_<uuid>.json`

Exemple : `20251104_204559_347188a2-dac6-42f7-8f15-a3d1b27c1623.json`

- **YYYYMMDD** : Date de réception
- **HHMMSS** : Heure de réception
- **uuid** : Identifiant unique de l'email

### Structure JSON

```json
{
  "schema_version": "1.0",
  "pipeline_status": "mail_received",
  "id": "347188a2-dac6-42f7-8f15-a3d1b27c1623",
  "from": {
    "name": null,
    "address": "sender@example.com",
    "text": "sender@example.com"
  },
  "to": [
    {
      "name": "John Doe",
      "address": "recipient@example.com"
    }
  ],
  "cc": [],
  "bcc": [],
  "subject": "Test Email",
  "date": "2025-11-04T20:45:59.315Z",
  "receivedAt": "2025-11-04T20:45:59.314Z",
  "headers": {
    "content-type": {...},
    "from": {...},
    "to": {...},
    ...
  },
  "body_text": "Corps de l'email en texte brut",
  "body_html": "<html>Corps HTML</html>",
  "textAsHtml": "<p>Text converti en HTML</p>",
  "attachments": [
    {
      "id": "attachment-uuid",
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "size": 12345,
      "checksum": "abc123...",
      "hasContent": true
    }
  ],
  "size": 12345,
  "messageId": "<message-id@example.com>",
  "inReplyTo": null,
  "references": null,
  "priority": "normal"
}
```

### Champs de workflow

**`schema_version`** : Version du schéma JSON (`"1.0"` pour MVP)
- Permet l'évolution future du format sans casser la compatibilité
- Voir `docs/pipeline-schema.md` pour la gestion des versions

**`pipeline_status`** : État actuel de l'email dans le pipeline (`"mail_received"`)
- Défini automatiquement par le module reception-mail
- Permet le suivi de progression à travers les modules
- Valeur fixe : `"mail_received"` (première étape du workflow)
- Voir `docs/pipeline-status.md` pour le workflow complet

### Noms de champs standardisés

Pour assurer la compatibilité avec les modules suivants du pipeline :
- **`body_text`** (pas `text`) : Corps de l'email en texte brut
- **`body_html`** (pas `html`) : Corps de l'email en HTML

Ces noms standardisés sont utilisés par le module-traitement-ia pour l'analyse.

## Utilisation

### Démarrage automatique

Quand le serveur SMTP reçoit un email, il est automatiquement sauvegardé :

```bash
npm start
# Le serveur sauvegarde automatiquement chaque email reçu
```

### Lister tous les emails

```bash
npm run list-emails
```

Sortie :
```
📬 Found 3 stored email(s):

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📄 20251104_204559_347188a2-dac6-42f7-8f15-a3d1b27c1623.json
   🆔 ID: 347188a2-dac6-42f7-8f15-a3d1b27c1623
   👤 From: test@example.com
   👥 To: recipient@example.com
   📨 Subject: Test Email
   📅 Date: 11/4/2025, 8:45:59 PM
   📏 Size: 206 Bytes
   📎 Attachments: 0
```

### Afficher un email spécifique

```bash
npm run list-emails -- 20251104_204559_347188a2-dac6-42f7-8f15-a3d1b27c1623.json
```

Affiche tous les détails de l'email incluant :
- En-têtes complets
- Contenu texte
- Contenu HTML
- Liste des pièces jointes

### Voir les statistiques

```bash
npm run list-emails -- --stats
```

Sortie :
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 STORAGE STATISTICS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📬 Total emails: 15
💾 Total size: 0.25 MB (262144 bytes)
📁 Storage path: ./storage/emails

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Aide

```bash
npm run list-emails -- --help
```

## Configuration

### Chemin de stockage

Par défaut : `./storage/emails`

Personnaliser via variable d'environnement :

```bash
# Dans .env
STORAGE_PATH=/var/mail/storage
```

### Utilisation programmatique

```javascript
import fileStorage from './src/persistence/file-storage.js';

// Initialiser le stockage
await fileStorage.initialize();

// Sauvegarder un email
const filepath = await fileStorage.saveEmail(emailObject);

// Lire un email
const email = await fileStorage.readEmail('filename.json');

// Lister tous les emails
const files = await fileStorage.listEmails();

// Obtenir le nombre d'emails
const count = await fileStorage.getCount();

// Statistiques
const stats = await fileStorage.getStats();

// Supprimer un email
await fileStorage.deleteEmail('filename.json');
```

## Fonctionnalités

### ✅ Implémenté

- [x] Sauvegarde automatique des emails reçus
- [x] Format JSON structuré et lisible
- [x] Nommage unique avec date/heure/UUID
- [x] Utilitaire CLI pour consultation
- [x] Statistiques de stockage
- [x] Lecture/écriture async
- [x] Gestion des erreurs

### 🚧 À venir (Phase 2)

- [ ] Compression des anciens emails
- [ ] Archivage automatique (après X jours)
- [ ] Indexation pour recherche rapide
- [ ] Sauvegarde des pièces jointes sur disque
- [ ] Migration vers base de données
- [ ] API REST pour accès distant

## Performances

### Benchmarks

- **Écriture** : ~5ms par email (moyenne)
- **Lecture** : ~2ms par email (moyenne)
- **Listing** : ~10ms pour 100 emails

### Limites

- Nombre d'emails : Illimité (limité par espace disque)
- Taille par email : 25 MB (limite SMTP)
- Format : JSON (non compressé pour MVP)

### Recommandations

Pour de grandes quantités d'emails (> 10 000) :
1. Considérer une base de données (PostgreSQL)
2. Implémenter l'archivage automatique
3. Activer la compression
4. Créer des index pour la recherche

## Exemples

### Chercher des emails par expéditeur

```bash
# Lister et filtrer avec grep
npm run list-emails | grep "john@example.com"
```

### Compter les emails du jour

```bash
# Compter les fichiers du jour (format YYYYMMDD)
ls storage/emails/20251104_* | wc -l
```

### Supprimer les vieux emails

```bash
# Supprimer les emails de plus de 30 jours
find storage/emails -name "*.json" -mtime +30 -delete
```

### Backup

```bash
# Créer une sauvegarde
tar -czf emails-backup-$(date +%Y%m%d).tar.gz storage/emails/

# Restaurer
tar -xzf emails-backup-20251104.tar.gz
```

## Intégration

### Avec l'API REST (Phase 2)

Le stockage fichiers sera accessible via l'API :

```
GET /api/emails              # Liste (utilise fileStorage.listEmails())
GET /api/emails/:id          # Détails (utilise fileStorage.readEmail())
DELETE /api/emails/:id       # Supprimer (utilise fileStorage.deleteEmail())
GET /api/storage/stats       # Stats (utilise fileStorage.getStats())
```

### Avec PostgreSQL (Phase 2)

Migration progressive :
1. Garder le stockage fichiers pour le contenu complet
2. PostgreSQL pour les métadonnées et la recherche
3. Références croisées entre DB et fichiers

## Dépannage

### Le stockage ne crée pas de fichiers

1. Vérifier les permissions du dossier :
   ```bash
   ls -la storage/emails/
   chmod 755 storage/emails/
   ```

2. Vérifier les logs du serveur pour les erreurs

3. Tester manuellement :
   ```bash
   node -e "import('./src/persistence/file-storage.js').then(m => m.default.initialize())"
   ```

### Fichiers corrompus

Si un fichier JSON est corrompu :

```bash
# Valider le JSON
cat storage/emails/file.json | jq .

# Si invalide, supprimer
rm storage/emails/file.json
```

### Espace disque

Surveiller l'espace disque :

```bash
# Taille du dossier storage
du -sh storage/emails/

# Statistiques détaillées
npm run list-emails -- --stats
```

## Sécurité

### Permissions

Recommandations :
- Dossier storage : `755` (rwxr-xr-x)
- Fichiers JSON : `644` (rw-r--r--)

### Données sensibles

⚠️ **Attention** : Les emails sont stockés en clair (non chiffrés)

Pour la production, considérer :
- Chiffrement des fichiers sensibles
- Contrôle d'accès strict
- Audit des accès
- Sauvegarde sécurisée

## Voir aussi

- [README.md](./README.md) - Guide principal
- [QUICKSTART.md](./QUICKSTART.md) - Démarrage rapide
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Architecture complète
