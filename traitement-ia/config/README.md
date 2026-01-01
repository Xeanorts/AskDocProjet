# Configuration du Module Traitement IA

Ce dossier contient la configuration du comportement de l'IA.

## Structure des fichiers

```
traitement-ia/config/
├── llm.json.example      # Template emails SANS PDF (versionne)
├── llm.json              # Config active texte (gitignore)
├── llm-pdf.json.example  # Template emails AVEC PDF (versionne)
├── llm-pdf.json          # Config active PDF (gitignore)
├── README.md             # Cette documentation
└── prompts/              # Archives locales (gitignore)
```

## Installation

```bash
cp llm.json.example llm.json
cp llm-pdf.json.example llm-pdf.json
```

## Deux fichiers de configuration

| Fichier | Utilise pour | Description |
|---------|--------------|-------------|
| `llm.json` | Emails sans PDF | Reponses libres avec connaissances IA |
| `llm-pdf.json` | Emails avec PDF | Reponses basees uniquement sur le document |

## Format des fichiers

```json
{
  "model": "mistral-small-latest",
  "max_output_tokens": 4000,
  "system_prompt": "Tu es un assistant IA..."
}
```

| Champ | Type | Description |
|-------|------|-------------|
| `model` | string | Modele Mistral (ignore si tag dans sujet) |
| `max_output_tokens` | number | Nombre max de tokens en reponse |
| `system_prompt` | string | Instructions systeme pour l'IA |

## Selection dynamique du modele

L'utilisateur peut choisir le modele via un tag dans le sujet de l'email :

| Tag | Modele | Description |
|-----|--------|-------------|
| _(aucun)_ | mistral-small-latest | Rapide, economique (defaut) |
| `(pro)` | mistral-medium-latest | Equilibre qualite/cout |
| `(max)` | mistral-large-latest | Qualite maximale |

**Exemples :**
- `Question sur mon contrat` → mistral-small
- `Question importante (pro)` → mistral-medium
- `Analyse complexe (max)` → mistral-large

## Rechargement dynamique

Les fichiers sont **recharges automatiquement a chaque email traite**.

**Pas besoin de redemarrer le service !**

1. Modifiez le fichier `.json`
2. Sauvegardez
3. Le prochain email utilisera la nouvelle configuration

## Fallback

Si un fichier est absent ou invalide :
- Le service continue avec des valeurs par defaut
- Un warning est affiche dans les logs
- Valeurs par defaut : `mistral-small-latest`, 4000 tokens

## Archives de prompts (local)

Le dossier `prompts/` permet de sauvegarder les prompts qui donnent de bons resultats.

> Note : Ce dossier est gitignore, les archives sont locales a chaque installation.

### Archiver

```bash
cp llm.json prompts/prompt-mon-test-v1.json
```

### Restaurer

```bash
cp prompts/prompt-mon-test-v1.json llm.json
```

## Bonnes pratiques

1. **Echapper les guillemets** : Utilisez `\"` dans le JSON
2. **Sauts de ligne** : Utilisez `\n`
3. **Pas d'accents** : Evitez les accents pour compatibilite maximale
4. **Tester** : Envoyez un email de test apres modification

## Logs utiles

```bash
# Verifier le modele utilise
docker compose logs orchestrator | grep "Model:"

# Verifier le chargement de la config
docker compose logs orchestrator | grep "LLM"
```
