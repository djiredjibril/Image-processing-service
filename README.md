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

Crée deux bases : `imageservice_dev` et `imageservice_test`, et lance Redis. Les ports hôtes sont
**5433** pour PostgreSQL et **6380** pour Redis (pour éviter un conflit avec un PostgreSQL sur 5432 ou un
Redis sur 6379). Le script
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
| GET | `/health` | `{ status, database, redis }` : 200 « ok » si tout répond, 200 « degraded » si seul Redis est tombé (l'API continue sans cache), 503 si la base est injoignable |
| POST | `/register` | Corps `{ email, password }` (mot de passe : 8 caractères min.). 201 `{ id, email }` (jamais le hash), 400 validation / JSON malformé, 409 e-mail déjà pris |
| POST | `/login` | Corps `{ email, password }`. 200 `{ token }` (JWT), 400 validation, 401 identifiants incorrects (même réponse pour e-mail inconnu et mauvais mot de passe) |

| POST | `/images` | Authentifié. Multipart, champ `image` (JPEG, PNG ou WebP ; 10 Mo et 8000 px par côté par défaut). 201 `{ id, format, sizeBytes, width, height, createdAt }`, 400 fichier manquant ou illisible, 401, 413 trop lourd ou trop grand, 415 format non supporté. Le type est vérifié par les magic bytes |
| GET | `/images/:id` | Authentifié. Renvoie le fichier en flux avec son `Content-Type`. 200, 401, 404 (image inconnue, UUID invalide ou appartenant à un autre utilisateur : jamais 403) |
| GET | `/images?page=&limit=` | Authentifié. Liste paginée de SES images, la plus récente d'abord (défauts `page=1`, `limit=10`, `limit` max 50). 200 `{ items, page, limit, total }`, 400 si hors bornes ou non numérique, 401 |
| POST | `/images/:id/transform` | Authentifié. Crée une image **dérivée** (l'original n'est jamais modifié). Corps JSON, toutes les clés optionnelles (au moins une opération) : `crop {x,y,width,height}`, `rotate` (entier -360 à 360, sens horaire), `flip` (vertical), `mirror` (horizontal), `resize {width?,height?,fit?}` (1 à 8000 px ; `fit` : cover, contain, fill, inside par défaut, outside), `filter` (`grayscale` ou `sepia`), `watermark {text,position?,opacity?}` (filigrane texte, voir plus bas), `format` (`jpeg`, `png`, `webp`), `quality` (1-100, jpeg et webp). `201` + `X-Cache: MISS` (dérivé créé) ou `200` + `X-Cache: HIT` (déjà produit : renvoyé depuis le cache, sans retraitement), corps `{ id, originalId, format, sizeBytes, width, height, createdAt }` ; 400 paramètres invalides, 401, 404 (image inconnue ou d'un autre utilisateur), 429 (limite dépassée) |

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

## Cache des transformations

Une même transformation (même utilisateur, même image source, mêmes paramètres) n'est calculée **qu'une fois**.
La clé de cache est un SHA-256 des paramètres *normalisés* : valeurs par défaut explicites ou omises (`fit`
« inside », position « bottom-right », opacité 0,5), `flip: false`, rotation -90° ≡ 270°, espaces autour du texte
du filigrane et ordre des champs n'ont aucun effet. Redis conserve `clé → identifiant du dérivé` pendant
`CACHE_TTL_SECONDS` (24 h par défaut). Avant de servir une entrée, l'API vérifie en base que le dérivé existe
encore et appartient bien à l'utilisateur et à la même image d'origine (le cache n'est qu'un index).

Deux demandes identiques **simultanées** sont sérialisées par un verrou Redis (`SET NX PX`, libéré par un script Lua
qui compare le jeton du détenteur) : une seule calcule, l'autre attend son résultat (5 s au plus) puis le renvoie.
Si Redis est indisponible, la transformation fonctionne quand même, simplement sans dédoublonnage (« fail-open »).
`TRANSFORM_CACHE_VERSION` (dans `transform-cache-key.ts`) est à incrémenter quand le rendu des transformations change.

## File d'attente et worker (phase 4)

Les transformations peuvent être traitées **en arrière-plan** par un worker BullMQ (guide complet : `docs/BULLMQ.md`).
Le statut de chaque job vit dans la table `transform_jobs` (PostgreSQL) ; Redis ne transporte que l'identifiant du job.
Le worker est un process séparé : `npm run worker -w apps/api` (`dev:worker` pour le mode watch). Réglages :
`QUEUE_ATTEMPTS` (3 tentatives), `QUEUE_BACKOFF_MS` (1000, doublé à chaque échec), `WORKER_CONCURRENCY` (2).
Un échec métier (paramètres invalides, image absente) est définitif tout de suite ; une panne technique est
retentée avec attente croissante. Si Redis est injoignable à la mise en file : `503` (la file est vitale, contrairement au cache).

## Rate limiting

Chaque palier a son propre compteur Redis (fenêtre fixe de `RATE_LIMIT_WINDOW_SECONDS`, 60 s par défaut) :

| Palier | Routes | Compté par | Limite par défaut |
|---|---|---|---|
| `auth` | `POST /register`, `POST /login` (compteur commun) | adresse IP | 10 / min (`RATE_LIMIT_AUTH`) |
| `upload` | `POST /images` | utilisateur | 20 / min (`RATE_LIMIT_UPLOAD`) |
| `transform` | `POST /images/:id/transform` (HIT compris) | utilisateur | 10 / min (`RATE_LIMIT_TRANSFORM`) |
| `read` | `GET /images`, `GET /images/:id` (compteur commun) | utilisateur | 300 / min (`RATE_LIMIT_READ`) |

Au-delà de la limite : `429 Too Many Requests`, corps `{ "error": "TooManyRequests", ... }` et en-tête `Retry-After`
(secondes). Toutes les réponses des routes limitées portent `RateLimit-Limit`, `RateLimit-Remaining` et `RateLimit-Reset`
(secondes avant la réinitialisation) ; CORS les expose au navigateur. Le comptage est atomique (script Lua `INCR` + `PEXPIRE`).
Les paliers par utilisateur s'appliquent **après** l'authentification : une requête sans jeton valide reçoit 401 et ne consomme
aucun quota. Fail-open : si Redis est arrêté, aucune limite n'est appliquée. Limite connue de la fenêtre fixe : un client peut
enchaîner jusqu'à 2× la limite à cheval sur deux fenêtres. Derrière un reverse proxy, `req.ip` serait l'IP du proxy
(`trust proxy` à configurer : phase 6).

## Redis

Redis (cache et rate limiting, phase 3 ; guide : `docs/REDIS.md`) tourne dans Docker sur le port 6380, **sans persistance** : ce sont des
données jetables. Base 0 en développement (`REDIS_URL`), base 1 pour les tests (`TEST_REDIS_URL`) ; les tests ne
touchent jamais à la base 0. Toutes les clés sont préfixées `ips:`.

Redis est une **optimisation, pas une dépendance critique** : s'il est arrêté, l'API démarre et fonctionne quand
même (`/health` indique « degraded », un message est écrit dans les logs) et se reconnecte seule à son retour.

## Variables d'environnement

Voir `apps/api/.env.example` (dont les `RATE_LIMIT_*`). `CORS_ORIGIN` (défaut `http://localhost:4200`) est l'unique origine
navigateur autorisée à appeler l'API : une origine exacte, jamais `*`. L'application refuse de démarrer si la configuration est invalide.
