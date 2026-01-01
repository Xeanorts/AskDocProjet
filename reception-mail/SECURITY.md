# 🔒 Guide de Sécurité

Ce document explique les bonnes pratiques de sécurité pour le module Project Name Réception.

## ⚠️ Fichiers sensibles à NE JAMAIS commiter

### 1. Fichier .env (CRITIQUE)

Le fichier `.env` contient vos mots de passe et credentials :

```bash
# ❌ JAMAIS DANS GIT
IMAP_PASSWORD=votre-mot-de-passe
DB_PASSWORD=mot-de-passe-db
API_JWT_SECRET=secret-key
```

**Vérification** :
```bash
# S'assurer que .env est bien ignoré
git check-ignore .env
# Devrait afficher : .env

# Si déjà commité par erreur :
git rm --cached .env
git commit -m "Remove .env from git"
```

### 2. Emails stockés (storage/)

Les emails contiennent des données personnelles et sensibles :
- Adresses email
- Contenus privés
- Pièces jointes

**Protection** :
```bash
# Vérifier que storage/ est ignoré
git check-ignore storage/emails/
# Devrait afficher : storage/emails/
```

### 3. Certificats SSL/TLS

Les certificats et clés privées ne doivent JAMAIS être versionnés :
```bash
# ❌ JAMAIS DANS GIT
*.key
*.pem
*.crt
```

### 4. Logs

Les logs peuvent contenir des informations sensibles :
```bash
# ❌ JAMAIS DANS GIT
logs/
*.log
```

## ✅ Vérification de sécurité

### Avant le premier commit

```bash
# 1. Vérifier qu'aucun fichier sensible n'est tracké
git status

# 2. Vérifier le .gitignore
cat .gitignore

# 3. Vérifier les fichiers qui seraient commités
git add -n .

# 4. Si tout est OK, commiter
git add .
git commit -m "Initial commit"
```

### Si vous avez déjà commité des fichiers sensibles

```bash
# ⚠️ URGENCE : Supprimer un fichier sensible de l'historique Git

# Option 1 : Supprimer de l'index seulement (recommandé)
git rm --cached .env
git commit -m "Remove .env from git"

# Option 2 : Supprimer de tout l'historique (avancé)
# ⚠️ Réécrit l'historique Git, à faire avec précaution
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Puis force push (si déjà poussé sur un remote)
git push origin --force --all
```

### Audit de sécurité régulier

```bash
# Vérifier qu'aucun secret n'est dans git
git log --all --full-history --source -- '.env'

# Chercher des mots de passe potentiels
git grep -i "password"
git grep -i "secret"
git grep -i "api_key"
```

## 🔐 Bonnes pratiques

### 1. Mots de passe

- ✅ Utiliser des mots de passe forts (20+ caractères)
- ✅ Mots de passe différents pour chaque service
- ✅ Utiliser un gestionnaire de mots de passe
- ✅ Mot de passe d'application dédié pour IMAP si possible

### 2. Fichier .env

```bash
# Créer .env depuis le template
cp .env.example .env

# Restreindre les permissions
chmod 600 .env

# Vérifier
ls -la .env
# Devrait afficher : -rw------- (lecture/écriture pour vous uniquement)
```

### 3. Déploiement

Lors du déploiement en production :

```bash
# Ne PAS copier .env avec les fichiers
# Le script deploy.sh le gère automatiquement

# Configurer .env directement sur le serveur de production
cd /home/ubuntu/stacks/projectname
nano .env

# Restreindre les permissions
chmod 600 .env
```

### 4. Backups

```bash
# Si vous backupez le projet, exclure les données sensibles
tar -czf backup.tar.gz \
  --exclude='.env' \
  --exclude='storage' \
  --exclude='logs' \
  --exclude='node_modules' \
  .
```

### 5. Variables d'environnement

En production, considérez d'utiliser des variables d'environnement système plutôt que .env :

```bash
# Dans /etc/environment ou ~/.bashrc
export IMAP_PASSWORD="mot-de-passe"

# Ou avec Docker secrets
docker secret create imap_password -
```

## 🚨 En cas de fuite de credentials

### 1. Mot de passe IMAP compromis

```bash
# 1. Changer IMMÉDIATEMENT le mot de passe dans Zimbra
# 2. Mettre à jour .env avec le nouveau mot de passe
# 3. Redémarrer le service
docker compose restart
```

### 2. Fichier .env commité sur GitHub

```bash
# 1. Supprimer le fichier de l'historique (voir plus haut)
# 2. Changer TOUS les mots de passe contenus dans le fichier
# 3. Force push pour écraser l'historique
# 4. Notifier GitHub si le repo est public
```

### 3. Emails compromis

```bash
# 1. Supprimer les emails du dépôt
git rm -rf storage/
git commit -m "Remove sensitive emails"

# 2. Si déjà pushé, force push
git push origin --force

# 3. Vérifier les backups
```

## 📋 Checklist de sécurité

### Avant chaque commit

- [ ] .env n'est pas dans `git status`
- [ ] storage/ n'est pas dans `git status`
- [ ] logs/ n'est pas dans `git status`
- [ ] Aucun mot de passe en clair dans le code
- [ ] Aucun certificat SSL dans `git status`

### Après chaque déploiement

- [ ] Permissions .env : `600`
- [ ] Mot de passe fort configuré
- [ ] Logs ne contiennent pas de mots de passe
- [ ] Backup des emails sécurisé

### Mensuel

- [ ] Audit des fichiers Git
- [ ] Vérification des permissions
- [ ] Rotation des mots de passe
- [ ] Vérification des logs d'accès

## 🔍 Outils utiles

### Détection de secrets

```bash
# Installer git-secrets (optionnel)
git clone https://github.com/awslabs/git-secrets
cd git-secrets
make install

# Configurer dans votre repo
cd /path/to/reception-mail
git secrets --install
git secrets --register-aws
```

### Scan de sécurité

```bash
# Scanner les secrets dans le code (npm)
npx secretlint "**/*"

# Ou avec truffleHog
docker run --rm -v $(pwd):/proj trufflesecurity/trufflehog filesystem /proj
```

## 📚 Ressources

- [GitHub: Removing sensitive data](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/removing-sensitive-data-from-a-repository)
- [OWASP: Password Storage Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [12 Factor App: Config](https://12factor.net/config)

---

⚠️ **En cas de doute, demandez de l'aide avant de commiter des fichiers potentiellement sensibles.**
