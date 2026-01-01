# 📬 Synchronisation IMAP avec Zimbra

Ce guide explique comment configurer la synchronisation automatique des emails depuis votre boîte mail Zimbra vers le serveur local.

## 🎯 Objectif

Récupérer automatiquement les emails de votre compte Zimbra (hébergé chez OVH par exemple) et les sauvegarder en fichiers JSON locaux pour que vos programmes puissent les traiter.

## ✨ Fonctionnement

- **Synchronisation périodique** : Le serveur se connecte à Zimbra toutes les 5 minutes (configurable)
- **Récupération des nouveaux emails** : Seuls les emails non lus sont synchronisés
- **Sauvegarde en JSON** : Même format que les emails reçus via SMTP
- **Marquage automatique** : Les emails synchronisés sont marqués comme lus dans Zimbra (optionnel)

## 📋 Prérequis

1. Un compte email Zimbra (OVH, auto-hébergé, etc.)
2. Accès IMAP activé sur votre compte
3. Vos identifiants de connexion

## 🔧 Configuration

### Étape 1 : Trouver vos paramètres IMAP Zimbra

#### Pour Zimbra sur OVH :

```
Serveur IMAP: ssl0.ovh.net (ou ssl1, ssl2, etc.)
Port: 993 (avec SSL/TLS)
```

#### Pour Zimbra auto-hébergé :

```
Serveur IMAP: imap.votredomaine.com
Port: 993 (avec SSL/TLS) ou 143 (sans SSL)
```

### Étape 2 : Configurer le fichier .env

Éditez le fichier `.env` et ajoutez/modifiez ces lignes :

```bash
# Activer la synchronisation IMAP
IMAP_ENABLED=true

# Paramètres de connexion Zimbra
IMAP_HOST=ssl0.ovh.net              # Votre serveur Zimbra
IMAP_PORT=993                       # Port IMAP SSL
IMAP_USER=votreemail@domain.com     # Votre adresse email complète
IMAP_PASSWORD=votre-mot-de-passe    # Votre mot de passe

# Boîte mail à synchroniser
IMAP_MAILBOX=INBOX                  # INBOX par défaut

# Intervalle de synchronisation (en millisecondes)
IMAP_SYNC_INTERVAL=300000           # 300000 = 5 minutes

# Marquer comme lu après synchronisation
IMAP_MARK_AS_READ=true              # true = marquer comme lu, false = garder non lu
```

### Étape 3 : Sauvegarder votre configuration

⚠️ **IMPORTANT** : Le fichier `.env` contient vos mots de passe !

- Ne JAMAIS commiter ce fichier dans git
- Vérifiez que `.env` est dans `.gitignore`
- Utilisez des mots de passe forts
- Envisagez un mot de passe application dédié si Zimbra le supporte

## 🚀 Démarrage

### Avec Docker :

```bash
# Démarrer le serveur avec IMAP sync
docker compose up -d

# Voir les logs de synchronisation
docker compose logs -f | grep IMAP
```

### Sans Docker :

```bash
# Installer les dépendances
npm install

# Démarrer le serveur
npm start
```

## 📊 Vérification

### 1. Vérifier que la synchronisation fonctionne

```bash
# Voir les logs
docker compose logs -f

# Vous devriez voir :
# 📬 Starting IMAP Sync Service...
# 🔄 Starting email sync...
# 📧 Found X new email(s)
# ✅ Synced email: Sujet de l'email
```

### 2. Vérifier les emails synchronisés

```bash
# Lister les emails reçus
ls -lh storage/emails/

# Afficher le contenu d'un email
cat storage/emails/20251104_*.json | jq
```

### 3. Tester l'envoi d'un email de test

1. Envoyez-vous un email depuis Gmail/Outlook vers votre adresse Zimbra
2. Attendez maximum 5 minutes
3. Vérifiez les logs et le dossier `storage/emails/`

## ⚙️ Configuration avancée

### Modifier l'intervalle de synchronisation

```bash
# Toutes les 1 minute (plus rapide)
IMAP_SYNC_INTERVAL=60000

# Toutes les 10 minutes (moins fréquent)
IMAP_SYNC_INTERVAL=600000

# Toutes les 30 minutes
IMAP_SYNC_INTERVAL=1800000
```

### Synchroniser plusieurs boîtes mail

Pour l'instant, le système ne synchronise qu'une seule boîte à la fois. Pour synchroniser plusieurs boîtes :

**Option 1** : Créer plusieurs instances du serveur avec des configurations différentes

**Option 2** : Modifier `IMAP_MAILBOX` pour synchroniser d'autres dossiers :
```bash
IMAP_MAILBOX=INBOX.Sent   # Dossier des messages envoyés
IMAP_MAILBOX=INBOX.Work   # Sous-dossier personnalisé
```

### Garder les emails non lus dans Zimbra

```bash
# Les emails restent non lus après synchronisation
IMAP_MARK_AS_READ=false
```

⚠️ **Attention** : Avec `IMAP_MARK_AS_READ=false`, les mêmes emails seront synchronisés à chaque cycle !

## 🔍 Dépannage

### La synchronisation ne démarre pas

1. Vérifier que `IMAP_ENABLED=true` dans `.env`
2. Vérifier les credentials (user, password, host)
3. Vérifier les logs d'erreur : `docker compose logs | grep ERROR`

### Erreur d'authentification

```
❌ IMAP connection error: Invalid credentials
```

**Solutions** :
- Vérifier que l'adresse email est complète : `user@domain.com`
- Vérifier le mot de passe
- Vérifier que l'accès IMAP est activé dans Zimbra
- Essayer avec un client mail (Thunderbird) pour valider les credentials

### Erreur de connexion

```
❌ IMAP connection error: getaddrinfo ENOTFOUND ssl0.ovh.net
```

**Solutions** :
- Vérifier le nom du serveur IMAP
- Vérifier la connectivité réseau
- Ping le serveur : `ping ssl0.ovh.net`

### Les emails ne sont pas synchronisés

1. Vérifier que les emails sont bien "non lus" dans Zimbra
2. Vérifier que vous êtes dans la boîte `INBOX`
3. Augmenter le niveau de log : `LOG_LEVEL=debug`
4. Vérifier les logs détaillés

### Erreur de certificat SSL

```
❌ Error: self signed certificate
```

**Solution** : Le code accepte déjà les certificats auto-signés (`rejectUnauthorized: false`). Si le problème persiste, vérifiez la configuration réseau.

## 📊 Format des emails synchronisés

Les emails synchronisés ont **exactement le même format** que ceux reçus via SMTP :

```json
{
  "id": "uuid",
  "from": { "address": "sender@example.com", "name": "Sender Name" },
  "to": [{ "address": "you@domain.com", "name": "Your Name" }],
  "subject": "Email subject",
  "date": "2025-11-04T12:00:00.000Z",
  "text": "Email body in plain text",
  "html": "<p>Email body in HTML</p>",
  "attachments": [
    {
      "filename": "document.pdf",
      "contentType": "application/pdf",
      "size": 12345,
      "content": "base64..."
    }
  ],
  "headers": { ... }
}
```

Vos programmes peuvent donc traiter indifféremment les emails reçus par SMTP ou synchronisés depuis IMAP.

## 🔐 Sécurité

### Bonnes pratiques

1. **Mot de passe dédié** : Créez un mot de passe d'application spécifique si Zimbra le supporte
2. **Permissions restreintes** : Le compte IMAP n'a besoin que d'accès en lecture
3. **Fichier .env sécurisé** : `chmod 600 .env` pour restreindre l'accès
4. **Surveillance** : Surveillez les logs pour détecter des accès anormaux

### En production

```bash
# Restreindre les permissions du fichier .env
chmod 600 .env

# S'assurer que .env n'est pas versionné
echo ".env" >> .gitignore
```

## 🆚 SMTP vs IMAP Sync

| Critère | SMTP (port 2525) | IMAP Sync (Zimbra) |
|---------|------------------|---------------------|
| **Latence** | Temps réel | 1-5 minutes (configurable) |
| **Source** | Emails envoyés directement au serveur | Emails de votre boîte Zimbra |
| **Configuration** | Pas de credentials nécessaires | Nécessite identifiants Zimbra |
| **Cas d'usage** | Tests, applications internes | Emails réels depuis Internet |

**Recommandation** : Utilisez IMAP Sync pour récupérer vos emails Zimbra existants.

## 📚 Ressources

- [RFC 3501 - IMAP Protocol](https://tools.ietf.org/html/rfc3501)
- [Documentation Zimbra IMAP](https://wiki.zimbra.com/wiki/IMAP)
- [node-imap Documentation](https://github.com/mscdex/node-imap)

## 🆘 Support

En cas de problème :
1. Activer les logs debug : `LOG_LEVEL=debug`
2. Vérifier les logs : `docker compose logs | grep IMAP`
3. Tester les credentials avec un client mail (Thunderbird, Apple Mail)
4. Consulter les issues du projet

---

✅ Avec cette configuration, tous vos emails Zimbra seront automatiquement disponibles en JSON pour vos programmes !
