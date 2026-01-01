# Module Traitement-IA

Module de traitement d'emails avec Mistral AI.

## Vue d'ensemble

Ce module traite les emails en utilisant l'API Mistral AI :
- **Avec PDF** : Reponses basees sur le contenu des documents (Document Q&A)
- **Sans PDF** : Reponses libres avec les connaissances generales de l'IA

**Workflow** :
1. Lecture de l'email (question + PDFs en base64)
2. Validation des limites (taille, nombre de fichiers)
3. Verification du cache PDF (hash SHA256)
4. Upload des PDFs non caches sur Mistral (purpose: "ocr")
5. Obtention des URLs signees pour chaque fichier
6. Envoi de la question avec toutes les URLs des documents
7. Sauvegarde de la reponse IA

**Note** : Les PDFs sont conserves sur Mistral pour le cache (cleanup automatique apres 7 jours d'inactivite).

## Technologies

- **Langage** : TypeScript
- **Runtime** : Node.js 18+
- **SDK** : @mistralai/mistralai
- **API** : Mistral Document Q&A

## Configuration

### Cle API (Secret)

La cle API Mistral est configuree dans le fichier `.env` :

```bash
MISTRAL_API_KEY=your-api-key
```

Obtenir une cle : https://console.mistral.ai/api-keys

**Ne jamais versionner ce fichier dans Git.**

### Parametres LLM

Les parametres du LLM sont configures dans deux fichiers (templates fournis) :

```
traitement-ia/config/
├── llm.json.example      # Template emails SANS PDF (versionne)
├── llm.json              # Config active texte (gitignore)
├── llm-pdf.json.example  # Template emails AVEC PDF (versionne)
└── llm-pdf.json          # Config active PDF (gitignore)
```

#### Installation

```bash
cd config/
cp llm.json.example llm.json
cp llm-pdf.json.example llm-pdf.json
```

#### Structure des fichiers

```json
{
  "model": "mistral-small-latest",
  "max_output_tokens": 4000,
  "system_prompt": "Tu es un assistant IA..."
}
```

#### Parametres disponibles

| Parametre | Type | Par defaut | Description |
|-----------|------|------------|-------------|
| `model` | string | `mistral-small-latest` | Modele par defaut (peut etre surcharge par tag) |
| `max_output_tokens` | number | `4000` | Nombre maximum de tokens dans la reponse |
| `system_prompt` | string | ... | Instructions systeme pour le LLM |

#### Selection dynamique du modele

L'utilisateur peut choisir le modele via un tag dans le sujet de l'email :

| Tag dans le sujet | Modele | Description |
|-------------------|--------|-------------|
| _(aucun)_ | `mistral-small-latest` | Rapide, economique (defaut) |
| `(pro)` | `mistral-medium-latest` | Equilibre qualite/cout |
| `(max)` | `mistral-large-latest` | Qualite maximale |

**Exemples de sujets :**
- `Question sur mon contrat` → mistral-small
- `Question importante (pro)` → mistral-medium
- `Analyse complexe (max)` → mistral-large

## Limites PDF

| Limite | Valeur | Constante |
|--------|--------|-----------|
| Taille max par PDF | 20 MB | `MAX_PDF_SIZE_MB` |
| Taille totale max | 20 MB | `MAX_TOTAL_SIZE_MB` |
| Nombre max de PDFs | 10 | `MAX_PDF_COUNT` |

Si les limites sont depassees, un email d'erreur est genere et le traitement est abandonne.

## Installation

```bash
# Installer les dependances
npm install

# Compiler TypeScript
npm run build

# Demarrer
npm start
```

## Variables d'environnement

### Requises

| Variable | Description |
|----------|-------------|
| `MISTRAL_API_KEY` | Cle API Mistral (obligatoire) |

### Optionnelles

| Variable | Par defaut | Description |
|----------|------------|-------------|
| `STORAGE_PATH` | `/app/storage` | Chemin base du storage |
| `IA_INPUT_DIR` | `00_mail_in` | Repertoire des emails entrants |
| `IA_OUTPUT_DIR` | `10_ia_requests` | Repertoire des resultats |
| `MISTRAL_TIMEOUT_MS` | `120000` | Timeout API (millisecondes) |
| `LOG_LEVEL` | `info` | Niveau de log (debug, info, warn, error) |
| `DRY_RUN` | `false` | Mode test sans appels API Mistral |

> **Note** : L'intervalle de polling (5s) est defini dans l'orchestrateur principal.

## Mode Dry-Run (Test)

Le mode dry-run permet de tester le flux complet sans appeler l'API Mistral :

```bash
DRY_RUN=true npm start
```

En mode dry-run :
- Pas de cle API requise (`MISTRAL_API_KEY` ignore)
- Les PDFs sont listes mais pas uploades
- Une reponse simulee est retournee
- Le reste du flux fonctionne normalement (whitelist, envoi email, etc.)

Utile pour :
- Tester la configuration SMTP
- Verifier le flux de traitement
- Debugger sans consommer de credits API

## Architecture

```
src/
├── index.ts                    # Point d'entree
├── processors/
│   └── email-ai-processor.ts   # Orchestrateur du traitement
├── services/
│   ├── mistral-service.ts      # Client Mistral AI
│   └── pdf-cache-service.ts    # Cache des PDFs (SHA256)
├── persistence/
│   └── file-storage.ts         # Gestion des fichiers JSON
├── models/
│   └── processed-email.ts      # Modeles de donnees
└── utils/
    ├── logger.ts               # Logger
    └── config-loader.ts        # Chargeur de config LLM
```

## Cache PDF

Les PDFs uploades sur Mistral sont caches pour eviter les re-uploads :

- **Identification** : Hash SHA256 du contenu (pas le nom de fichier)
- **Stockage** : `storage/11_pdf_cache/cache-index.json`
- **Expiration** : 7 jours sans utilisation
- **Cleanup** : Automatique au demarrage du service

Si le meme PDF est envoye 2 fois (meme avec un nom different), il n'est uploade qu'une fois.

## Workflow Mistral Document Q&A

Le module implemente le workflow officiel Mistral avec support multi-documents :

```typescript
// 1. Upload de tous les PDFs
const fileIds: string[] = [];
for (const pdf of pdfs) {
  const fileId = await client.files.upload({
    file: { fileName: pdf.filename, content: pdf.buffer },
    purpose: 'ocr'
  });
  fileIds.push(fileId);
}

// 2. Obtention de toutes les URLs signees
const documentUrls: string[] = [];
for (const fileId of fileIds) {
  const signedUrl = await client.files.getSignedUrl({ fileId });
  documentUrls.push(signedUrl.url);
}

// 3. Chat completion avec tous les documents
const content = [
  { type: 'text', text: question },
  ...documentUrls.map(url => ({ type: 'document_url', documentUrl: url }))
];

const response = await client.chat.complete({
  model: 'mistral-small-latest',
  messages: [{ role: 'user', content }],
  safePrompt: true
});

// 4. Fichiers conserves pour cache
// Le cleanup est fait automatiquement apres 7 jours d'inactivite
// par le PdfCacheService au demarrage du service
```

## Specifications techniques

Selon le fichier `docs/Specifications` :

- **Non-streaming** : Utilisation de `chat.complete()` (pas de streaming)
- **TypeScript** : Code source entierement en TypeScript
- **safePrompt** : Flag `safePrompt: true` active sur tous les appels
- **Pas de prefix/stop** : Aucun prefix ni stop flag utilise

## Format des donnees

### Entree (00_mail_in/*.json)

```json
{
  "id": "uuid",
  "from": { "address": "user@example.com", "text": "User Name" },
  "subject": "Question sur le document",
  "body_text": "Quel est le resume de ce document ?",
  "attachments": [{
    "filename": "document.pdf",
    "contentType": "application/pdf",
    "size": 123456,
    "content_base64": "JVBERi0xLj..."
  }]
}
```

### Sortie (10_ia_requests/*.ia.json)

```json
{
  "email_id": "uuid",
  "from": "user@example.com",
  "subject": "Question sur le document",
  "received_at": "2024-01-15T10:00:00Z",
  "ai_response": "Le document presente...",
  "ai_model": "mistral-small-latest",
  "pdf_filename": "document1.pdf",
  "pdf_filenames": ["document1.pdf", "document2.pdf"],
  "processing_type": "document_qa",
  "status": "ok",
  "processed_at": "2024-01-15T10:00:30Z",
  "processing_time_ms": 5234,
  "api_usage": {
    "prompt_tokens": 1500,
    "completion_tokens": 500,
    "total_tokens": 2000
  }
}
```

- `pdf_filename` : Premier PDF traite (compatibilite)
- `pdf_filenames` : Liste de tous les PDFs traites

## Gestion des erreurs

Le module ne crash jamais. En cas d'erreur :

- Un fichier `.ia.json` avec `status: "error"` est cree
- L'erreur est loggee
- Le traitement continue au prochain cycle

Types d'erreurs gerees :
- Timeout API
- Rate limiting (429)
- Fichier PDF invalide
- PDF trop volumineux (> 20 MB)
- Trop de PDFs (> 10)
- Taille totale trop grande (> 20 MB)
- Email sans question
- Email sans PDF (traitement texte seul)

## Developpement

```bash
# Compiler en mode watch
npm run build -- --watch

# Lancer avec logs debug
LOG_LEVEL=debug npm start
```

## Tests

```bash
# Creer un email de test
mkdir -p ../storage/00_mail_in
cat > ../storage/00_mail_in/test.json << 'EOF'
{
  "id": "test-123",
  "from": {"address": "test@example.com"},
  "subject": "Test Q&A",
  "body_text": "Quel est le contenu de ce document ?",
  "attachments": [{
    "filename": "test.pdf",
    "contentType": "application/pdf",
    "size": 1000,
    "content_base64": "..."
  }]
}
EOF

# Observer le traitement
npm start
```

## Securite

**Ne JAMAIS committer** :
- `.env` (cle API)
- `storage/` (donnees emails)
- `logs/` (peut contenir PII)

Le `.gitignore` doit contenir :
```
.env
storage/
logs/
dist/
```

## Ressources

- [Mistral Document Q&A](https://docs.mistral.ai/capabilities/document_ai/document_qna)
- [Mistral Chat Completion](https://docs.mistral.ai/capabilities/completion/usage)
- [SDK Mistral JS](https://github.com/mistralai/client-js)

## Licence

ISC
