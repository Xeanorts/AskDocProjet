# Sécurité - Module Traitement IA

## 🔐 Protection de la clé API OpenAI

### Fichiers sensibles EXCLUS de Git

Les fichiers suivants contiennent des données sensibles et sont **automatiquement exclus** par `.gitignore` :

```
✅ .env                          (variables d'environnement)
✅ config/ia-config.json         (configuration IA)
✅ storage/                      (données des emails)
✅ logs/                         (peut contenir des informations sensibles)
```

### Vérification avant commit

**TOUJOURS vérifier** qu'aucun fichier sensible n'est tracké :

```bash
# Vérifier le statut
git status

# S'assurer que ces fichiers n'apparaissent PAS
# - .env
# - ia-config.json
# - storage/
# - logs/

# Vérifier le dernier commit
git show HEAD | grep -i "sk-"  # Ne doit rien retourner
```

### Configuration de la clé API

**❌ JAMAIS faire ceci** :

```javascript
// ❌ Hardcoder la clé dans le code
const apiKey = "sk-abcd1234...";

// ❌ Commiter un .env avec une vraie clé
git add .env  # INTERDIT !
```

**✅ TOUJOURS faire ceci** :

```javascript
// ✅ Lire depuis une variable d'environnement
const apiKey = process.env.OPENAI_API_KEY;
```

```bash
# ✅ Configurer via variable d'environnement système
export OPENAI_API_KEY="sk-..."

# ✅ Ou via docker-compose (variable d'environnement hôte)
OPENAI_API_KEY=sk-... docker compose up
```

## 🚫 Protection dans les logs

### Code sécurisé implémenté

Le code **ne logue JAMAIS** :
- ✅ La clé API OpenAI
- ✅ L'objet client OpenAI complet
- ✅ L'objet configuration complet (seulement valeurs individuelles safe)

**Exemple de log sécurisé** (implémenté) :

```javascript
// ✅ Bon - Log seulement des valeurs safe
logger.info(`AI Model: ${iaConfig.model}`);
logger.info(`Temperature: ${iaConfig.temperature}`);

// ❌ Mauvais - Ne JAMAIS faire ceci
logger.info('Config:', iaConfig);  // Pourrait contenir des secrets
logger.info('Client:', this.client);  // Contient la clé API
```

### Vérification des logs

Pour s'assurer qu'aucune clé n'apparaît dans les logs :

```bash
# Vérifier les logs du container
docker compose logs | grep -i "sk-"  # Ne doit rien retourner

# Vérifier le code source
grep -r "logger.*this\\.client" module-traitement-ia/src/  # Ne doit rien retourner
```

## 🔒 Bonnes pratiques

### 1. Variables d'environnement

```bash
# .env (JAMAIS commité)
OPENAI_API_KEY=sk-proj-...
OPENAI_TIMEOUT_MS=20000
```

### 2. docker-compose.yml

```yaml
environment:
  # ✅ Lecture depuis variable d'environnement hôte
  - OPENAI_API_KEY=${OPENAI_API_KEY:-}

  # ❌ Ne JAMAIS hardcoder
  # - OPENAI_API_KEY=sk-...  # INTERDIT !
```

### 3. Rotation des clés

Si une clé API est compromise :

1. **Révoquer immédiatement** sur platform.openai.com
2. **Générer une nouvelle clé**
3. **Mettre à jour** les variables d'environnement
4. **Redémarrer** le service

```bash
# Mettre à jour la clé
export OPENAI_API_KEY="sk-nouvelle-cle..."

# Redémarrer
docker compose restart
```

### 4. Accès restreint

- ✅ Limiter les permissions sur `.env` : `chmod 600 .env`
- ✅ Ne pas partager `.env` par email/chat
- ✅ Utiliser des secrets managers en production (AWS Secrets, HashiCorp Vault, etc.)

## 🔍 Audit de sécurité

### Checklist avant déploiement

- [ ] Vérifier `.gitignore` contient bien `.env` et `ia-config.json`
- [ ] Vérifier `git status` ne montre aucun fichier sensible
- [ ] Vérifier le dernier commit : `git show HEAD | grep -i "sk-"`
- [ ] Vérifier les logs ne contiennent pas de clés
- [ ] Vérifier permissions fichiers : `ls -la .env`

### Commandes de vérification

```bash
# Vérifier .gitignore
cat .gitignore | grep -E "(\.env|ia-config\.json)"

# Vérifier qu'aucun fichier sensible n'est tracké
git ls-files | grep -E "(\.env$|ia-config\.json$)" | grep -v ".example"

# Vérifier l'historique Git
git log --all --full-history --source -- '*.env'

# Vérifier qu'aucune clé n'est hardcodée
grep -r "sk-" --include="*.js" module-traitement-ia/src/
```

## 📋 En cas de fuite de clé

**Si une clé API a été accidentellement commitée** :

1. **NE PAS simplement supprimer le commit** (l'historique Git garde tout)
2. **Révoquer la clé immédiatement** sur platform.openai.com
3. **Générer une nouvelle clé**
4. **Nettoyer l'historique Git** (complexe, consulter un expert)
5. **Force push** (⚠️ dangereux, coordonner avec l'équipe)

```bash
# Si la clé est dans le dernier commit
git reset --soft HEAD~1  # Annuler le commit
git reset .env  # Désindexer le fichier
# Créer un nouveau commit sans le fichier sensible
```

## 🛡️ Recommandations supplémentaires

### Développement

- Utiliser des clés API différentes pour dev/staging/prod
- Limiter les quotas des clés de développement
- Monitorer l'utilisation de l'API sur platform.openai.com

### Production

- Utiliser un secret manager (AWS Secrets Manager, etc.)
- Activer l'authentification 2FA sur OpenAI
- Configurer des alertes de dépenses
- Restreindre l'IP si possible

### Monitoring

```bash
# Surveiller les coûts
# → platform.openai.com/usage

# Surveiller les erreurs d'authentification
docker compose logs | grep "authentication failed"

# Vérifier la rotation régulière
# → Remplacer la clé tous les 90 jours
```

## 📚 Ressources

- [OpenAI API Keys Best Practices](https://platform.openai.com/docs/guides/production-best-practices/api-keys)
- [Git Secrets](https://github.com/awslabs/git-secrets) - Outil pour détecter les secrets dans Git
- [gitleaks](https://github.com/gitleaks/gitleaks) - Scanner de secrets dans Git

---

**⚠️ IMPORTANT** : La sécurité de la clé API est critique. Une fuite peut entraîner :
- Coûts élevés (usage frauduleux)
- Dépassement de quotas
- Compromission des données

**En cas de doute, révoquer et régénérer la clé immédiatement.**
