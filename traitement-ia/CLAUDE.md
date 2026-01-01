# CLAUDE.md - Module Traitement IA

Documentation technique pour Claude Code lors du developpement et maintenance du module.

## Vue d'ensemble technique

**Module** : Traitement Document Q&A via Mistral AI
**Langage** : TypeScript
**Runtime** : Node.js 18+ (ES Modules)
**Dependances principales** : @mistralai/mistralai, dotenv
**Architecture** : Service long avec polling periodique

## Architecture detaillee

### Composants principaux

1. **EmailAIProcessor** (`src/processors/email-ai-processor.ts`)
   - Orchestre le workflow complet
   - Polling toutes les 5 secondes
   - Traite TOUS les emails en attente par cycle
   - Ne crash jamais, log les erreurs

2. **MistralService** (`src/services/mistral-service.ts`)
   - Client API Mistral AI
   - Support multi-documents (plusieurs PDFs)
   - Workflow avec cache: check cache → upload si absent → signedUrls → chat
   - Gestion timeout (120s par defaut)
   - Gestion erreurs (429, timeout, auth, etc.)
   - Flag `safePrompt: true` active

3. **PdfCacheService** (`src/services/pdf-cache-service.ts`)
   - Cache des PDFs uploades sur Mistral
   - Identification par hash SHA256 (contenu, pas nom)
   - Stockage dans `11_pdf_cache/cache-index.json`
   - Expiration apres 7 jours d'inactivite (`lastUsedAt`)
   - Cleanup au demarrage du service

4. **FileStorage** (`src/persistence/file-storage.ts`)
   - Lecture des emails depuis `00_mail_in/`
   - Ecriture atomique dans `10_ia_requests/`
   - Detection des doublons (scan du repertoire)
   - Singleton exporte

5. **Config Loader** (`src/utils/config-loader.ts`)
   - Charge `config/llm.json` (texte) ou `config/llm-pdf.json` (PDF)
   - Parametre `type: 'text' | 'pdf'` pour choisir le fichier
   - Recharge a chaque appel (pas de cache)
   - Fallback sur valeurs par defaut si absent ou invalide
   - Interface TypeScript `LLMConfig`

### Flux de traitement

```
1. Timer (5s) declenche processCycle()
   ↓
2. FileStorage.listUnprocessedEmails()
   - Scan 00_mail_in/
   - Compare avec 10_ia_requests/
   - Retourne liste des nouveaux
   ↓
3. Pour CHAQUE email en attente (boucle sequentielle)
   ↓
4. FileStorage.readEmail(path)
   ↓
5. Extraire PDF attachments (base64 → Buffer)
   ↓
6. Validation des limites PDF
   - Max 20 MB par fichier
   - Max 20 MB total
   - Max 10 fichiers
   ↓
7. MistralService.processMultiDocumentQA(question, pdfs[], emailId, subject)
   - Upload tous les PDFs (purpose: "ocr")
   - Get signed URLs pour chaque
   - Chat completion avec tous les documentUrls
   - sanitizeMarkdown() sur la reponse
   ↓
8. createProcessedEmail() ou createErrorProcessedEmail()
   ↓
9. FileStorage.saveProcessedEmail(data)
   - Ecriture atomique (tmp + rename)
   ↓
10. FileStorage.deleteEmailFile(emailPath)
    ↓
11. Email suivant ou attendre prochain cycle (5s)
```

### Workflow Mistral Multi-Document Q&A (avec cache)

```typescript
// Dans MistralService.processMultiDocumentQA()

// 1. Get or upload PDFs (avec cache par hash SHA256)
for (const pdf of pdfs) {
  const cacheResult = await pdfCacheService.getOrUpload(
    pdf.buffer,
    pdf.filename,
    async () => this.uploadPdf(pdf.buffer, pdf.filename)
  );
  // cacheResult.fromCache = true si deja en cache
  // cacheResult.fileId = ID du fichier sur Mistral
  // cacheResult.hash = SHA256 du contenu
}

// 2. Obtention signed URLs (one-shot, jamais cachees)
for (const { cache } of cacheResults) {
  try {
    const url = await this.getSignedUrl(cache.fileId);
    documentUrls.push(url);
  } catch (error) {
    // Cache invalide - re-upload
    await pdfCacheService.invalidateEntry(cache.hash);
    const newFileId = await this.uploadPdf(...);
    const url = await this.getSignedUrl(newFileId);
  }
}

// 3. Chat completion
const response = await this.client.chat.complete({
  model: config.model,
  messages: [...],
  safePrompt: true
});

// Pas de cleanup - fichiers restes sur Mistral pour cache
// Cleanup fait au demarrage par pdfCacheService.runCleanup()
```

### Cache PDF

```typescript
// Structure cache-index.json
{
  "version": 1,
  "entries": {
    "sha256hash...": {
      "hash": "sha256hash...",
      "fileId": "mistral-file-id",
      "uploadedAt": "2025-01-05T10:00:00.000Z",
      "lastUsedAt": "2025-01-10T14:30:00.000Z",
      "originalFilename": "document.pdf",
      "sizeBytes": 1048576
    }
  }
}

// Expiration: 7 jours sans utilisation (lastUsedAt)
// Cleanup: au demarrage, supprime fichiers Mistral + entrees cache
```

### Gestion des erreurs

**Principe** : Ne JAMAIS crasher le service

**Erreurs recuperables** :
- Timeout API → Genere fichier d'erreur, continue
- Rate limit 429 → Log warning, attend prochain cycle
- PDF invalide → Genere fichier d'erreur, continue
- PDF trop volumineux (> 20 MB) → Genere fichier d'erreur
- Trop de PDFs (> 10) → Genere fichier d'erreur
- Taille totale trop grande (> 20 MB) → Genere fichier d'erreur
- Email illisible → Log warning, passe au suivant

**Erreurs fatales** :
- Cle API manquante → Fail-fast au demarrage

**Cleanup garanti** :
- Le `finally` block assure toujours la suppression de TOUS les fichiers uploades
- Meme en cas d'erreur pendant le chat completion

### Format de donnees

**Entree** (`00_mail_in/YYYYMMDD_HHMMSS_<uuid>.json`) :
```typescript
interface EmailData {
  id: string;
  from?: { text?: string; address?: string };
  subject?: string;
  body_text?: string;
  body_html?: string;
  textAsHtml?: string;
  date?: string;
  receivedAt?: string;
  attachments?: Array<{
    filename: string;
    contentType: string;
    size: number;
    content_base64?: string;
  }>;
}
```

**Sortie** (`10_ia_requests/<email_id>.ia.json`) :
```typescript
interface ProcessedEmailData {
  email_id: string;
  from: string;
  subject: string;
  received_at: string;
  ai_response: string | null;
  ai_model: string | null;
  status: 'ok' | 'error';
  error_message?: string;
  processed_at: string;
  processing_time_ms?: number;
  api_usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  pdf_filename?: string;        // Premier PDF (compatibilite)
  pdf_filenames?: string[];     // Liste de tous les PDFs traites
  processing_type?: string;     // 'document_qa' | 'text_only'
  error_type?: string;
}
```

## Patterns de code

### Logger

```typescript
import logger from './utils/logger.js';

logger.info('Message');
logger.warn('Warning');
logger.error('Error:', error.message);
logger.debug('Debug info');  // Only if LOG_LEVEL=debug
```

### Ecriture atomique

```typescript
const temp = `${filepath}.tmp`;
await writeFile(temp, JSON.stringify(data, null, 2), 'utf-8');
await rename(temp, filepath);  // Atomic
```

### Gestion d'erreur dans cycle

```typescript
async processCycle(): Promise<void> {
  try {
    // Logique
  } catch (error) {
    const err = error as Error;
    logger.error('Error:', err.message);
    // NE PAS throw - continuer le service
  }
}
```

### Cleanup garanti avec finally (multi-fichiers)

```typescript
async processMultiDocumentQA(...): Promise<ProcessingResult> {
  const fileIds: string[] = [];

  try {
    // Upload tous les PDFs
    for (const pdf of pdfs) {
      const fileId = await this.uploadPdf(pdf.buffer, pdf.filename);
      fileIds.push(fileId);
    }
    // ... traitement avec toutes les signed URLs
  } finally {
    // Cleanup TOUS les fichiers, meme en cas d'erreur
    for (const fileId of fileIds) {
      await this.deleteFile(fileId);
    }
  }
}
```

### Sanitisation markdown (post-traitement)

Les reponses LLM sont nettoyees pour supprimer le markdown :

```typescript
// Dans MistralService
private sanitizeMarkdown(text: string): string {
  return text
    // Remove bold **text** (multiline OK avec [\s\S])
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    // Remove italic *text* (but not **)
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '$1')
    // Remove headers # ## ### at start of line
    .replace(/^#{1,6}\s+/gm, '');
}
```

Applique a toutes les reponses avant retour (processDocumentQA, processMultiDocumentQA, processEmail).

## Variables d'environnement

### Requises

- `MISTRAL_API_KEY` : Cle API Mistral (fail-fast si absent)

### Optionnelles

- `STORAGE_PATH` : Chemin base storage (defaut: `/app/storage`)
- `IA_INPUT_DIR` : Repertoire input (defaut: `00_mail_in`)
- `IA_OUTPUT_DIR` : Repertoire output (defaut: `10_ia_requests`)
- `MISTRAL_TIMEOUT_MS` : Timeout API (defaut: 120000)
- Intervalle polling : 5s (hardcode dans orchestrator.js)
- `LOG_LEVEL` : Niveau de log (defaut: info)
- `DRY_RUN` : Mode test sans API Mistral (defaut: false)

### Mode Dry-Run

```bash
DRY_RUN=true npm start
```

- Pas d'appels API Mistral
- Reponse simulee retournee
- PDFs listes mais pas uploades
- Pas de cle API requise

## Configuration LLM

### Fichiers de configuration

Deux fichiers de prompts distincts (templates fournis) :

```
traitement-ia/config/
├── llm.json.example      # Template emails SANS PDF (versionne)
├── llm.json              # Config active (gitignore)
├── llm-pdf.json.example  # Template emails AVEC PDF (versionne)
├── llm-pdf.json          # Config active (gitignore)
└── prompts/              # Archives locales (gitignore)
```

**Installation** :
```bash
cp config/llm.json.example config/llm.json
cp config/llm-pdf.json.example config/llm-pdf.json
```

### Format des fichiers

```json
{
  "model": "mistral-small-latest",
  "max_output_tokens": 4000,
  "system_prompt": "Tu es un assistant IA specialise..."
}
```

**Interface TypeScript** :
```typescript
interface LLMConfig {
  model: string;
  max_output_tokens: number;
  text_verbosity?: string;
  reasoning_effort?: string;
  system_prompt: string;
}
```

### Chargement des configs

```typescript
// Dans config-loader.ts
loadLLMConfig('text')  // → charge llm.json
loadLLMConfig('pdf')   // → charge llm-pdf.json
```

**Chargement** : Dynamique a chaque email (pas de cache)
**Fallback** : Valeurs par defaut si fichier absent

### Selection dynamique du modele

L'utilisateur peut choisir le modele Mistral via un tag dans le sujet de l'email.

| Tag dans le sujet | Modele utilise | Description |
|-------------------|----------------|-------------|
| _(aucun)_ | `mistral-small-latest` | Defaut, economique |
| `(pro)` | `mistral-medium-latest` | Equilibre qualite/cout |
| `(max)` | `mistral-large-latest` | Qualite maximale |

**Exemples de sujets** :
- `Question sur mon contrat` → mistral-small (defaut)
- `Question sur mon contrat (pro)` → mistral-medium
- `Analyse complexe (max)` → mistral-large

**Implementation** :
- Fonction `resolveModelForEmail()` dans `MistralService`
- Detection case-insensitive des tags
- Le modele selectionne est logge avec `(from subject tag)` si un tag est detecte

### Workflow de test des prompts

Le systeme permet d'iterer rapidement sur les prompts sans redemarrer les conteneurs.

**Cycle de developpement** :

```
1. MODIFIER le prompt
   └── Editer config/llm.json ou llm-pdf.json
   └── Pas de rebuild, pas de restart

2. TESTER le prompt
   └── Envoyer un email de test a l'adresse surveillee
   └── Attendre le traitement (max 5s)
   └── Verifier la reponse par email

3. ITERER si necessaire
   └── Ajuster le fichier json
   └── Re-tester

4. ARCHIVER si satisfait (local)
   └── cp config/llm.json config/prompts/prompt-[description]-v[N].json
```

**Format d'archive avec metadonnees** :
```json
{
  "_metadata": {
    "name": "Nom descriptif",
    "description": "Comportement et particularites",
    "created": "2025-01-17",
    "author": "Qui l'a cree"
  },
  "model": "mistral-small-latest",
  "max_output_tokens": 4000,
  "system_prompt": "..."
}
```

**Convention de nommage** : `prompt-[description]-v[version].json`
- `prompt-unified-v1.json` : Gere PDF et texte
- `prompt-pdf-strict-v2.json` : Reponses strictes sur PDF
- `prompt-conversational-v1.json` : Style plus naturel

**Commandes utiles** :
```bash
# Voir le prompt actif
cat config/llm.json | jq .system_prompt

# Lister les archives
ls -la config/prompts/

# Voir les metadonnees d'une archive
cat config/prompts/prompt-unified-v1.json | jq ._metadata

# Restaurer un prompt
cp config/prompts/prompt-unified-v1.json config/llm.json
```

## Compilation TypeScript

### tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

### Scripts npm

```json
{
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## Integration avec l'orchestrateur

L'orchestrateur appelle :

```javascript
const { startProjectName } = await import('.../traitement-ia/dist/index.js');
const service = await startProjectName();
```

Le module retourne :

```typescript
interface ServiceInstance {
  stop: () => void;
}
```

## Testing

### Test local (sans Docker)

```bash
# 1. Configuration
cp .env.example .env
nano .env  # Ajouter vraie MISTRAL_API_KEY

# 2. Compiler
npm install
npm run build

# 3. Preparer des emails de test
mkdir -p ../storage/00_mail_in

# 4. Lancer
npm start

# 5. Observer
ls -lh ../storage/10_ia_requests/
```

### Test dans Docker

```bash
# 1. Rebuild
docker compose build

# 2. Demarrer
docker compose up -d

# 3. Observer logs
docker compose logs -f | grep traitement-ia

# 4. Verifier sortie
ls -lh storage/10_ia_requests/
```

## Depannage

### Module ne demarre pas

1. Verifier `MISTRAL_API_KEY` definie dans .env
2. Verifier compilation: `npm run build`
3. Consulter logs: `docker compose logs`

### Pas de traitement

1. Verifier emails dans `00_mail_in/` : `ls storage/00_mail_in/`
2. Verifier logs du cycle : `docker compose logs | grep "processing cycle"`
3. Augmenter verbosite : `LOG_LEVEL=debug`

### Erreurs Mistral

- **401 Unauthorized** : Cle API invalide
- **429 Rate Limit** : Trop de requetes, augmenter intervalle
- **Timeout** : Augmenter `MISTRAL_TIMEOUT_MS`

## Modifications futures

### Ajouter un nouveau champ de sortie

1. Modifier l'interface `ProcessedEmailData` dans `src/persistence/file-storage.ts`
2. Modifier `createProcessedEmail()` dans `src/models/processed-email.ts`
3. Recompiler : `npm run build`

### Changer le modele Mistral

1. Modifier `config/llm.json` :
   ```json
   {
     "model": "mistral-large-latest"
   }
   ```

2. Pas de recompilation necessaire (rechargement dynamique)

## Conventions de code

- **TypeScript strict** : Mode strict active
- **Modules ES** : Imports avec `.js` extension
- **Async/await** : Pas de callbacks
- **Erreurs** : Try/catch, ne jamais throw dans cycle
- **Logs** : Timestamps ISO, niveaux clairs
- **Atomicite** : Toujours tmp + rename pour fichiers

## Securite

**Ne JAMAIS committer** :
- `.env` (cle API)
- `storage/` (donnees emails)
- `logs/` (peut contenir PII)
- `dist/` (code compile)

**Verifier .gitignore** contient :
```
.env
storage/
logs/
dist/
node_modules/
```

## Ressources

- **Mistral Document Q&A** : https://docs.mistral.ai/capabilities/document_ai/document_qna
- **Mistral Chat Completion** : https://docs.mistral.ai/capabilities/completion/usage
- **SDK Mistral JS** : https://github.com/mistralai/client-js

## Metriques a surveiller

- Temps de traitement moyen (`processing_time_ms`)
- Taux d'erreur (`status="error"`)
- Cout API (usage tokens)
- Latence API
- Nombre d'emails en attente
