# Image Processing Service

> Ce fichier est la **source de vérité du projet**. Tout agent de code (Claude Code, etc.)
> doit le lire en entier avant d'écrire la moindre ligne, ainsi que :
> - `ENGINEERING_RULES.md` : les patterns d'architecture à respecter (Clean Architecture, DDD, SOLID) ;
> - `WORKFLOW.md` : le cycle d'exécution obligatoire pour chaque feature.

---

## 1. Objectif

Construire une API backend qui permet à des utilisateurs authentifiés de :

1. créer un compte et se connecter (JWT) ;
2. envoyer des images (upload) ;
3. appliquer des transformations (resize, crop, rotate, flip, mirror, watermark,
   conversion de format, compression, filtres grayscale/sepia) ;
4. récupérer une image (originale ou transformée) ;
5. lister ses images avec pagination.

Référence : projet "Image Processing Service" de roadmap.sh (backend).

## 2. Nature du projet : PROJET D'APPRENTISSAGE

Ce n'est pas un produit à livrer vite. **L'objectif principal est que le développeur
(Salut) comprenne chaque concept.** Conséquences pour l'agent :

- Expliquer le *pourquoi* de chaque choix avant (ou en même temps que) le code.
- Commentaires et documentation en **français**, noms de code en **anglais**.
- Pas de sur-ingénierie : ne rien ajouter qui ne soit pas demandé dans la phase en cours.
- Introduire la complexité **progressivement**, une phase à la fois.
- Si un choix a plusieurs options raisonnables, les présenter brièvement avec
  leurs compromis, recommander une option, puis attendre la validation.
- Avant de coder une feature : annoncer le plan (use cases, entités, value objects,
  fichiers touchés) et attendre la validation.

## 3. Stack technique

| Domaine | Choix |
|---|---|
| Langage | TypeScript, mode `strict`, ES Modules. **`any` interdit** |
| Runtime | Node.js (LTS) |
| Framework HTTP | Express (couche infrastructure uniquement) |
| Base de données | PostgreSQL, driver natif `pg` (pas d'ORM), derrière des interfaces de repository |
| Migrations | fichiers SQL numérotés, exécutés par un petit script maison |
| Validation | `zod`, à la frontière HTTP (voir `ENGINEERING_RULES.md`) |
| Erreurs | pattern `Result` / `Either` (pas de `throw` générique) |
| Auth | JWT + hachage de mot de passe (argon2 ou bcrypt) |
| Traitement d'image | `sharp`, derrière l'interface `IImageProcessor` |
| Upload HTTP | `multer` (ou équivalent) |
| Tests | Vitest + `supertest` : unitaires, intégration, E2E |
| Web (`apps/web`) | Angular 21 (standalone, signals, zoneless), Tailwind CSS v4, tests Vitest (jsdom) |
| Cache / files (phases 3-4) | Redis, BullMQ |
| Stockage objet (phase 5) | S3-compatible auto-hébergé (SeaweedFS ou Garage) via `@aws-sdk/client-s3` |

**Environnement** : développement 100 % local **sur macOS**. PostgreSQL tourne
localement sur le Mac (Docker Compose recommandé, via un `docker-compose.yml` fourni
dans le dépôt ; Homebrew accepté). Deux bases distinctes : `imageservice_dev` et
`imageservice_test` (les tests d'intégration et E2E n'utilisent jamais la base de dev).
Aucun service cloud payant. Ne jamais proposer de dépendance à un service cloud sans
me le demander.

## 4. Règles d'architecture (non négociables)

Le détail des patterns est dans `ENGINEERING_RULES.md`. Règles propres à ce projet :

1. **Dépendances dirigées vers le domaine** : `infrastructure` → `application` → `domain`.
   Jamais l'inverse. `src/domain/` n'importe ni Express, ni `pg`, ni `sharp`, ni `fs`.
2. **Abstraction du stockage de fichiers.** L'interface `IFileStorage`
   (`put`, `get`, `delete`, `exists`) est définie dans le domaine. Implémentation
   actuelle : `LocalFileStorage` (disque, dans `infrastructure/`). `S3FileStorage`
   viendra en phase 5. Aucune route ni use case n'utilise `fs` directement.
3. **Les clés de stockage sont des chaînes** (ex. `originals/<uuid>.jpg`), jamais des
   chemins absolus. Les noms de fichiers fournis par l'utilisateur ne sont jamais
   utilisés pour stocker.
4. **L'original est immuable.** Une transformation crée toujours un nouveau fichier dérivé.
5. **Un use case = une classe = une action métier**, qui renvoie un `Result`.
6. **API stateless** : aucun état utilisateur gardé en mémoire du process.
7. **Configuration par variables d'environnement** (`.env`, jamais commité),
   validées au démarrage avec zod. Fournir un `.env.example`.
8. **SQL paramétré uniquement** (`$1, $2`), jamais de concaténation de chaînes.

## 5. Règles de sécurité

- Vérifier le type réel d'un fichier par ses **magic bytes**, pas par l'extension
  ni le `Content-Type` envoyé par le client.
- Limiter le **poids** *et* les **dimensions** : `MAX_UPLOAD_BYTES` (défaut 10 Mo) et
  `MAX_IMAGE_PIXELS_SIDE` (défaut 8000 px par côté), configurables par variable
  d'environnement. Les dimensions sont lues via les métadonnées `sharp` avant tout
  décodage complet (protection contre les decompression bombs). La limite de pixels
  protège la RAM mieux que la limite de poids.
- Supprimer les métadonnées EXIF (GPS) des images dérivées.
- **Autorisation par propriétaire** : toute lecture/modification d'une image vérifie
  `owner_id`. Une image d'un autre utilisateur renvoie `404`, pas `403`.
- Ne jamais logger de mot de passe, de JWT ni de secret.
- Valider strictement les paramètres de transformation (bornes, valeurs autorisées).

## 6. Modèle de données (cible)

```
users   (id uuid PK, email unique, password_hash, created_at)
images  (id uuid PK, owner_id FK users, storage_key unique, original_id FK images NULL,
         format, size_bytes, width, height, created_at)
```

`original_id` est NULL pour un original et pointe vers l'original pour un dérivé.
Toute modification du schéma passe par une nouvelle migration.

## 7. Endpoints (cible finale)

```
POST /register
POST /login
POST /images                  upload d'une image
POST /images/:id/transform    applique des transformations, crée un dérivé
POST /images/:id/jobs         idem en asynchrone (202 + worker BullMQ), phase 4
GET  /jobs/:id                statut d'un job (polling), phase 4
GET  /images/:id/url          URL signée temporaire vers le stockage S3, phase 5
GET  /images/:id              renvoie le fichier
GET  /images?page=&limit=     liste paginée des images de l'utilisateur
```

Codes HTTP corrects (201 création, 400 validation, 401 non authentifié, 404 introuvable,
413 fichier trop gros, 415 format non supporté, 429 rate limit).

## 8. Phases (une seule à la fois)

| Phase | Contenu | Statut |
|---|---|---|
| 1 | Auth JWT, upload, `LocalFileStorage`, métadonnées Postgres, GET + liste paginée | Terminée |
| 2 | Transformations avec sharp, dérivés stockés | Terminée |
| 3 | Cache par clé de hash des paramètres + rate limiting (Redis) | Terminée |
| 4 | File d'attente (BullMQ), workers, statut de job (202 + polling) | Terminée |
| 5 | `S3FileStorage`, stockage objet auto-hébergé, URLs présignées | Terminée |
| 6 | Durcissement sécurité, tests de charge (k6/autocannon) | À faire |

**Règle : ne jamais implémenter une phase future, même partiellement.**
Seule la phase marquée "En cours" est autorisée.

### Découpage indicatif de la phase 1 (une feature = une branche)

| Feature | Use cases | Domaine |
|---|---|---|
| Socle du projet | (aucun) config, Result, erreurs, connexion DB, migrations | — |
| Inscription | `RegisterUser` | `User`, VO `Email`, `PasswordHash` |
| Connexion | `LoginUser` | idem + port `ITokenService` |
| Upload | `UploadImage` | `Image`, VO `ImageFormat`, `ImageDimensions`, `FileSize`, `StorageKey` |
| Lecture | `GetImage` | — |
| Liste paginée | `ListImages` | VO `Pagination` |

## 9. Structure des dossiers (cible)

Le dépôt est un **monorepo npm workspaces** : `apps/api` (backend, structure ci-dessous),
`apps/web` (application Angular + Tailwind CSS pour consommer l'API), infra partagée à la
racine (`docker-compose.yml`, `docker/`, `postman/`). Les commandes se lancent depuis la racine.

```
apps/api/
  src/
    domain/
      entities/            User, Image
      value-objects/       Email, ImageFormat, ImageDimensions, ...
      repositories/        IUserRepository, IImageRepository
      ports/               IFileStorage, IImageProcessor, ITokenService, IPasswordHasher
      errors/              erreurs métier typées
    application/
      use-cases/           un fichier par cas d'usage
      shared/              Result / Either
    infrastructure/
      http/                Express : routes, middlewares, schémas zod, mapping Result → HTTP
      persistence/         implémentations pg des repositories + migrations runner
      storage/             LocalFileStorage (puis S3FileStorage)
      image/               SharpImageProcessor
      security/            JWT, hachage
      config/              lecture + validation des variables d'environnement
    main.ts                composition root (assemblage des dépendances)
  db/migrations/           001_init.sql, 002_...
  tests/
    unit/                  domaine + use cases (avec fakes en mémoire)
    integration/           repositories contre PostgreSQL de test, storage sur disque temporaire
    e2e/                   requêtes HTTP complètes (supertest)
  storage/                 fichiers locaux (ignoré par git)
```

## 10. Conventions de code

- `async/await`, jamais de callbacks imbriqués.
- Petites fonctions, un seul rôle chacune.
- Pas de `any`, pas de `@ts-ignore` sans justification écrite.
- **Docstrings TSDoc obligatoires** (en français) : un en-tête dans chaque fichier et une
  docstring sur chaque élément exporté. Règles et exemples dans `ENGINEERING_RULES.md` (règle 6).
- Messages de commit : voir `WORKFLOW.md`.

## 11. Définition de "terminé" pour une feature

Voir `WORKFLOW.md`. En résumé : tests unitaires + intégration + E2E verts, règles
d'architecture respectées, documentation à jour, commit sur sa propre branche.
En fin de phase, un résumé des **concepts appris** est ajouté à `LEARNINGS.md`.

## 12. Hors périmètre (pour l'instant)

Déploiement cloud, paiement, OAuth/social login, import d'image par URL
(risque SSRF), traitement vidéo, IA/ML sur les images.

> Exception actée après la phase 1 : une **petite application web Angular** (`apps/web`,
> Tailwind CSS) pour consommer l'API, hors des phases numérotées. Elle reste simple :
> connexion/inscription, upload, galerie, visualisation. Aucun autre frontend.
