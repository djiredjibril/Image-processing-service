# Image Processing Service

API backend d'apprentissage (Node.js, TypeScript, Express, PostgreSQL) et une petite
application web Angular (Tailwind CSS) pour la consommer. Voir `CLAUDE.md` (source de vérité),
`ENGINEERING_RULES.md` (architecture) et `WORKFLOW.md` (cycle de travail).

## Structure du monorepo (npm workspaces)

```
apps/api/        API Express (code, tests, migrations SQL, .env)
apps/web/        application Angular 21 + Tailwind CSS (consomme l'API)
docker-compose.yml, docker/   PostgreSQL local (infra partagée)
postman/         collection Postman
```

Toutes les commandes se lancent **depuis la racine** ; elles sont transmises aux workspaces.

## Prérequis

- Node.js >= 22 (testé avec 24)
- Docker (pour PostgreSQL local) — ou un PostgreSQL installé via Homebrew

## Installation

```bash
npm install                               # installe tous les workspaces
cp apps/api/.env.example apps/api/.env    # puis adapter (JWT_SECRET : au moins 32 caractères)
```

## Lancer PostgreSQL

```bash
docker compose up -d --wait
```

Crée deux bases : `imageservice_dev` et `imageservice_test`. Le port hôte est **5433**
(pour éviter un conflit avec un PostgreSQL déjà sur 5432). Le script
`docker/init-db.sql` ne s'exécute qu'à la première création du volume ; pour repartir
de zéro : `docker compose down -v`.

## Migrer, démarrer

```bash
npm run migrate   # applique apps/api/db/migrations/NNN_*.sql sur la base de dev
npm run dev:api   # API avec rechargement, http://localhost:3001
npm run dev:web   # application Angular, http://localhost:4200 (dans un second terminal)
```

## Application web (`apps/web`)

Angular 21 (composants standalone, signals, mode sans zone) + Tailwind CSS v4. Pages : connexion,
inscription, galerie paginée, envoi d'une image, visualisation. Elle appelle l'API sur
`http://localhost:3001` (voir `apps/web/src/app/core/api-config.ts`) ; l'API autorise l'origine
`http://localhost:4200` via `CORS_ORIGIN`. Le jeton JWT est conservé dans `localStorage`
(compromis d'apprentissage, voir `LEARNINGS.md`).

Les images étant protégées, elles sont téléchargées avec `HttpClient` (en-tête `Authorization`)
puis affichées via une URL objet : une balise `<img src>` ne peut pas envoyer de jeton.

> Version d'Angular : 21 (la 22 exige Node >= 24.15 ; le projet est testé avec Node 24.11).

## Tests et qualité

```bash
npm test                  # unit + integration + E2E de tous les workspaces
npm run typecheck && npm run lint   # lint : API uniquement
npm test -w apps/web                 # tests de l'application Angular (Vitest, jsdom)
# Un seul niveau de tests de l'API :
npm run test:unit -w apps/api        # domaine / use cases, sans réseau ni DB
npm run test:integration -w apps/api # repositories, storage, migrator (imageservice_test)
npm run test:e2e -w apps/api         # requêtes HTTP (supertest) sur la base de test
```

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET | `/health` | 200 si l'app et la base répondent, 503 si la base est injoignable |
| POST | `/register` | Corps `{ email, password }` (mot de passe : 8 caractères min.). 201 `{ id, email }` (jamais le hash), 400 validation / JSON malformé, 409 e-mail déjà pris |
| POST | `/login` | Corps `{ email, password }`. 200 `{ token }` (JWT), 400 validation, 401 identifiants incorrects (même réponse pour e-mail inconnu et mauvais mot de passe) |

| POST | `/images` | Authentifié. Multipart, champ `image` (JPEG, PNG ou WebP ; 10 Mo et 8000 px par côté par défaut). 201 `{ id, format, sizeBytes, width, height, createdAt }`, 400 fichier manquant ou illisible, 401, 413 trop lourd ou trop grand, 415 format non supporté. Le type est vérifié par les magic bytes |
| GET | `/images/:id` | Authentifié. Renvoie le fichier en flux avec son `Content-Type`. 200, 401, 404 (image inconnue, UUID invalide ou appartenant à un autre utilisateur : jamais 403) |
| GET | `/images?page=&limit=` | Authentifié. Liste paginée de SES images, la plus récente d'abord (défauts `page=1`, `limit=10`, `limit` max 50). 200 `{ items, page, limit, total }`, 400 si hors bornes ou non numérique, 401 |
| POST | `/images/:id/transform` | Authentifié. Crée une image **dérivée** (l'original n'est jamais modifié). Corps JSON, toutes les clés optionnelles (au moins une opération) : `crop {x,y,width,height}`, `rotate` (entier -360 à 360, sens horaire), `flip` (vertical), `mirror` (horizontal), `resize {width?,height?,fit?}` (1 à 8000 px ; `fit` : cover, contain, fill, inside par défaut, outside), `filter` (`grayscale` ou `sepia`), `watermark {text,position?,opacity?}` (filigrane texte, voir plus bas), `format` (`jpeg`, `png`, `webp`), `quality` (1-100, jpeg et webp). 201 `{ id, originalId, format, sizeBytes, width, height, createdAt }`, 400 paramètres invalides, 401, 404 (image inconnue ou d'un autre utilisateur) |

Les routes protégées attendent l'en-tête `Authorization: Bearer <token>` ; sans jeton valide : 401.

## Postman

Importer `postman/image-processing-service.postman_collection.json`. Lancer `Register` puis
`Login` : le jeton est stocké dans la variable `token` pour les futures routes protégées.
La collection est complétée à chaque nouvelle route.

## Stockage des fichiers

Les images sont écrites sous `STORAGE_LOCAL_DIR` (défaut `storage/`, soit `apps/api/storage/`, ignoré par git) avec une clé
générée : `originals/<uuid>.<ext>` pour un envoi, `derived/<uuid>.<ext>` pour une transformation ; le nom de
fichier envoyé par le client n'est jamais utilisé.

## Transformations d'images

Ordre d'application, fixe : orientation EXIF → crop → rotate → flip → mirror → resize → filtre → filigrane → format
et qualité. Le crop s'exprime donc dans les coordonnées de l'image source (après orientation). Les métadonnées
(EXIF, GPS) sont supprimées du résultat. Les coins vides d'une rotation libre sont transparents (PNG, WebP) ou
blancs (JPEG). Transformer un dérivé est permis : le nouveau dérivé garde `originalId` pointant vers l'original
racine. Les dérivés apparaissent dans `GET /images`.

**Filigrane** : `watermark: { text, position?, opacity? }`. Texte de 1 à 30 caractères, limité à une liste blanche
(lettres, chiffres, espace et `. , ' : ; ! ? @ # & ( ) © _ -`) ; `position` : `center`, `top-left`, `top-right`,
`bottom-left`, `bottom-right` (défaut) ; `opacity` de 0,1 à 1 (défaut 0,5). Le texte est blanc avec un contour sombre,
sa taille suit l'image finale. Il est rendu par `sharp` à partir d'un SVG (texte échappé) : **le rendu dépend des
polices du système** (`sans-serif` gras) ; sur un serveur sans police installée, le texte pourrait ne pas s'afficher. Le résultat ne peut pas dépasser `MAX_IMAGE_PIXELS_SIDE`
par côté (ajouter un `resize`).

## Variables d'environnement

Voir `apps/api/.env.example`. `CORS_ORIGIN` (défaut `http://localhost:4200`) est l'unique origine
navigateur autorisée à appeler l'API : une origine exacte, jamais `*`. L'application refuse de démarrer si la configuration est invalide.
