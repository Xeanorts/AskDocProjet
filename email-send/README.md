# Module Email Send

Module SMTP d'envoi d'emails pour Project Name.

## Vue d'ensemble

Ce module gère l'envoi des réponses LLM par email via SMTP. Il est utilisé par l'orchestrateur pour envoyer les réponses générées aux expéditeurs des emails entrants.

**Fonctionnement** :
- Appelé directement par `orchestrator.js` après traitement LLM
- Envoie un email de réponse simple (texte brut)
- Configuration SMTP via variables d'environnement
- Vérification de la connexion SMTP au démarrage

## Configuration

### Variables d'environnement requises

Dans le `.env` racine :

```bash
# SMTP Server (OVH)
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=465
SMTP_SECURE=true

# SMTP Credentials
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-smtp-password

# Email Sender
SMTP_FROM_EMAIL=your-email@domain.com
SMTP_FROM_NAME=AI Email Assistant

# Optionnel
EMAIL_SEND_TIMEOUT_MS=30000
```

### Paramètres SMTP OVH

**Configuration recommandée** :
- **SMTP_HOST** : `smtp.mail.ovh.net` (ou `ssl0.ovh.net`)
- **SMTP_PORT** : `465` (SSL) ou `587` (STARTTLS)
- **SMTP_SECURE** : `true` si port 465, `false` si port 587

## Utilisation

### Dans l'orchestrateur

```javascript
import { sendEmail, initEmailService } from './email-send/src/index.js';

// Initialisation (au démarrage)
await initEmailService();

// Envoi d'un email simple
const result = await sendEmail(
  'recipient@example.com',
  'Re: Your request',
  'This is the AI response...'
);

if (result.success) {
  console.log('Email sent successfully');
} else {
  console.error('Email failed:', result.error);
}
```

### Support des pieces jointes

La fonction `sendEmail()` supporte les pieces jointes en 4eme parametre :

```javascript
const attachments = [
  {
    filename: 'document.pdf',
    content: pdfBuffer,           // Buffer du fichier
    contentType: 'application/pdf'
  }
];

const result = await sendEmail(
  'recipient@example.com',
  'Re: Your request',
  'Voici la reponse...',
  attachments
);
```

L'orchestrateur renvoie automatiquement les PDFs originaux en piece jointe dans les reponses.

### Format des réponses

```javascript
// Succès
{
  success: true,
  error: null
}

// Erreur
{
  success: false,
  error: "SMTP Error: Connection timeout"
}
```

## Architecture

**Composants** :
- `src/index.js` : Point d'entrée, fonctions publiques
- `src/services/mail-sender-service.js` : Client SMTP (nodemailer)
- `src/utils/logger.js` : Logging simple

**Dépendance** : `nodemailer` pour l'envoi SMTP

## Workflow

1. **Initialisation** : `initEmailService()` au démarrage de l'orchestrateur
2. **Validation** : Vérification de la config SMTP (fail-fast si manquante)
3. **Test connexion** : Connexion SMTP testée au démarrage
4. **Envoi** : `sendEmail()` appelé après chaque traitement LLM
5. **Gestion erreurs** : Retourne `{success, error}` sans crasher

## Logs

```
[EMAIL-SEND] Initializing email service...
[EMAIL-SEND] SMTP config validated: smtp.mail.ovh.net:465
[EMAIL-SEND] SMTP transporter configured: smtp.mail.ovh.net:465
[EMAIL-SEND] Verifying SMTP connection...
[EMAIL-SEND] SMTP connection verified successfully
[EMAIL-SEND] Email service initialized successfully
```

## Dépannage

### Service ne démarre pas

**Erreur** : `Missing required SMTP config: host, port, user, password, from`

**Solution** :
1. Vérifier que toutes les variables SMTP sont définies dans `.env`
2. Vérifier la syntaxe (pas d'espaces, pas de guillemets superflus)

### Connexion SMTP échoue

**Erreur** : `SMTP connection failed - check credentials`

**Vérifications** :
- Credentials corrects (SMTP_USER, SMTP_PASSWORD)
- Serveur SMTP accessible (ping smtp.mail.ovh.net)
- Port correct (465 pour SSL, 587 pour STARTTLS)
- `SMTP_SECURE=true` si port 465

**Erreurs courantes OVH** :
- `535 Authentication failed` : Mauvais mot de passe
- `Connection timeout` : Firewall/Port bloqué
- `Certificate error` : `SMTP_SECURE` incorrectement configuré

### Email non reçu

**Vérifications** :
1. Logs montrent `success: true` ?
2. Vérifier spam/courrier indésirable
3. Vérifier que `SMTP_FROM_EMAIL` est autorisé à envoyer depuis OVH
4. Tester avec un autre destinataire

## Sécurité

⚠️ **Ne JAMAIS commiter** :
- `.env` (contient SMTP_PASSWORD)
- Logs contenant des credentials
- Fichiers de configuration avec mots de passe

✅ **Bonnes pratiques** :
- Utiliser des mots de passe forts pour SMTP
- Surveiller les logs d'envoi
- Vérifier que `.env` est dans `.gitignore`

## Documentation technique

Voir `CLAUDE.md` pour :
- Architecture détaillée
- Patterns de code
- Conventions de développement
- Tests et déploiement
