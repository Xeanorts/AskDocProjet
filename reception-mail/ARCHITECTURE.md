# Architecture du Module Project Name Réception

> **Note:** Ce document décrit l'architecture complète planifiée pour le serveur de réception de mails, incluant des fonctionnalités futures. Pour l'architecture actuelle du MVP, voir [CLAUDE.md](./CLAUDE.md).

## Architecture MVP (Actuelle)

**Actuellement implémenté:**
- ✅ Synchronisation IMAP depuis Zimbra (toutes les 5 minutes)
- ✅ Serveur SMTP local (port 2525, optionnel)
- ✅ Parser d'emails (headers, body, pièces jointes)
- ✅ Stockage JSON dans `./storage/emails/`
- ✅ Accès direct aux fichiers JSON (pas d'API)

**Non implémenté (voir sections ci-dessous pour architecture future):**
- API REST
- Base de données PostgreSQL
- Services de recherche
- Webhooks/notifications

## Vue d'ensemble (Architecture Future)

Ce programme sera un serveur de réception de mails conçu pour recevoir des emails entrants et les mettre à disposition d'autres programmes via une API.

## Objectifs

1. Recevoir des emails via le protocole SMTP
2. Stocker les emails de manière persistante
3. Exposer une API pour permettre aux autres programmes d'accéder aux emails
4. Traiter et parser les emails (headers, body, pièces jointes)

## Architecture Globale

```
┌─────────────────┐
│  Clients Email  │
│  (SMTP)         │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         Serveur SMTP                     │
│  (Réception des emails entrants)        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│     Service de Traitement               │
│  - Parsing des headers                  │
│  - Extraction du corps                  │
│  - Gestion des pièces jointes           │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│     Couche de Stockage                  │
│  - Base de données (métadonnées)        │
│  - Système de fichiers (contenu)        │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────┐
│         API REST/HTTP                    │
│  - Consultation des emails              │
│  - Recherche                             │
│  - Téléchargement des pièces jointes    │
└────────┬────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│  Programmes     │
│  Clients        │
└─────────────────┘
```

## Composants Principaux

### 1. Serveur SMTP

**Responsabilités:**
- Écouter sur le port SMTP (25, 587, ou 2525)
- Gérer les connexions SMTP entrantes
- Valider les commandes SMTP
- Recevoir les données des emails

**Technologies suggérées:**
- Node.js: `smtp-server` (nodemailer)
- Python: `aiosmtpd`
- Go: `go-smtp`

### 2. Service de Traitement des Emails

**Responsabilités:**
- Parser les emails reçus (RFC 5322)
- Extraire les headers (From, To, Subject, Date, etc.)
- Décoder le contenu (MIME, base64, quoted-printable)
- Gérer les emails multipart
- Extraire et sauvegarder les pièces jointes

**Fonctionnalités:**
- Parsing MIME
- Décodage des encodages
- Extraction des métadonnées
- Validation des formats

### 3. Couche de Stockage

**Responsabilités:**
- Persister les emails et leurs métadonnées
- Gérer le stockage des pièces jointes
- Indexer pour la recherche
- Gérer la rétention des données

**Modèle de données:**

```
Email:
  - id (UUID)
  - from (adresse expéditeur)
  - to (liste d'adresses destinataires)
  - cc (liste d'adresses en copie)
  - subject (sujet)
  - date (date de réception)
  - headers (objet JSON avec tous les headers)
  - body_text (corps en texte brut)
  - body_html (corps en HTML)
  - attachments (liste de références vers les fichiers)
  - size (taille totale en octets)
  - raw (email brut optionnel)

Attachment:
  - id (UUID)
  - email_id (référence vers l'email)
  - filename (nom du fichier)
  - content_type (type MIME)
  - size (taille en octets)
  - path (chemin vers le fichier stocké)
```

**Options de stockage:**
- Base de données: PostgreSQL, MySQL, MongoDB
- Fichiers: Système de fichiers avec organisation par date/id
- Cache: Redis pour les accès fréquents

### 4. API REST

**Responsabilités:**
- Exposer les endpoints pour accéder aux emails
- Gérer l'authentification et l'autorisation
- Fournir des fonctionnalités de recherche et filtrage
- Permettre le téléchargement des pièces jointes

**Endpoints suggérés:**

```
GET    /api/emails              # Liste des emails (avec pagination)
GET    /api/emails/:id          # Détails d'un email
GET    /api/emails/:id/raw      # Email brut (format EML)
GET    /api/emails/:id/attachments/:attachment_id  # Télécharger une pièce jointe
DELETE /api/emails/:id          # Supprimer un email
GET    /api/search?q=...        # Recherche d'emails
GET    /api/health              # Health check
```

**Paramètres de recherche:**
- from, to, subject (recherche textuelle)
- date_from, date_to (plage de dates)
- has_attachments (booléen)
- limit, offset (pagination)

## Structure du Projet

```
reception-mail/
├── src/
│   ├── smtp/
│   │   ├── server.js|py|go         # Serveur SMTP principal
│   │   ├── handler.js|py|go        # Gestionnaire de messages
│   │   └── config.js|py|go         # Configuration SMTP
│   │
│   ├── parser/
│   │   ├── email-parser.js|py|go   # Parser d'emails
│   │   ├── mime-handler.js|py|go   # Gestion MIME
│   │   └── attachment.js|py|go     # Extraction pièces jointes
│   │
│   ├── storage/
│   │   ├── database.js|py|go       # Interface base de données
│   │   ├── file-storage.js|py|go   # Stockage fichiers
│   │   └── repository.js|py|go     # Couche d'accès aux données
│   │
│   ├── api/
│   │   ├── server.js|py|go         # Serveur API HTTP
│   │   ├── routes/
│   │   │   ├── emails.js|py|go     # Routes emails
│   │   │   └── health.js|py|go     # Routes health check
│   │   ├── middleware/
│   │   │   ├── auth.js|py|go       # Authentification
│   │   │   └── error.js|py|go      # Gestion erreurs
│   │   └── controllers/
│   │       └── email-controller.js|py|go
│   │
│   ├── models/
│   │   ├── email.js|py|go          # Modèle Email
│   │   └── attachment.js|py|go     # Modèle Attachment
│   │
│   ├── services/
│   │   ├── email-service.js|py|go  # Logique métier emails
│   │   └── search-service.js|py|go # Recherche
│   │
│   └── utils/
│       ├── logger.js|py|go         # Logging
│       └── validator.js|py|go      # Validation
│
├── config/
│   ├── default.json                # Configuration par défaut
│   ├── production.json             # Configuration production
│   └── development.json            # Configuration développement
│
├── tests/
│   ├── unit/                       # Tests unitaires
│   ├── integration/                # Tests d'intégration
│   └── fixtures/                   # Données de test
│
├── docs/
│   └── api.md                      # Documentation API
│
├── migrations/                     # Migrations base de données
│
├── docker/
│   ├── Dockerfile                  # Image Docker
│   └── docker-compose.yml          # Orchestration
│
├── scripts/
│   └── setup.sh                    # Scripts d'installation
│
├── .env.example                    # Variables d'environnement exemple
├── package.json | requirements.txt | go.mod
├── README.md
└── ARCHITECTURE.md
```

## Configuration

### Variables d'environnement

```bash
# SMTP
SMTP_PORT=2525
SMTP_HOST=0.0.0.0
SMTP_MAX_SIZE=25000000  # 25MB

# API
API_PORT=3000
API_HOST=0.0.0.0
API_AUTH_ENABLED=true
API_JWT_SECRET=your-secret-key

# Base de données
DB_TYPE=postgresql
DB_HOST=localhost
DB_PORT=5432
DB_NAME=mail_server
DB_USER=mailuser
DB_PASSWORD=mailpass

# Stockage
STORAGE_PATH=/var/mail/storage
RETENTION_DAYS=30

# Logging
LOG_LEVEL=info
LOG_FILE=/var/log/projectname-reception.log
```

## Flux de Traitement d'un Email

1. **Réception SMTP**
   - Client se connecte au serveur SMTP
   - Handshake SMTP (EHLO/HELO)
   - Commandes MAIL FROM, RCPT TO
   - Transmission des données (DATA)

2. **Parsing**
   - Parser l'email brut
   - Extraire les headers
   - Décoder le contenu
   - Identifier les pièces jointes

3. **Stockage**
   - Générer un ID unique
   - Sauvegarder les métadonnées en base
   - Sauvegarder les pièces jointes sur disque
   - Indexer pour la recherche

4. **Notification** (optionnel)
   - Webhook vers applications clientes
   - WebSocket pour mises à jour en temps réel

## Sécurité

### Considérations

1. **Authentification SMTP** (optionnelle)
   - SMTP AUTH pour restreindre l'envoi
   - Whitelist d'adresses IP

2. **Authentification API**
   - JWT tokens
   - API Keys
   - Rate limiting

3. **Validation**
   - Validation des adresses email
   - Limite de taille des emails
   - Filtrage anti-spam (optionnel)

4. **Isolation**
   - Sandboxing pour le parsing
   - Scan antivirus des pièces jointes (optionnel)

## Scalabilité

### Stratégies

1. **Horizontale**
   - Plusieurs instances SMTP derrière un load balancer
   - Queue de traitement (RabbitMQ, Redis)
   - Workers pour le parsing

2. **Stockage**
   - Base de données répliquée
   - Stockage distribué (S3, MinIO)
   - Archivage des anciens emails

3. **Cache**
   - Redis pour les emails fréquemment consultés
   - CDN pour les pièces jointes

## Monitoring et Observabilité

### Métriques

- Nombre d'emails reçus par minute/heure
- Temps de traitement moyen
- Taille moyenne des emails
- Taux d'erreur
- Utilisation du stockage

### Logging

- Logs structurés (JSON)
- Niveaux: DEBUG, INFO, WARN, ERROR
- Rotation des logs

### Health Checks

- Endpoint `/api/health`
- Vérification connectivité base de données
- Vérification espace disque
- État du serveur SMTP

## Technologies Recommandées

### Option 1: Node.js

- **SMTP**: nodemailer/smtp-server
- **Parser**: mailparser
- **API**: Express.js ou Fastify
- **ORM**: Prisma, TypeORM, Sequelize
- **Base**: PostgreSQL + Redis

### Option 2: Python

- **SMTP**: aiosmtpd
- **Parser**: email (stdlib), python-email-parser
- **API**: FastAPI ou Flask
- **ORM**: SQLAlchemy, Django ORM
- **Base**: PostgreSQL + Redis

### Option 3: Go

- **SMTP**: go-smtp
- **Parser**: email (go-mail)
- **API**: Gin, Echo, ou Chi
- **ORM**: GORM
- **Base**: PostgreSQL + Redis

## Phases d'Implémentation

### Phase 1: MVP
- Serveur SMTP basique
- Stockage simple (fichiers)
- API de consultation basique

### Phase 2: Enrichissement
- Parsing complet MIME
- Base de données
- Recherche

### Phase 3: Production
- Authentification
- Monitoring
- Tests complets
- Documentation

### Phase 4: Avancé
- Webhooks
- Archivage
- Interface web
- Clustering

## Conclusion

Cette architecture propose un système modulaire, scalable et maintenable pour la réception et la distribution d'emails. Chaque composant peut être développé et testé indépendamment, facilitant l'évolution future du système.
