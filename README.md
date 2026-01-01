# AskDocProjet

Systeme de Q&A documentaire par email. Importez vos documents PDF, posez des questions, recevez des reponses argumentees avec sources.

## Fonctionnement

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Reception IMAP │───>│   Orchestrator   │───>│   Envoi SMTP    │
│  (30s polling)  │    │  (5s, tous mails)│    │                 │
└─────────────────┘    └────────┬─────────┘    └─────────────────┘
                               │
                      ┌────────▼─────────┐
                      │  Traitement IA   │
                      │  (Mistral API)   │
                      │  + SQLite BDD    │
                      └──────────────────┘
```

### Deux flux principaux

| Flux | Declencheur | Action |
|------|-------------|--------|
| **Import** | `(add)` dans l'objet | Indexe les PDFs/ZIPs dans la base documentaire |
| **Question** | Objet sans `(add)` | Analyse les documents et repond a la question |

---

## Flux Import `(add)`

Envoyez un email avec `(add)` dans l'objet + pieces jointes PDF ou ZIP.

**Pipeline d'indexation :**
1. Extraction des PDFs (ZIP decompresse recursivement)
2. Decoupe automatique des gros PDFs (max 100 pages/part)
3. Upload Mistral OCR
4. Analyse IA : 5 appels API specialises par document
   - Titre, Type, Sujets, Mots-cles, Resume
5. Stockage metadonnees en SQLite
6. Email de confirmation

**Email de confirmation :**
```
✓ Import termine

Archive : documentation-projet.zip

Documents importes : 8
Fichiers ignores : 3 (formats non supportes)
Doublons : 1
Erreurs : 0
```

---

## Flux Question

Envoyez un email avec votre question (sans `(add)` dans l'objet).

**Pipeline Q&A (a venir) :**
1. IA Pre-selection : choisit les documents pertinents
2. IA Lectrices : extrait les informations de chaque document
3. IA Compilatrice : synthetise une reponse argumentee

**Reponse attendue :**
```
[Reponse detaillee]

---
Sources :
- Cahier des charges v2, page 12 : "citation"
- Specifications techniques, page 5 : "citation"

Documents analyses : 3
```

---

## Architecture

```
AskDocProjet/
├── orchestrator.js          # Orchestrateur principal
├── reception-mail/          # Module reception IMAP
├── traitement-ia/           # Module IA Mistral (TypeScript)
│   ├── src/
│   │   ├── processors/      # Import, Question, Pre-selection...
│   │   ├── services/        # Mistral, PDF-split, ZIP...
│   │   └── persistence/     # SQLite database
│   └── config/
│       ├── llm-indexation-*.json  # Prompts indexation (5 fichiers)
│       ├── llm-preselection.json  # Prompt pre-selection
│       ├── llm-reader.json        # Prompt lectrice
│       └── llm-compiler.json      # Prompt compilatrice
├── email-send/              # Module envoi SMTP
├── config/
│   └── whitelist.json       # Expediteurs autorises
├── storage/
│   ├── 00_mail_in/          # Emails entrants
│   ├── 10_ia_requests/      # Resultats traitement
│   ├── 11_pdf_cache/        # Cache PDF Mistral
│   └── 12_conversation_threads/
├── data/
│   └── askdoc.db            # Base SQLite documents
└── docker-compose.yml
```

---

## Configuration

### Variables d'environnement (.env)

```bash
# IMAP (reception)
IMAP_HOST=ssl0.ovh.net
IMAP_PORT=993
IMAP_USER=votre-email@domain.com
IMAP_PASSWORD=votre-mot-de-passe

# SMTP (envoi)
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=465
SMTP_USER=votre-email@domain.com
SMTP_PASSWORD=votre-mot-de-passe
SMTP_FROM_EMAIL=votre-email@domain.com
SMTP_FROM_NAME=AskDoc

# Mistral AI
MISTRAL_API_KEY=votre-cle-api
```

### Whitelist (config/whitelist.json)

```json
{
  "allowed_emails": ["utilisateur@example.com"],
  "allowed_domains": ["example.com"]
}
```

---

## Selection du modele IA

Ajoutez un tag dans l'objet pour choisir le modele :

| Tag | Modele | Usage |
|-----|--------|-------|
| _(aucun)_ | mistral-small | Rapide, economique |
| `(pro)` | mistral-medium | Meilleure qualite |
| `(max)` | mistral-large | Qualite maximale |

**Exemples :**
- `Question sur le projet` → mistral-small
- `(add) Documentation projet` → Import standard
- `(pro) Analyse detaillee` → mistral-medium
- `(add)(max) Contrats importants` → Import avec analyse maximale

---

## Limites techniques

| Limite | Valeur |
|--------|--------|
| Pages max par part PDF | 100 |
| Taille max par PDF | 30 MB |
| Nombre max de PDFs/email | 10 |
| Timeout API | 120s |
| Delai entre appels API | 1s |

---

## Deploiement

```bash
# Configuration
cp .env.example .env
cp config/whitelist.json.example config/whitelist.json
nano .env

# Deploiement
docker compose up -d

# Logs
docker compose logs -f orchestrator
```

---

## Commandes utiles

```bash
# Status
docker compose ps

# Logs temps reel
docker compose logs -f

# Rebuild complet
docker compose build --no-cache && docker compose up -d

# Verifier la base documentaire
sqlite3 data/askdoc.db "SELECT filename, title, document_type FROM documents;"
```

---

## Licence

ISC
