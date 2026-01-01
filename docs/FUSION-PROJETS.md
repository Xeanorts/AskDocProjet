# Fusion des Projets - Actions à réaliser

## 1. Setup Git

```bash
# Créer la branche develop
git checkout main
git checkout -b develop
git push -u origin develop
```

---

## 2. Ajouter la sélection du modèle via le titre de l'email

**Fichier à modifier** : `traitement-ia/src/services/mistral-service.ts`

**Ajouter cette fonction** :
```typescript
resolveModelForEmail(subject: string, config: LLMConfig): string {
  const s = (subject || '').toLowerCase();

  if (s.includes('(low)')) return 'mistral-small-latest';
  if (s.includes('(medium)')) return 'mistral-medium-latest';
  if (s.includes('(high)')) return 'mistral-large-latest';

  return config.model || 'mistral-small-latest';
}
```

**Usage pour l'utilisateur** :
| Tag dans le sujet | Niveau | Modèle utilisé |
|-------------------|--------|----------------|
| `(low)` | Rapide, économique | mistral-small |
| `(medium)` | Équilibré | mistral-medium |
| `(high)` | Qualité maximale | mistral-large |
| Aucun | Par défaut | config |

**Appeler cette fonction** dans `processDocumentQA()` et `processTextOnly()` pour résoudre le modèle avant l'appel API.

**Référence** : `Projet-Email/traitement-ia/src/services/openai-service.js` lignes 37-52

---

## 3. Créer CLAUDE.md avec instructions Git

Créer `/CLAUDE.md` à la racine avec les instructions ci-dessous.

---

## 4. Archiver les anciens repos

Sur GitHub (`Settings` → `General` → `Danger Zone` → `Archive this repository`) :
- [ ] `Xeanorts/QnAMailPDF`
- [ ] `Xeanorts/Projet-Email`

---

## 5. Documenter

- [ ] Ajouter la doc de sélection modèle dans `traitement-ia/CLAUDE.md`
- [ ] Mettre à jour `README.md` si nécessaire

---

# Instructions Git pour Claude Code (à mettre dans CLAUDE.md)

## Workflow Git - 2 branches

```
main     ← Production (serveur prod)
develop  ← Développement/Test (local)
```

## Règles de commit et push

### Sur branche `develop` (par défaut)

Développement normal, features, corrections :

```bash
git add .
git commit -m "feat: description"
git push origin develop
```

### Passer en production

Quand le code sur `develop` est prêt pour la prod :

```bash
git checkout main
git merge develop
git push origin main
git checkout develop
```

### Hotfix urgent (prod uniquement)

Correction critique qui doit aller direct en prod :

```bash
git checkout main
git commit -m "fix: correction urgente"
git push origin main

# Reporter le fix sur develop
git checkout develop
git merge main
git push origin develop
```

## Déploiement

### Serveur de dev/test (local)

```bash
./deploy.sh
# Déploie vers /home/ubuntu/stacks/projectname/
```

### Serveur de production (distant)

```bash
# Sur le serveur prod
cd /chemin/vers/projectname
git pull origin main
docker compose build
docker compose up -d
```

## Vérifications avant push

```bash
# Vérifier la branche courante
git branch --show-current

# Vérifier les changements
git status
git diff
```

## Conventions de commit

- `feat:` nouvelle fonctionnalité
- `fix:` correction de bug
- `docs:` documentation
- `refactor:` refactoring sans changement fonctionnel
- `test:` ajout/modification de tests
