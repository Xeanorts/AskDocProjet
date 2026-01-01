# CLAUDE.md - TempIAMail (Template)

Documentation racine pour Claude Code. Pour les details techniques de chaque module, voir les fichiers `CLAUDE.md` specifiques dans chaque sous-dossier.

## Ce projet est un template

Ce depot est un template pour creer des systemes de traitement IA par email. Voir `README.md` pour les instructions d'utilisation.

### Placeholders a remplacer

| Placeholder | Format | Usage |
|-------------|--------|-------|
| `projectname` | minuscules | packages, conteneurs, chemins |
| `ProjectName` | PascalCase | fonctions TypeScript |
| `Project Name` | avec espace | titres, descriptions |

### Commandes de remplacement

```bash
find . -type f -not -path './.git/*' -exec sed -i 's/projectname/monprojet/g' {} +
find . -type f -not -path './.git/*' -exec sed -i 's/ProjectName/MonProjet/g' {} +
find . -type f -not -path './.git/*' -exec sed -i 's/Project Name/Mon Projet/g' {} +
```

---

## Description du systeme

Project Name est un systeme de traitement automatique d'emails avec IA. Il recoit des emails, les analyse avec un LLM (Mistral AI), et repond automatiquement.

## Architecture globale

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  reception-mail │────>│  traitement-ia  │────>│   email-send    │
│   (IMAP sync)   │     │  (Mistral AI)   │     │     (SMTP)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        │                       │                       │
        └───────────────────────┴───────────────────────┘
                                │
                    ┌───────────────────────┐
                    │    orchestrator.js    │
                    │   (coordination)      │
                    └───────────────────────┘
```

## Flux de donnees

```
1. Email arrive sur boite OVH/Zimbra
   ↓
2. reception-mail sync IMAP → storage/00_mail_in/*.json
   ↓
3. traitement-ia lit email → appelle Mistral AI → storage/10_ia_requests/*.json
   ↓
4. orchestrator detecte reponse IA → email-send envoie via SMTP
```

## Modules

| Module | Role | Details |
|--------|------|---------|
| `reception-mail/` | Synchronisation IMAP | Voir `reception-mail/CLAUDE.md` |
| `traitement-ia/` | Traitement IA (Mistral) | Voir `traitement-ia/CLAUDE.md` |
| `email-send/` | Envoi SMTP | Voir `email-send/CLAUDE.md` |
| `orchestrator.js` | Coordination des modules | Point d'entree principal |

## Stack technique

- **Runtime** : Node.js 18+ (ES Modules)
- **Conteneurisation** : Docker + Docker Compose
- **LLM** : Mistral AI (Document Q&A)
- **Protocoles** : IMAP (reception), SMTP (envoi)
- **Stockage** : Fichiers JSON (pas de base de donnees)

## Commandes essentielles

```bash
# Deploiement production
./deploy.sh

# Developpement local
docker compose up -d
docker compose logs -f

# Verifier les emails en attente
ls storage/00_mail_in/

# Verifier les reponses IA
ls storage/10_ia_requests/
```

## Structure du stockage

```
storage/
├── 00_mail_in/          # Emails recus (input traitement-ia)
├── 10_ia_requests/      # Reponses IA (output traitement-ia)
└── 11_pdf_cache/        # Cache des PDFs uploades sur Mistral
```

## Configuration

- `.env` : Variables d'environnement (IMAP, SMTP, API keys)
- `.env.example` : Template de configuration
- `traitement-ia/config/llm.json` : Prompt emails sans PDF (copier depuis .example)
- `traitement-ia/config/llm-pdf.json` : Prompt emails avec PDF (copier depuis .example)
- `config/whitelist.json` : Liste blanche expediteurs (copier depuis .example)

## Regles globales

1. **Ne jamais committer** : `.env`, `storage/`, `logs/`, `dist/`
2. **ES Modules** : Toujours utiliser `.js` dans les imports
3. **Resilience** : Les services ne doivent jamais crasher, logger les erreurs et continuer
4. **Atomicite** : Ecriture fichiers via tmp + rename
5. **Developpement** : Toujours dans `/home/ubuntu/dev/projectname/`, jamais dans `/home/ubuntu/stacks/`
