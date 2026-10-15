# Workflow d'exécution

Ce workflow est **obligatoire** pour chaque feature. Une feature = une branche =
un cycle complet. L'agent ne saute aucune étape.

## Vue d'ensemble

```
        ┌───────────────────────────────┐
        │ 0. Branche + plan validé      │
        └───────────────┬───────────────┘
                        ▼
        ┌───────────────────────────────┐
        │ 1. Implémenter (patterns de   │
        │    ENGINEERING_RULES.md)      │
        └───────────────┬───────────────┘
                        ▼
        ┌───────────────────────────────┐
  ┌────▶│ 2. Tester : unit, integration,│
  │     │    E2E                        │
  │     └───────┬───────────────┬───────┘
  │         tout vert        au moins un rouge
  │             ▼               ▼
  │   ┌──────────────────┐ ┌───────────────────┐
  │   │ 3. Documenter    │ │ 4. Déboguer       │
  │   │    puis committer│ │    (corriger)     │
  │   └────────┬─────────┘ └─────────┬─────────┘
  │            ▼                     │
  │      Feature terminée            │
  └──────────────────────────────────┘
```

## Étape 0 : préparation

1. Se placer sur `main` à jour, puis créer **une branche dédiée** à la feature :
   `git switch -c feat/<phase>-<nom-court>` (ex. `feat/p1-register-user`).
   Autres préfixes : `fix/`, `refactor/`, `docs/`, `chore/`.
2. Annoncer le plan : use case(s), entités, value objects, interfaces, fichiers touchés,
   tests prévus. **Attendre la validation du développeur** avant de coder.

## Étape 1 : implémenter

- Suivre à la lettre `ENGINEERING_RULES.md` (domaine pur, inversion de dépendances,
  use cases + `Result`, validation zod aux frontières, TypeScript strict sans `any`).
- Rester dans le périmètre de la feature et de la phase en cours.
- Documenter **pendant** l'écriture : en-tête de fichier + docstring TSDoc (en français)
  sur chaque élément exporté, comme décrit dans `ENGINEERING_RULES.md` (règle 6).
- Écrire les tests en même temps que le code (un use case sans test n'est pas fini).

## Étape 2 : tester (trois niveaux, tous obligatoires)

| Niveau | Ce qu'on teste | Comment |
|---|---|---|
| **Unitaire** | entités, value objects, use cases | fakes en mémoire pour les repositories et ports ; aucun réseau, aucune DB |
| **Intégration** | implémentations réelles : repositories `pg`, `LocalFileStorage`, `SharpImageProcessor` | base `imageservice_test`, dossier temporaire pour les fichiers |
| **E2E** | le parcours HTTP complet (route → use case → DB → storage) | `supertest` sur l'app complète, base de test |

Commandes attendues dans `package.json` : `test:unit`, `test:integration`,
`test:e2e`, et `test` qui lance les trois. Lancer **toute** la suite avant de conclure,
pas seulement les nouveaux tests. Vérifier aussi `tsc --noEmit` et le lint.
Contrôler enfin que **chaque fichier créé ou modifié a son en-tête et ses docstrings**
(le lint peut l'imposer avec `eslint-plugin-jsdoc`).

## Étape 3 : si tout est vert → documenter, puis committer

**Documenter** (avant le commit) :
- docstrings : vérifier qu'elles sont à jour avec le code final (pas seulement écrites
  au premier jet) ;
- `README.md` : endpoints, variables d'environnement, commandes si elles ont changé ;
- `CLAUDE.md` : mettre à jour le statut de la phase si nécessaire ;
- `LEARNINGS.md` : 3 à 5 lignes sur les concepts rencontrés dans la feature
  (ce que c'est, pourquoi, piège rencontré).

**Committer** :
- commits petits et atomiques, au format `type: description`
  (`feat`, `fix`, `docs`, `refactor`, `test`, `chore`) ;
- **sans signature** : aucun trailer `Co-Authored-By`, aucune mention
  "Generated with ...", aucune signature GPG (`--no-gpg-sign`). L'auteur est uniquement
  le développeur, selon sa configuration git locale ;
- ne jamais utiliser `--no-verify`.

## Étape 4 : si un test échoue → déboguer

1. **Reproduire** : s'assurer qu'un test échoue de façon fiable (en écrire un si besoin).
2. **Comprendre la cause racine** avant de modifier quoi que ce soit, et l'expliquer
   en quelques lignes au développeur.
3. **Corriger** la cause, pas le symptôme.
4. **Relancer toute la suite** (retour à l'étape 2).
5. Quand tout est vert : étape 3 (documenter, committer).
6. Si le même problème résiste après **3 tentatives**, s'arrêter, résumer ce qui a été
   essayé et demander de l'aide plutôt que de continuer à l'aveugle.

## Fin de feature

- La branche est propre, tests verts, documentation à jour, commits faits.
- **Fusion dans `main` : uniquement après validation du développeur.**
  Puis supprimer la branche de feature.

## Interdits

- Committer avec des tests rouges.
- Committer directement sur `main`.
- Mélanger deux features dans la même branche.
- Supprimer, désactiver ou affaiblir un test pour le faire passer.
- Utiliser `any`, `@ts-ignore` ou `--no-verify` pour contourner un problème.
- Implémenter des éléments d'une phase future.
