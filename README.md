# TempIAMail - Template

Template pour creer des systemes de traitement IA lances par email.

## Utilisation du template

### 1. Cloner le template

```bash
# Cloner dans un nouveau dossier
git clone https://github.com/Xeanorts/TempIAMail.git MonProjet
cd MonProjet

# Supprimer l'historique git pour repartir de zero
rm -rf .git
git init
```

### 2. Renommer le projet

Le template utilise des noms generiques faciles a rechercher/remplacer :

| Placeholder | Format | Exemple de remplacement |
|-------------|--------|-------------------------|
| `projectname` | minuscules | `monprojet` |
| `ProjectName` | PascalCase | `MonProjet` |
| `Project Name` | Avec espace | `Mon Projet` |

**Commandes de remplacement :**

```bash
# Remplacer dans tous les fichiers (Linux/Mac)
find . -type f -not -path './.git/*' -exec sed -i 's/projectname/monprojet/g' {} +
find . -type f -not -path './.git/*' -exec sed -i 's/ProjectName/MonProjet/g' {} +
find . -type f -not -path './.git/*' -exec sed -i 's/Project Name/Mon Projet/g' {} +

# Regenerer les package-lock.json
cd reception-mail && rm package-lock.json && npm install && cd ..
cd traitement-ia && rm package-lock.json && npm install && cd ..
```

**Fichiers principaux concernes :**

| Fichier | Contenu a modifier |
|---------|-------------------|
| `docker-compose.yml` | Noms des conteneurs et network |
| `package.json` (x4) | Nom et description des packages |
| `deploy.sh` | Chemin de deploiement |
| `traitement-ia/src/index.ts` | Noms des fonctions exportees |
| `*.md` | Documentation |
| `.env.example` | Commentaires |

### 3. Configurer le projet

```bash
# Copier les fichiers de configuration
cp .env.example .env
cp config/whitelist.json.example config/whitelist.json
cp traitement-ia/config/llm.json.example traitement-ia/config/llm.json
cp traitement-ia/config/llm-pdf.json.example traitement-ia/config/llm-pdf.json

# Editer la configuration
nano .env
nano config/whitelist.json
```

### 4. Deployer

```bash
./deploy.sh
```

---

## Description du systeme

Assistant IA par email : repond aux questions avec ou sans documents PDF, utilisant l'API Mistral AI.

### Fonctionnement

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Reception IMAP │───>│   Orchestrator   │───>│   Envoi SMTP    │
│  (30s polling)  │    │  (5s, tous mails)│    │                 │
└─────────────────┘    └────────┬─────────┘    └─────────────────┘
                               │
                      ┌────────▼─────────┐
                      │  Traitement IA   │
                      │  (Mistral API)   │
                      │  + Cache PDF     │
                      └──────────────────┘
```

1. **Reception email** : Emails recus via IMAP (dossier configurable, polling 30s)
2. **Whitelist** : Verification que l'expediteur est autorise
3. **Traitement Mistral** :
   - **Avec PDF** : Analyse du document, reponse basee uniquement sur son contenu
   - **Sans PDF** : Reponse libre avec les connaissances generales de l'IA
4. **Reponse** : Envoi de la reponse par email SMTP (PDFs renvoyes si presents)
5. **Idempotence** : Chaque email traite une seule fois (tracking par ID)

### Architecture

```
projectname/
├── orchestrator.js          # Orchestrateur principal (polling, whitelist, retry)
├── reception-mail/          # Module reception IMAP
├── traitement-ia/           # Module IA Mistral (TypeScript)
│   └── config/llm.json      # Configuration du prompt LLM
├── email-send/              # Module envoi SMTP
├── config/
│   └── whitelist.json       # Liste des expediteurs autorises
├── storage/
│   ├── 00_mail_in/          # Emails entrants (JSON)
│   ├── 10_ia_requests/      # Resultats traitement
│   ├── 11_pdf_cache/        # Cache PDF (SHA256 -> Mistral fileId)
│   └── quarantine/          # Emails en erreur
├── deploy.sh                # Script de deploiement
├── docker-compose.yml       # Configuration Docker
└── .env                     # Configuration (credentials)
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
IMAP_MAILBOX=INBOX
IMAP_SYNC_INTERVAL=30000

# SMTP (envoi)
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=votre-email@domain.com
SMTP_PASSWORD=votre-mot-de-passe
SMTP_FROM_EMAIL=votre-email@domain.com
SMTP_FROM_NAME=Assistant IA

# Mistral AI
MISTRAL_API_KEY=votre-cle-api

# Mode test (true = pas d'appels API reels)
DRY_RUN=false
```

### Whitelist (config/whitelist.json)

```json
{
  "allowed_emails": [
    "utilisateur@example.com",
    "autre@example.com"
  ],
  "allowed_domains": []
}
```

### Prompts LLM (traitement-ia/config/)

Deux fichiers de prompts systeme :

| Fichier | Usage |
|---------|-------|
| `llm.json` | Emails sans PDF (reponses libres) |
| `llm-pdf.json` | Emails avec PDF (reponses basees sur le document) |

```json
{
  "model": "mistral-small-latest",
  "max_output_tokens": 4000,
  "system_prompt": "Tu es un assistant IA professionnel..."
}
```

---

## Commandes utiles

```bash
# Deployer
./deploy.sh

# Voir les logs
cd /home/ubuntu/stacks/projectname && docker compose logs -f

# Redemarrer
./deploy.sh --restart

# Status
./deploy.sh --status

# Sync config sans rebuild
./deploy.sh --sync

# Compiler le module TypeScript
cd traitement-ia && npm run build
```

---

## Selection du modele IA

Ajoutez un tag dans le sujet de l'email pour choisir le modele Mistral :

| Tag dans le sujet | Modele | Description |
|-------------------|--------|-------------|
| _(aucun)_ | mistral-small | Rapide, economique (defaut) |
| `(pro)` | mistral-medium | Equilibre qualite/cout |
| `(max)` | mistral-large | Qualite maximale |

**Exemples :**
- `Question sur mon contrat` → mistral-small (defaut)
- `Question importante (pro)` → mistral-medium
- `Analyse complexe (max)` → mistral-large

---

## Fonctionnalites

### Cache PDF intelligent

Les PDFs sont caches par hash SHA256 :
- Pas de re-upload sur Mistral si deja en cache
- Pas de re-OCR
- Reponse plus rapide
- Expiration apres 7 jours d'inactivite

### Idempotence

Chaque email est traite une seule fois. En cas de crash/redemarrage, pas de double-reponse.

### Retry avec backoff

En cas d'erreur LLM : 3 tentatives (30s, 60s, 120s), puis quarantine.

### Quarantine

Emails problematiques deplaces dans `storage/quarantine/` :
- Email vide
- Expediteur invalide ou non whiteliste
- Echec apres 3 tentatives

---

## Limites techniques

| Limite | Valeur |
|--------|--------|
| Taille max par PDF | 20 MB |
| Taille totale max | 20 MB |
| Nombre max de PDFs | 10 |
| Timeout LLM | 120s (configurable) |
| Cache PDF | 7 jours d'inactivite |

---

## Troubleshooting

### Permission denied sur storage/

```bash
sudo chmod -R 777 /home/ubuntu/stacks/projectname/storage/
```

### Email non recu

1. Verifier que l'expediteur est dans la whitelist
2. Verifier que l'email n'a pas deja ete traite (`10_ia_requests/`)
3. Verifier les logs IMAP : `docker compose logs reception-mail`

### Pas de reponse

1. Verifier `DRY_RUN=false` dans `.env`
2. Verifier la cle API Mistral
3. Verifier les logs : `docker compose logs orchestrator`

---

## Licence

ISC
