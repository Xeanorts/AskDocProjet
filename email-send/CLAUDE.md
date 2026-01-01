# CLAUDE.md - Module Email Send

Documentation technique pour Claude Code lors du développement et maintenance du module.

## Vue d'ensemble technique

**Module** : Envoi d'emails SMTP simple
**Langage** : Node.js 18+ (ES Modules)
**Dépendance principale** : nodemailer
**Architecture** : Service initialisé au démarrage, appelé à la demande

## Architecture détaillée

### Composants principaux

1. **Point d'entrée** (`src/index.js`)
   - Fonctions publiques : `initEmailService()`, `sendEmail()`, `closeEmailService()`
   - Gestion de l'instance singleton du MailSenderService
   - Validation de configuration
   - Gestion d'erreurs globale

2. **MailSenderService** (`src/services/mail-sender-service.js`)
   - Client SMTP utilisant nodemailer
   - Envoi d'email simple (texte brut)
   - Timeout configurable (défaut 30s)
   - Vérification connexion SMTP au startup

3. **Logger** (`src/utils/logger.js`)
   - Logger console simple
   - Filtrage par LOG_LEVEL (debug, info, warn, error)
   - Format standardisé avec timestamps

### Flux d'utilisation

```
1. Orchestrator démarre
   ↓
2. Appel initEmailService()
   - Charge config depuis .env
   - Valide config SMTP (fail-fast si manquante)
   - Crée MailSenderService
   - Vérifie connexion SMTP
   ↓
3. Email entrant traité par LLM
   ↓
4. Appel sendEmail(to, subject, body)
   - Initialise service si pas déjà fait
   - Envoie via SMTP
   - Retourne {success, error}
   ↓
5. Orchestrator continue
```

### Gestion des erreurs

**Principe** : Ne JAMAIS crasher l'orchestrator

**Erreurs au démarrage (fail-fast)** :
- Config SMTP manquante → Throw error
- Connexion SMTP échoue → Throw error

**Erreurs à l'envoi (récupérables)** :
- Timeout SMTP → Retourne `{success: false, error: "Timeout"}`
- Auth error → Retourne `{success: false, error: "Authentication failed"}`
- Connection refused → Retourne `{success: false, error: "Connection refused"}`
- Invalid recipient → Retourne `{success: false, error: "Invalid recipient"}`

**Pattern** :
```javascript
const result = await sendEmail(to, subject, body);
if (!result.success) {
  logger.error(`Failed to send email: ${result.error}`);
  // Gérer l'erreur sans crasher
}
```

## Configuration

### Variables d'environnement

**Requises** :
- `SMTP_HOST` : Serveur SMTP (ex: smtp.mail.ovh.net)
- `SMTP_PORT` : Port SMTP (587 STARTTLS, 465 SSL)
- `SMTP_SECURE` : `true` pour SSL (port 465), `false` pour STARTTLS (port 587)
- `SMTP_USER` : Username SMTP
- `SMTP_PASSWORD` : Password SMTP
- `SMTP_FROM_EMAIL` : Email expéditeur

**Optionnelles** :
- `SMTP_FROM_NAME` : Nom expéditeur (défaut: "AI Email Service")
- `SMTP_REJECT_UNAUTHORIZED` : Validation certificat SSL (défaut: `true`). Mettre à `false` pour les serveurs avec certificats auto-signés (Mailcow, etc.)
- `EMAIL_SEND_TIMEOUT_MS` : Timeout SMTP en ms (défaut: 30000)
- `LOG_LEVEL` : Niveau de log (défaut: info)

### Configuration OVH

**Setup recommandé** :
```bash
SMTP_HOST=smtp.mail.ovh.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@domain.com
SMTP_PASSWORD=your-password
SMTP_FROM_EMAIL=your-email@domain.com
SMTP_FROM_NAME=AI Email Assistant
```

**Alternative (STARTTLS)** :
```bash
SMTP_PORT=587
SMTP_SECURE=false
```

## API Publique

### initEmailService()

Initialise le service d'envoi d'emails.

**Usage** :
```javascript
import { initEmailService } from './email-send/src/index.js';

try {
  await initEmailService();
  console.log('Email service ready');
} catch (error) {
  console.error('Failed to init:', error.message);
  process.exit(1);
}
```

**Comportement** :
- Charge config depuis .env
- Valide config (throw si manquante)
- Crée client SMTP
- Vérifie connexion (throw si échec)
- Retourne instance MailSenderService

**Erreurs** :
- Throw si config manquante
- Throw si connexion SMTP échoue

### sendEmail(to, subject, body)

Envoie un email.

**Paramètres** :
- `to` (string) : Email destinataire
- `subject` (string) : Sujet de l'email
- `body` (string) : Corps de l'email (texte brut)

**Retour** :
```javascript
{
  success: boolean,
  error: string | null
}
```

**Usage** :
```javascript
import { sendEmail } from './email-send/src/index.js';

const result = await sendEmail(
  'user@example.com',
  'Re: Your request',
  'Here is the AI response to your question...'
);

if (result.success) {
  console.log('Email sent!');
} else {
  console.error('Send failed:', result.error);
}
```

**Comportement** :
- Initialise service si pas déjà fait
- Envoie email via SMTP
- Retourne résultat (ne throw jamais)

### closeEmailService()

Ferme proprement le service.

**Usage** :
```javascript
import { closeEmailService } from './email-send/src/index.js';

process.on('SIGTERM', () => {
  closeEmailService();
  process.exit(0);
});
```

## Patterns de code

### Logger

```javascript
import logger from './utils/logger.js';

logger.info('[EMAIL-SEND] Message');
logger.error('[EMAIL-SEND] Error:', error.message);
logger.debug('[EMAIL-SEND] Debug info');  // Uniquement si LOG_LEVEL=debug
logger.warn('[EMAIL-SEND] Warning');
```

### Gestion d'erreur

```javascript
// Dans sendEmail() - Ne jamais throw
try {
  // Envoi SMTP
  await transporter.sendMail(mailOptions);
  return { success: true, error: null };
} catch (error) {
  logger.error('[EMAIL-SEND] Send failed:', error.message);
  return { success: false, error: error.message };
}
```

### Validation config

```javascript
function validateSmtpConfig(config) {
  const required = ['host', 'port', 'user', 'password', 'from'];
  const missing = required.filter(key => !config.smtp[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required SMTP config: ${missing.join(', ')}`);
  }
}
```

## Testing

### Test local (sans Docker)

```bash
# 1. Configuration
cd email-send
cp ../.env.example ../.env
nano ../.env  # Configurer SMTP

# 2. Test script
node -e "
import('./src/index.js').then(async ({ initEmailService, sendEmail }) => {
  await initEmailService();
  const result = await sendEmail('test@example.com', 'Test', 'Test body');
  console.log(result);
});
"
```

### Test dans Docker

```bash
# 1. Configurer SMTP dans .env
nano .env

# 2. Rebuild
docker compose build orchestrator

# 3. Démarrer
docker compose up -d

# 4. Observer logs
docker compose logs orchestrator | grep EMAIL-SEND
```

## Dépannage

### Config invalide

**Erreur** :
```
Missing required SMTP config: host, port, user, password, from
```

**Solution** :
1. Vérifier `.env` contient toutes les variables SMTP
2. Vérifier syntaxe (pas de guillemets inutiles)
3. Vérifier que `.env` est bien chargé par l'orchestrator

### Connexion SMTP échoue

**Erreur** :
```
SMTP connection failed - check credentials
```

**Diagnostic** :
```bash
# Test connexion SMTP
telnet smtp.mail.ovh.net 465

# Vérifier DNS
nslookup smtp.mail.ovh.net

# Tester avec curl
curl -v --ssl smtp://smtp.mail.ovh.net:465
```

**Solutions courantes** :
- Vérifier credentials (SMTP_USER, SMTP_PASSWORD)
- Vérifier port (465 SSL, 587 STARTTLS)
- Vérifier `SMTP_SECURE` correspondant au port
- Vérifier firewall n'est pas bloqué

### Email non envoyé

**Diagnostic** :
1. Vérifier logs : `success: true` ou `success: false` ?
2. Si `success: true` mais non reçu :
   - Vérifier spam/indésirables
   - Vérifier adresse destinataire valide
   - Vérifier quota SMTP OVH
3. Si `success: false` :
   - Lire `error` pour diagnostic
   - Augmenter `LOG_LEVEL=debug` pour plus de détails

### Erreurs SMTP courantes

**535 Authentication failed** :
- Credentials incorrects
- Solution : Vérifier SMTP_USER et SMTP_PASSWORD

**Connection timeout** :
- Serveur inaccessible
- Solution : Vérifier SMTP_HOST, firewall, DNS

**Connection refused** :
- Port fermé/bloqué
- Solution : Vérifier SMTP_PORT, firewall

**Certificate error** :
- Problème SSL/TLS
- Solution : Vérifier `SMTP_SECURE` correspond au port

## Conventions de code

- **Modules ES6** : Toujours `.js` dans imports
- **Async/await** : Pas de callbacks
- **Erreurs** : Try/catch, retourner `{success, error}` au lieu de throw
- **Logs** : Préfixe `[EMAIL-SEND]`, timestamps ISO
- **Singleton** : Une seule instance de MailSenderService

## Sécurité

**Ne JAMAIS committer** :
- `.env` (contient SMTP_PASSWORD)
- Credentials SMTP en clair
- Logs contenant passwords

**Validation** :
- Vérifier `.env` dans `.gitignore`
- Ne jamais logger SMTP_PASSWORD
- Utiliser SMTP_SECURE=true quand possible

## Ressources

- **nodemailer docs** : https://nodemailer.com/
- **Project CLAUDE.md** : Voir `/CLAUDE.md` racine
- **README.md** : Documentation utilisateur

## Workflow de développement

1. **Développer** dans `/home/ubuntu/dev/projectname/email-send/`
2. **Tester** localement si besoin
3. **Commit** dans Git
4. **Déployer** via `./deploy.sh` depuis racine
5. **Vérifier** logs en production

Ne JAMAIS éditer directement dans `/home/ubuntu/stacks/` !
