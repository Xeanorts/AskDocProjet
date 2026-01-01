# Guide Utilisateur - Assistant IA PDF

## Qu'est-ce que l'Assistant IA ?

L'Assistant IA est un service qui repond a vos questions sur des documents PDF par email. Envoyez-lui un email avec vos PDFs et vos questions, il analysera les documents et vous repondra directement.

## Comment utiliser l'Assistant IA

### 1. Preparer votre email

- **Destinataire** : Envoyer a l'adresse email configuree
- **Sujet** : Libre (sera repris dans la reponse avec "Re:")
- **Corps du message** : Ecrivez votre ou vos questions
- **Pieces jointes** : Attachez un ou plusieurs fichiers PDF

### 2. Poser vos questions

Ecrivez vos questions de maniere claire dans le corps de l'email. Vous pouvez poser plusieurs questions dans le meme email.

**Exemples de questions :**
- Quelle est la date de fin du contrat ?
- Quelles sont les conditions de resiliation ?
- Quel est le montant total mentionne dans le document ?

### 3. Recevoir la reponse

L'Assistant IA vous repondra par email avec :
- La reponse a chaque question, avec reference au document
- Les PDFs que vous avez envoyes (pour garder le contexte)
- Une signature "Cordialement, Votre Assistant IA"

## Regles importantes

### Ce que l'Assistant IA fait

- Repond UNIQUEMENT a partir des informations presentes dans vos PDFs
- Argumente ses reponses en citant le document
- Traite chaque question separement
- Vous dit clairement s'il n'a pas trouve l'information

### Ce que l'Assistant IA ne fait PAS

- N'invente jamais de reponses
- N'utilise pas de connaissances externes
- Ne devine pas si l'information n'est pas dans le document

## Limites techniques

| Element | Limite |
|---------|--------|
| Taille max par PDF | 20 Mo |
| Taille totale max | 20 Mo |
| Nombre max de PDFs | 10 par email |
| Delai de reponse | Quelques minutes (selon la taille des documents) |

## Exemple complet

### Email envoye

```
De: vous@example.com
A: assistant@votre-domaine.com
Sujet: Question sur le contrat de prestation

Bonjour,

J'ai deux questions concernant le contrat en piece jointe :

1. Quelle est la duree du contrat ?
2. Quelles sont les modalites de paiement ?

Merci d'avance.

[Piece jointe: contrat-prestation-2025.pdf]
```

### Reponse recue

```
De: assistant@votre-domaine.com
A: vous@example.com
Sujet: Re: Question sur le contrat de prestation

Sur la duree du contrat : Selon le document, le contrat est conclu
pour une duree de 12 mois a compter de sa date de signature.
L'article 3 precise que "le present contrat prend effet a la date
de signature et se termine 12 mois plus tard".

Sur les modalites de paiement : D'apres les informations fournies
dans le document, le paiement s'effectue en trois echeances.
L'article 7 indique que "30% sont dus a la signature, 40% a
mi-parcours, et 30% a la livraison finale".

Cordialement,
Votre Assistant IA

[Piece jointe: contrat-prestation-2025.pdf]
```

## Questions frequentes

### Mon email n'a pas recu de reponse ?

Verifiez que :
- Votre adresse email est autorisee (whitelist)
- Votre PDF fait moins de 20 Mo
- Vous avez bien joint un fichier PDF

### La reponse ne correspond pas a ma question ?

Essayez de :
- Reformuler votre question plus clairement
- Poser une question a la fois
- Verifier que l'information est bien dans le PDF

### Puis-je envoyer plusieurs PDFs ?

Oui, jusqu'a 10 PDFs par email. L'Assistant IA analysera tous les documents pour repondre a vos questions. Precisez dans votre question quel document vous interesse si besoin.

### Le meme PDF est-il re-analyse a chaque fois ?

Non, l'Assistant IA utilise un cache intelligent. Si vous envoyez le meme document plusieurs fois, il n'est pas re-analyse, ce qui accelere la reponse.

## Support

En cas de probleme technique, contactez l'administrateur du service.
