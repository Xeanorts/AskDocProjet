# Configuration du Prompt LLM

> **Note** : Cette documentation a ete deplacee.

Voir la documentation complete dans :
- **[traitement-ia/config/README.md](../traitement-ia/config/README.md)** : Configuration des prompts

## Resume rapide

Le systeme utilise deux fichiers de configuration :

| Fichier | Utilisation |
|---------|-------------|
| `traitement-ia/config/llm.json` | Emails sans PDF |
| `traitement-ia/config/llm-pdf.json` | Emails avec PDF |

### Installation

```bash
cd traitement-ia/config/
cp llm.json.example llm.json
cp llm-pdf.json.example llm-pdf.json
```

### Selection du modele

Ajoutez un tag dans le sujet de l'email :

| Tag | Modele |
|-----|--------|
| _(aucun)_ | mistral-small (defaut) |
| `(pro)` | mistral-medium |
| `(max)` | mistral-large |

---

Pour plus de details, consultez [traitement-ia/config/README.md](../traitement-ia/config/README.md).
