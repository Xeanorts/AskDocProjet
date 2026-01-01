# Project Name - Module Réception

**Synchronisation IMAP** - Sauvegarde automatiquement vos emails en fichiers JSON accessibles par d'autres programmes.

## Description

Ce service de synchronisation d'emails est conçu pour :
- ✅ **Synchroniser automatiquement** vos emails depuis Zimbra/OVH (configurable, 2-5 minutes)
- ✅ Parser et traiter les emails (headers, corps texte/HTML, pièces jointes)
- ✅ Stocker les emails en **fichiers JSON standardisés** dans le file bus
- ✅ Tourner dans Docker pour une intégration facile

## Fonctionnement

```
Zimbra (OVH) → IMAP Sync (interval configurable) → Parser → File Bus (./storage/00_mail_in/)
                                                                        ↓
                                                           Modules suivants (traitement-ia, etc.)
```

**Utilité** : Récupérez automatiquement tous les emails de votre boîte mail professionnelle OVH/Zimbra et accédez-y depuis vos applications via de simples fichiers JSON.

## Architecture

Le projet est organisé simplement :
- **Synchronisation IMAP** (`src/imap/`) : Connexion et récupération depuis Zimbra/OVH
- **Parser d'emails** (`src/parser/`) : Extraction des données (mailparser)
- **Stockage JSON** (`src/persistence/`) : Sauvegarde en fichiers JSON
- **Utilitaires** (`src/utils/`) : Logger, helpers

Pour l'architecture complète avec fonctionnalités futures, consultez [ARCHITECTURE.md](./ARCHITECTURE.md).

## Démarrage rapide

### Configuration initiale

```bash
# 1. Copier le fichier de configuration
cp .env.example .env

# 2. Éditer .env et configurer IMAP pour Zimbra
nano .env

# Configurer ces variables :
# IMAP_ENABLED=true
# IMAP_HOST=ssl0.ovh.net
# IMAP_USER=votre-email@domain.com
# IMAP_PASSWORD=votre-mot-de-passe
```

### 🐳 Avec Docker (Recommandé)

```bash
# 1. Démarrer la synchronisation IMAP
docker compose up -d

# 2. Voir les logs de synchronisation
docker compose logs -f

# 3. Consulter les emails synchronisés
ls -lh storage/00_mail_in/
# ou
npm run list-emails

# 4. Arrêter le service
docker compose down
```

### 🛠️ Sans Docker (Développement local)

```bash
# 1. Installer les dépendances
npm install

# 2. Démarrer la synchronisation
npm start

# 3. Consulter les emails reçus
npm run list-emails
```

Les emails sont sauvegardés dans `./storage/00_mail_in/` et accessibles depuis l'hôte.

## Accès aux emails depuis vos programmes

Les emails sont sauvegardés en fichiers JSON dans le dossier `./storage/00_mail_in/` (file bus standardisé) avec le format de nommage : `YYYYMMDD_HHMMSS_<uuid>.json`

### Format des fichiers JSON

Chaque email contient :
```json
{
  "id": "uuid",
  "from": { "address": "sender@example.com", "name": "..." },
  "to": [{ "address": "recipient@example.com", "name": "..." }],
  "subject": "...",
  "date": "2025-11-04T...",
  "body_text": "Corps en texte brut",
  "body_html": "Corps en HTML",
  "headers": { ... },
  "attachments": [
    {
      "filename": "...",
      "contentType": "...",
      "size": 1234,
      "path": null
    }
  ]
}
```

### Exemple de lecture depuis un autre programme

**Python:**
```python
import json
import os

# Lire le dernier email depuis le file bus
emails_dir = "./storage/00_mail_in"
files = sorted(os.listdir(emails_dir), reverse=True)
if files:
    with open(os.path.join(emails_dir, files[0])) as f:
        email = json.load(f)
        print(f"From: {email['from']['address']}")
        print(f"Subject: {email['subject']}")
        print(f"Body: {email['body_text']}")
```

**Node.js:**
```javascript
import fs from 'fs';
import path from 'path';

const emailsDir = './storage/00_mail_in';
const files = fs.readdirSync(emailsDir).sort().reverse();
if (files.length > 0) {
    const email = JSON.parse(
        fs.readFileSync(path.join(emailsDir, files[0]))
    );
    console.log(`From: ${email.from.address}`);
    console.log(`Subject: ${email.subject}`);
    console.log(`Body: ${email.body_text}`);
}
```

## Documentation

- **[IMAP.md](./IMAP.md)** - 📬 Guide de synchronisation Zimbra (COMMENCER ICI !)
- [STORAGE.md](./STORAGE.md) - 💾 Format détaillé des fichiers JSON
- [SECURITY.md](./SECURITY.md) - 🔒 Bonnes pratiques de sécurité
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 🏗️ Architecture complète (planification future)

## Fonctionnalités

### ✅ Disponible maintenant
- ✅ **Synchronisation IMAP Zimbra/OVH**
  - Récupération automatique à intervalle configurable (30s par défaut)
  - Support Zimbra OVH et serveurs auto-hébergés
  - Marquage des emails comme lus (optionnel)
  - Gestion complète des pièces jointes
  - Logging détaillé

- ✅ **Parser d'emails complet**
  - Parsing avec mailparser (robuste et testé)
  - Extraction : From/To/Subject/Date/Headers
  - Corps texte brut et HTML
  - Pièces jointes avec métadonnées

### Limites des pieces jointes

| Limite | Valeur |
|--------|--------|
| Taille max par PDF | 20 MB |
| Taille totale max | 20 MB |

Les PDFs dépassant ces limites sont marqués `skipped` dans le JSON avec la raison (`skipped_reason`).

- ✅ **File Bus standardisé**
  - Sauvegarde automatique dans `./storage/00_mail_in/`
  - Format JSON standardisé pour inter-module communication
  - Nommage chronologique (YYYYMMDD_HHMMSS_uuid.json)
  - Accessible depuis l'hôte via volume Docker
  - Champs standardisés: body_text, body_html

- ✅ **Déploiement simple**
  - Container Docker unique
  - Script de déploiement automatique (`./deploy.sh`)
  - Configuration par variables d'environnement (.env)
  - Démarrage rapide avec `docker compose up`

### 🔮 Évolutions possibles (si besoin)
- [ ] Envoi d'emails (SMTP sortant)
- [ ] API REST pour accès HTTP
- [ ] Base de données PostgreSQL
- [ ] Webhooks/notifications
- [ ] Interface web

## Configuration

Variables d'environnement principales (dans `.env`) :

```bash
# Obligatoire
IMAP_HOST=ssl0.ovh.net              # Serveur IMAP Zimbra
IMAP_USER=votre-email@domain.com    # Votre adresse email
IMAP_PASSWORD=votre-mot-de-passe    # Votre mot de passe

# Optionnel
IMAP_PORT=993                       # Port IMAP SSL (défaut: 993)
IMAP_MAILBOX=INBOX                  # Boîte mail à synchroniser (défaut: INBOX)
IMAP_SYNC_INTERVAL=30000            # Intervalle en ms (30000 = 30s, 60000 = 1 min)
IMAP_MARK_AS_READ=true              # Marquer comme lu (défaut: true)
STORAGE_PATH=/app/storage/00_mail_in # Chemin de stockage (file bus standardisé)
LOG_LEVEL=info                      # Niveau de log (debug, info, warn, error)
```

Dans Docker, les emails sont sauvegardés dans `./storage/00_mail_in/` sur l'hôte (bind mount automatique).

## Licence

À définir

## Contribution

Les contributions sont les bienvenues ! Consultez d'abord l'architecture dans [ARCHITECTURE.md](./ARCHITECTURE.md).
