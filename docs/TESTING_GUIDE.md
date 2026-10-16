# Guide de test : ce qu'on peut tester, ses variantes, et comment c'est implémenté

> Objectif : comprendre **l'exercice d'origine** (roadmap.sh « Image Processing Service »)
> en parcourant chaque sujet : *ce qu'on teste*, *les variantes à essayer*, *comment c'est
> fait dans le code*, *quel test l'automatise*.
>
> Légende des statuts : ✅ implémenté · 🔜 prévu dans une phase à venir (pas encore codé).

Table des matières : [0. Comment tester](#0-comment-tester) · [1. Inscription](#1-inscription-post-register) ·
[2. Connexion et JWT](#2-connexion-et-jwt-post-login) · [3. Hachage](#3-hachage-des-mots-de-passe-argon2id) ·
[4. Upload](#4-upload-post-images) · [5. Lecture et liste](#5-lecture-et-liste) ·
[6. Transformations](#6-transformations-post-imagesidtransform) · [7. Cache Redis](#7-cache-redis) ·
[8. Rate limiting](#8-rate-limiting-) · [9. BullMQ](#9-file-dattente-bullmq-) · [10. Stockage](#10-stockage) ·
[11. Santé, CORS, config](#11-santé-cors-configuration) · [12. Durcissement et sécurité](#12-durcissement-et-sécurité) · [13. Les trois niveaux de tests](#13-les-trois-niveaux-de-tests) ·
[14. Tester soi-même](#14-tester-soi-même)

---

## 0. Comment tester

```bash
docker compose up -d            # PostgreSQL (5433) + Redis (6380)
npm run dev -w apps/api         # l'API sur http://localhost:3000
npm test                        # unit + integration + E2E (API et web)
npm run test:unit -w apps/api   # un seul niveau, un seul workspace
```

Pour les essais à la main : la collection Postman `postman/image-processing-service.postman_collection.json`.
Les tests automatisés n'utilisent jamais la base de dev : base `imageservice_test`,
Redis **db 1**, dossier temporaire pour les fichiers.

---

## 1. Inscription (`POST /register`) ✅

**Implémentation** : zod valide la forme (route) → `RegisterUser` (use case) → value objects
`Email` (normalisé en minuscules, 254 caractères max) et mot de passe (8 caractères min) →
hachage → `IUserRepository.save`. Les erreurs sont des types (`Result`), traduites en HTTP à un
seul endroit (`error-mapping.ts`).

| Variante à tester | Attendu |
|---|---|
| e-mail + mot de passe valides | `201`, pas de mot de passe dans la réponse |
| e-mail mal formé | `400 InvalidEmail` |
| mot de passe < 8 caractères | `400 WeakPassword` |
| corps vide, champ manquant, champ en trop | `400` (zod strict) |
| même e-mail deux fois | `409 EmailAlreadyUsed` |
| même e-mail avec casse différente (`A@x.com` / `a@x.com`) | `409` (normalisation) |
| e-mail > 254 caractères | `400` |

Tests : `tests/e2e/register.test.ts`, `tests/unit/application/` (use case avec fakes),
`tests/integration/pg-user-repository.test.ts` (contrainte d'unicité réelle).

## 2. Connexion et JWT (`POST /login`) ✅

**Implémentation** : `LoginUser` vérifie le mot de passe puis `ITokenService` signe un JWT
(**HS256**, bibliothèque `jose`, `sub` = id utilisateur, expiration `JWT_EXPIRES_IN`, 1 h par défaut).
Le middleware `auth-middleware.ts` lit `Authorization: Bearer <jwt>`.

| Variante | Attendu |
|---|---|
| bons identifiants | `200` + jeton |
| mauvais mot de passe | `401 InvalidCredentials` |
| e-mail inconnu | `401`, **même message** (anti-énumération : on ne révèle pas si le compte existe) |
| e-mail inconnu vs mauvais mot de passe : durée | similaire (un faux hash est vérifié pour éviter l'attaque par *timing*) |
| route protégée sans jeton | `401` |
| jeton falsifié, expiré, mal formé | `401` |
| jeton avec `alg: none` ou un autre algorithme | `401` (seul HS256 accepté) |
| jeton signé avec une autre clé | `401` |

Tests : `tests/e2e/login.test.ts`, `auth-middleware.test.ts`, `tests/integration/jwt-token-service.test.ts`.

## 3. Hachage des mots de passe (argon2id) ✅

**Pourquoi** : on ne stocke jamais un mot de passe, seulement une empreinte lente et salée.
`argon2id` est volontairement coûteux en CPU et en mémoire pour rendre le brute-force
irréaliste. Il est derrière le port `IPasswordHasher` (`Argon2PasswordHasher` en production,
un faux rapide dans les tests unitaires).

| Variante | Attendu |
|---|---|
| hacher deux fois le même mot de passe | deux empreintes **différentes** (sel aléatoire) |
| vérifier avec le bon mot de passe / un mauvais | `true` / `false` |
| l'empreinte commence par `$argon2id$` | oui |
| `PasswordHash` journalisé ou sérialisé | jamais le contenu (`reveal()` explicite) |

> ⚠️ Ne pas confondre avec le **hachage de la clé de cache** (section 7) : là c'est SHA-256,
> rapide et déterministe, sans sel, pour *identifier* une requête, pas pour protéger un secret.

Test : `tests/integration/argon2-password-hasher.test.ts`.

## 4. Upload (`POST /images`) ✅

**Implémentation** : `multer` en mémoire (limite de poids, 1 fichier, 0 champ texte) →
`UploadImage`. Le format est déterminé par les **magic bytes** (pas l'extension ni le
`Content-Type`). Les dimensions sont lues via les métadonnées de `sharp` **sans décoder**
l'image (protection contre les *decompression bombs*). Le fichier est stocké sous une clé
générée (`originals/<uuid>.<ext>`), jamais avec le nom fourni par le client.

| Variante | Attendu |
|---|---|
| JPEG, PNG, WebP valides | `201` + métadonnées |
| fichier > `MAX_UPLOAD_BYTES` (10 Mo) | `413 FileTooLarge` |
| image > `MAX_IMAGE_PIXELS_SIDE` (8000 px) de côté, même légère | `413 ImageDimensionsTooLarge` |
| fichier `.jpg` qui est en fait un texte/exécutable | `415 UnsupportedImageFormat` (magic bytes) |
| GIF, BMP, SVG | `415` |
| fichier vide | `400 EmptyFile` |
| en-tête valide mais contenu tronqué | `400 CorruptedImage` |
| extension mensongère (`.png` contenant un JPEG) | accepté comme **JPEG** (le type réel gagne) |
| nom de fichier piégé (`../../etc/passwd`) | ignoré, clé générée |
| sans jeton | `401` |
| échec d'écriture en base après stockage | le fichier est supprimé (compensation) |

Tests : `tests/e2e/upload.test.ts`, `tests/integration/local-file-storage.test.ts`, `pg-image-repository.test.ts`.

## 5. Lecture et liste ✅

**`GET /images/:id`** : renvoie le fichier en *streaming* (`pipeline`, sans tout charger en RAM).

| Variante | Attendu |
|---|---|
| image à soi | `200` + bon `Content-Type` |
| image d'un autre utilisateur | **`404`** (jamais `403`, pour ne pas révéler son existence) |
| id inexistant ou pas un UUID | `404` |
| sans jeton | `401` |

**`GET /images?page=&limit=`** : pagination à ordre stable (pas de doublon ni de trou entre pages).

| Variante | Attendu |
|---|---|
| sans paramètres | page 1, limite par défaut |
| `limit=50` / `limit=51` | OK / `400` (plafond 50) |
| `page=0`, `page=-1`, `limit=abc`, `limit=1.5` | `400 InvalidPagination` |
| page au-delà de la fin | liste vide, `200` |
| 2 utilisateurs avec des images | chacun ne voit que les siennes |
| originaux et dérivés | tous listés, le dérivé indique son original |

Tests : `tests/e2e/get-image.test.ts`, `list-images.test.ts`, `tests/unit/domain/` (`Pagination`).

## 6. Transformations (`POST /images/:id/transform`) ✅

**Implémentation** : `TransformImage` construit un `TransformationSet` (value objects validés),
vérifie la propriété de l'image, puis `IImageProcessor` (implémenté par `SharpImageProcessor`)
applique les opérations dans un **ordre fixe** : orientation EXIF → crop → rotate →
flip/mirror → resize → filtre → filigrane → format/qualité. L'original est **immuable** :
le résultat est toujours un nouveau fichier (`derived/...`) dont `original_id` pointe vers la
**racine** (même si on transforme un dérivé). Les métadonnées EXIF (GPS) sont retirées.

Corps (tous les champs sont optionnels, objet strict : un champ inconnu est refusé) :

```json
{
  "crop": { "x": 0, "y": 0, "width": 100, "height": 100 },
  "rotate": 90,
  "flip": true,
  "mirror": false,
  "resize": { "width": 300, "height": 200, "fit": "cover" },
  "filter": "sepia",
  "watermark": { "text": "© Moi", "position": "bottom-right", "opacity": 0.5 },
  "format": "webp",
  "quality": 80
}
```

| Opération | Valeurs valides | Variantes d'erreur (→ `400`) |
|---|---|---|
| `crop` | x, y entiers ≥ 0 ; width, height ≥ 1 ; rectangle dans l'image | négatif, flottant, rectangle hors image |
| `rotate` | entier de −360 à 360 | `45.5`, `720`, texte |
| `flip` / `mirror` | booléens (flip = vertical, mirror = horizontal) | `"oui"` |
| `resize` | width/height entiers de 1 à 8000 (au moins l'un des deux) ; `fit` : `inside` (défaut), `cover`, `contain`, `fill`, `outside` | `0`, `9000`, fit inconnu, ni width ni height |
| `filter` | `grayscale`, `sepia` | autre valeur |
| `watermark` | texte 1–30 caractères ; position `center`, `top-left`, `top-right`, `bottom-left`, `bottom-right` ; opacité 0.1–1 (0.5 par défaut) | texte vide ou trop long, opacité 0, position inconnue |
| `format` | `jpeg`, `png`, `webp` | `gif`, `avif`... |
| `quality` | entier 1–100 (formats avec perte) | `0`, `101`, `80.5` |

Autres variantes à essayer :

| Variante | Attendu |
|---|---|
| corps `{}` (aucune transformation) | `400` (rien à faire) |
| rotation 45° sur un JPEG | coins **blancs** (JPEG sans transparence) ; PNG/WebP : coins transparents |
| PNG transparent → JPEG | fond blanc opaque |
| image de 49 Mpx (7000×7000) | passe, mais ~1,1 Go de RAM : c'est la raison de la limite en pixels |
| filigrane avec `<`, `&`, `"` ou emoji | texte échappé (pas d'injection SVG), emojis comptés correctement |
| transformer un dérivé | nouveau dérivé relié à l'**original racine** |
| image d'un autre utilisateur | `404` |

Tests : `tests/e2e/transform.test.ts`, `tests/unit/domain/` (chaque value object),
`tests/integration/sharp-image-processor.test.ts` (pixels réellement vérifiés),
`watermark-svg.test.ts`.

## 7. Cache Redis ✅

(Version didactique complète : [`docs/REDIS.md`](./REDIS.md).)

**Implémentation** : `TransformCacheKey` = **SHA-256** d'un tableau positionnel
`[version, utilisateur, source, crop, rotation normalisée, flip, mirror, resize, filtre, filigrane, format, qualité]`.
Redis stocke `clé → id du dérivé` (un **index**, pas les octets), avec un TTL (`CACHE_TTL_SECONDS`).
Avant de servir un HIT, on revérifie en base (existence, propriétaire, même racine).

| Variante | Attendu |
|---|---|
| 1re demande | `201` + `X-Cache: MISS` |
| même demande | `200` + `X-Cache: HIT`, **même id**, pas de nouvelle ligne en base |
| champs dans un autre ordre | HIT (clé canonique) |
| valeurs par défaut explicites (`flip: false`, `fit: "inside"` qui est le défaut du resize...) | HIT |
| `rotate: -90` puis `rotate: 270` | HIT (rotation normalisée) |
| espaces autour du texte du filigrane | HIT |
| un paramètre qui change (`quality: 80` → `81`) | MISS, nouveau dérivé |
| autre utilisateur, mêmes paramètres | cache **séparé** (l'utilisateur est dans la clé) |
| 8 demandes identiques simultanées | 1 × `201`, 7 × `200` (verrou) |
| TTL écoulé | MISS à nouveau |
| entrée Redis pointant vers un dérivé supprimé (« périmée ») | ignorée, retraitement |
| entrée qui pointe vers l'image d'un autre (« empoisonnée ») | ignorée |
| Redis arrêté | tout fonctionne (**fail-open**), sans dédoublonnage |
| Redis revient | le cache reprend |
| `flip + mirror` vs `rotate 180` | deux clés différentes (limite connue, inoffensive) |

Tests : `tests/unit/domain/transform-cache-key.test.ts`, `tests/unit/application/transform-image.test.ts`
(fake en mémoire avec vrai comportement de verrou), `tests/integration/redis-transform-cache.test.ts`
(vrai Redis : TTL, exclusivité du verrou, sûreté du jeton), `tests/e2e/transform-cache.test.ts`.

**À essayer à la main** : `docker compose exec redis redis-cli`, puis `KEYS ips:*` et `TTL <clé>`.

## 8. Rate limiting ✅

(Concepts : [`docs/REDIS.md`](./REDIS.md), section 6.)

**Implémentation** : port `IRateLimiter` (domaine) → `RedisRateLimiter` (script Lua `INCR` + `PEXPIRE`, fenêtre fixe) →
middleware `createRateLimitMiddleware` branché dans `app.ts`. Paliers par IP (auth) et par utilisateur (upload, transform, read).
Le palier par utilisateur est placé **après** l'authentification (`chain(authenticate, limite)`).

| Palier | Routes | Compté par | Défaut (variable) |
|---|---|---|---|
| auth | `/register` + `/login` (compteur commun) | IP | 10/min (`RATE_LIMIT_AUTH`) |
| upload | `POST /images` | utilisateur | 20/min (`RATE_LIMIT_UPLOAD`) |
| transform | `POST /images/:id/transform` (les HIT comptent aussi) | utilisateur | 10/min (`RATE_LIMIT_TRANSFORM`) |
| read | `GET /images`, `GET /images/:id` (compteur commun) | utilisateur | 300/min (`RATE_LIMIT_READ`) |

| Variante | Attendu |
|---|---|
| requêtes sous la limite | réponse normale + `RateLimit-Limit`, `RateLimit-Remaining` (décroît), `RateLimit-Reset` |
| requête n° limite+1 | `429`, corps `{error:"TooManyRequests"}`, `Retry-After` (1 à 60 s) |
| `/register` puis `/login` | partagent le même compteur (palier auth) |
| un 429 | le use case n'est pas exécuté (aucun compte, aucun fichier créé) |
| Alice bloquée, Bob | Bob passe (compteurs par utilisateur) |
| requêtes sans jeton (401) | ne consomment aucun quota |
| `GET /images` + `GET /images/:id` | même compteur « read » |
| transform dépassé | upload et lecture non affectés (compteurs séparés) |
| fenêtre écoulée | le compteur repart de zéro |
| 20 requêtes simultanées, limite 7 | exactement 7 acceptées (atomicité) |
| Redis arrêté | tout passe, sans en-têtes `RateLimit-*` (fail-open) |
| navigateur | peut lire `Retry-After` et `RateLimit-*` (CORS `exposedHeaders`) |
| clé Redis sans expiration | « réparée » par le script (sinon blocage à vie) |
| limite connue | jusqu'à 2× la limite à cheval sur deux fenêtres (fenêtre fixe) |

Tests : `tests/unit/infrastructure/rate-limit-middleware.test.ts` (middleware + `chain`),
`tests/unit/infrastructure/in-memory-rate-limiter.test.ts` et `tests/integration/redis-rate-limiter.test.ts`
(**même contrat** `tests/helpers/rate-limiter-contract.ts` pour le fake et pour Redis), `tests/e2e/rate-limit.test.ts`.

**À tester à la main** (limites par défaut, API lancée) :

```bash
# 12 connexions de suite : les 10 premières répondent 401 (mauvais mot de passe), puis 429
for i in $(seq 1 12); do
  curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3000/login \
    -H 'Content-Type: application/json' -d '{"email":"a@b.co","password":"mauvais-mdp"}'
done
curl -i -X POST localhost:3000/login -H 'Content-Type: application/json' -d '{"email":"a@b.co","password":"x"}'
#   → regarder Retry-After et RateLimit-Remaining: 0
docker compose exec redis redis-cli KEYS 'ips:ratelimit:*'   # le compteur
docker compose exec redis redis-cli TTL ips:ratelimit:auth:::1   # secondes avant remise à zéro (l'IP peut varier)
docker compose stop redis   # puis refaire des requêtes : plus de 429 (fail-open) ; docker compose start redis
```

Astuce : pour tester un palier sans taper 10 requêtes, démarrer l'API avec `RATE_LIMIT_TRANSFORM=2 npm run dev -w apps/api`.

## 9. File d'attente et jobs (BullMQ) ✅ (phase 4)

(Concepts et schéma : [`docs/BULLMQ.md`](./BULLMQ.md).)

**Implémentation** : `TransformJob` (machine à états, domaine) + table `transform_jobs` (statut = vérité) + port `ITransformJobQueue`
→ `BullMqTransformJobQueue` (producteur) ; le worker (`startTransformWorker`) exécute `ProcessTransformJob`, qui réutilise `TransformImage`
(donc le cache et son verrou). Process séparé : `npm run worker -w apps/api`.

| Variante | Attendu |
|---|---|
| job `queued` → worker | `processing` (tentative 1) puis `completed` + id du dérivé (parent = image source) |
| 4 jobs d'affilée (concurrence 2) | tous traités |
| contenu du job dans Redis | `{"jobId":"..."}` uniquement (aucun paramètre, aucun filigrane) |
| même identifiant mis deux fois en file | traité une seule fois |
| paramètres invalides (`rotate: 45.5`) | `failed` immédiat (`InvalidTransformation`), **1 seule** tentative |
| image source d'un autre utilisateur | `failed` (`ImageNotFound`) : le propriétaire du job fait foi |
| panne passagère de la base | nouvelle tentative avec backoff, puis `completed` (2 tentatives) |
| panne persistante | après 3 tentatives, `failed` `ProcessingFailed`, message **générique** (pas de détail interne) |
| job absent de la base | abandonné sans nouvelle tentative, le worker continue |
| job déjà terminé livré deux fois | non retraité (idempotence) |
| arrêt du worker pendant un job | `close()` attend la fin du job en cours |
| Redis injoignable à la mise en file | `QueueUnavailable` en ~1 s (pas d'attente infinie) |
| transitions interdites | `completed` et `failed` sont terminaux ; on ne complète pas un job non démarré |
| base de données | statut hors énumération refusé ; image source inexistante refusée ; suppression de l'utilisateur supprime ses jobs |

Tests : `tests/unit/domain/transform-job.test.ts`, `tests/unit/application/process-transform-job.test.ts`,
`tests/integration/pg-transform-job-repository.test.ts`, `tests/integration/bullmq-transform-queue.test.ts` (vrai Redis, vrai BullMQ).

### Les endpoints asynchrones (`POST /images/:id/jobs`, `GET /jobs/:id`)

| Variante | Attendu |
|---|---|
| paramètres valides | `202`, `Location: /jobs/<id>`, `Retry-After: 1`, job `queued` en base **et** en file |
| paramètres invalides (`rotate: 45.5`), champ inconnu, `{}`, resize hors bornes | `400` immédiat, **aucun** job en base ni en file |
| image d'un autre utilisateur / inconnue / id mal formé | `404` identique dans les trois cas |
| sans jeton | `401` (création et suivi) |
| `GET /jobs/:id` d'un autre utilisateur / inconnu / mal formé | même `404` (jamais 403) |
| Redis arrêté à la création | `503 QueueUnavailable` en moins de ~4 s ; le job créé en base est supprimé |
| quota | `POST /jobs` et `POST /transform` partagent le quota `transform` ; `GET /jobs/:id` compte dans `read` |
| parcours complet avec un vrai worker | `202` → `queued`/`processing` → `completed` ; `image` (dérivé de la source, bon format et bonnes dimensions) ; son fichier est lisible via `GET /images/:id` |
| aucun worker lancé | le job reste `queued` (la file garde le travail) puis est traité au démarrage du worker |
| deux jobs identiques | un seul dérivé en base (cache partagé avec la voie synchrone), les deux `completed` |
| fichier source disparu avant le traitement | `failed`, `error.kind = ImageNotFound`, 1 seule tentative |
| un autre utilisateur suit le job | `404`, même une fois `completed` |

Tests : `tests/unit/application/enqueue-transform-job.test.ts` (création + suivi), `tests/e2e/transform-jobs.test.ts`
(HTTP + PostgreSQL + vraie file BullMQ + vrai worker + vrai sharp).

**À tester à la main** (3 terminaux : `docker compose up -d` puis `npm run migrate`) :

```bash
npm run dev -w apps/api            # terminal 1 : l'API
npm run worker -w apps/api         # terminal 2 : le worker (affiche « Worker démarré (concurrence : 2) »)

# terminal 3 (ou Postman : requêtes « Create transform job (async) » puis « Get job (polling) »)
curl -i -X POST localhost:3000/images/$IMG/jobs -H "Authorization: Bearer $TOKEN" \
     -H 'Content-Type: application/json' -d '{"rotate":45,"filter":"sepia","format":"webp"}'
curl -s localhost:3000/jobs/<id> -H "Authorization: Bearer $TOKEN"       # répéter : queued → completed
```

Expériences à faire pour **voir** les concepts :
1. **La file garde le travail** : arrêter le worker (Ctrl+C : « Arrêt du worker : fin des jobs en cours... »), créer un job → il reste
   `queued` ; `docker compose exec redis redis-cli LLEN ips:bull:transform-image:wait` → 1 ; relancer le worker → `completed`.
2. **Redis est jetable, le statut non** : `docker compose exec redis redis-cli FLUSHDB` ne supprime pas l'historique :
   `docker compose exec postgres psql -U imageservice -d imageservice_dev -c "select id, status, attempts, error_kind from transform_jobs order by created_at desc"`.
3. **La file est vitale** : `docker compose stop redis`, `POST /jobs` → `503` rapide (alors que `POST /transform` marche, sans cache) ; `docker compose start redis`.
4. **Échec définitif** : créer un job, **supprimer le fichier** de l'image source dans `apps/api/storage/originals/` avant que le worker ne le prenne
   (worker arrêté), puis relancer le worker → `failed` avec `error.kind = ImageNotFound`, sans nouvelle tentative.
5. **Concurrence** : créer 6 jobs d'affilée avec des paramètres différents et regarder les logs du worker (2 traités en même temps).
6. **Arrêt propre** : créer un job sur une grande image (3000×2000 ou plus), faire Ctrl+C sur le worker pendant le traitement : il termine le job avant de quitter.
7. **Cache** : refaire exactement le même job → le second est `completed` quasi instantanément avec le même `image.id`.

## 10. Stockage : disque local et S3, URLs présignées ✅

(Concepts : [`docs/S3.md`](./S3.md).)

**Implémentation** : le port `IFileStorage` (`put`, `get`, `delete`, `exists`) est défini dans le domaine ; `LocalFileStorage` (disque) et
`S3FileStorage` (SeaweedFS, SDK AWS) le respectent. `STORAGE_DRIVER` choisit (`local` par défaut). Les clés sont des chaînes
(`originals/<uuid>.jpg`), jamais des chemins ni des noms fournis par l'utilisateur. Aucune route ni use case n'utilise `fs` ni le SDK.

Le **même contrat** est vérifié pour les deux implémentations (`tests/helpers/file-storage-contract.ts`) :

| Variante | Attendu |
|---|---|
| `put` puis `get` (octets non textuels) | mêmes octets |
| fichier de 6 Mo | relu en flux, identique |
| `get` d'une clé absente | `null`, pas de crash |
| `exists` avant / après `put` / après `delete` | `false` / `true` / `false` |
| `delete` d'une clé absente, répété | sans erreur (idempotent) |
| second `put` sur la même clé | **échoue**, contenu d'origine conservé (immutable) |
| 5 `put` simultanés sur la même clé | un seul réussit (atomique : `wx` sur disque, `If-None-Match: *` sur S3) |
| clés différentes | indépendantes |
| clé avec `..`, `/` initial ou `\` | `StorageKey` refuse de se construire ; `LocalFileStorage` revérifie le chemin |

Spécifique S3 (tests E2E avec un vrai SeaweedFS) : l'objet est dans le bucket sous la clé enregistrée en base, avec le bon `Content-Type` et la bonne
taille ; `GET /images/:id` renvoie les mêmes octets que l'upload ; un autre utilisateur reçoit `404` ; la transformation synchrone écrit sous
`derived/` sans toucher l'original ; objet disparu du bucket → `404` ; le **worker** lit la source et écrit le dérivé dans le même bucket que l'API.
Configuration : `STORAGE_DRIVER=s3` exige `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` (message clair pour celle qui manque) ;
endpoint non-URL, bucket < 3 caractères ou `S3_FORCE_PATH_STYLE` invalide → démarrage refusé.

Tests : `tests/integration/file-storage-contract.test.ts` (disque + S3), `tests/e2e/s3-storage.test.ts`, `tests/unit/config.test.ts`,
`tests/integration/local-file-storage.test.ts`. **Prérequis : `docker compose up -d --wait`** (SeaweedFS sur le port 8333 ; bucket de test `imageservice-test`).

### URLs présignées (`GET /images/:id/url`)

| Variante | Attendu |
|---|---|
| image de l'appelant, stockage S3 | `200` `{ url, expiresInSeconds, expiresAt }`, `Cache-Control: no-store` |
| télécharger l'URL **sans aucun en-tête** | `200`, mêmes octets que l'upload, `Content-Type` correct (`image/png`, `image/webp`) |
| URL d'un **dérivé** | fonctionne aussi |
| signature modifiée d'un caractère | `403` (du stockage) |
| URL détournée vers l'objet d'une autre image du bucket | `403` |
| durée `X-Amz-Expires` rallongée à la main | `403` (la durée fait partie de la signature) |
| après l'expiration (test avec 2 s) | `403` ; avant : `200` |
| image d'un autre utilisateur, id inconnu, id mal formé | `404` identiques, aucune URL délivrée |
| sans jeton | `401` |
| disque local (`STORAGE_DRIVER=local`) | `501 PresignedUrlsUnsupported` (et `404` pour une image d'autrui : l'autorisation passe avant) |
| objet absent du bucket alors que la ligne existe | `404`, rien n'est signé |
| signature | URL SigV4 vers l'endpoint **public**, sans le secret ; deux clés ou deux durées donnent deux signatures différentes |
| configuration | `PRESIGNED_URL_TTL_SECONDS` : défaut 300, bornes 1 à 604800 ; `S3_PUBLIC_ENDPOINT` doit être une URL |

Tests : `tests/unit/application/get-image-url.test.ts`, `tests/integration/s3-file-url-signer.test.ts`, section « URLs présignées » de `tests/e2e/s3-storage.test.ts` (vrai SeaweedFS).

**À tester à la main** :

```bash
docker compose up -d --wait
# dans apps/api/.env : STORAGE_DRIVER=s3 + S3_ENDPOINT / S3_BUCKET / S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY (voir .env.example)
npm run dev -w apps/api             # le bucket est créé au démarrage ; sans SeaweedFS : 10 essais puis erreur claire
npm run worker -w apps/api          # le worker utilise le MÊME stockage
```

1. **Upload puis lecture** (Postman : « Upload image » puis « Get image ») : l'image revient identique, et `apps/api/storage/` ne contient **rien** de nouveau (tout est dans le bucket).
2. **Voir l'objet** avec la CLI AWS (si installée) : `AWS_ACCESS_KEY_ID=imageservice AWS_SECRET_ACCESS_KEY=imageservice-secret aws --endpoint-url http://localhost:8333 s3 ls s3://imageservice-dev --recursive`.
3. **Panne du stockage** : `docker compose stop seaweedfs` puis `GET /images/<id>` → `500` (erreur inattendue, loguée) ; au **démarrage** de l'API, elle réessaie 10 s puis refuse de démarrer. `docker compose start seaweedfs` pour réparer.
4. **Passage disque → S3** : les images déjà envoyées en mode `local` ne sont pas dans le bucket (leurs lignes existent en base) → `GET` renvoie `404`. Pour les migrer, copier `storage/` dans le bucket en gardant les clés (voir `docs/S3.md` §4.7).
5. **URLs présignées** (Postman : « Get image URL (presigned) », ou `curl`) : récupérer l'URL, la coller dans le navigateur **sans être connecté** → l'image s'affiche ; modifier un caractère de `X-Amz-Signature` → page d'erreur XML `SignatureDoesNotMatch` (403) ; avec `PRESIGNED_URL_TTL_SECONDS=10`, attendre 10 s → `AccessDenied`/403.
6. **Disque local** : avec `STORAGE_DRIVER=local`, la même requête donne `501`.
7. **Retour en arrière** : remettre `STORAGE_DRIVER=local` ; les images envoyées en mode S3 ne sont alors plus lisibles (même raison, dans l'autre sens).

## 11. Santé, CORS, configuration ✅

| Sujet | Variantes | Attendu |
|---|---|---|
| `GET /health` | tout va bien / Redis arrêté / PostgreSQL arrêté | `ok` / `degraded` (200) / `503` |
| CORS | origine autorisée, autre origine | l'en-tête n'est renvoyé que pour **une seule origine exacte** (`CORS_ORIGIN`) ; `X-Cache` exposé |
| Config | `JWT_SECRET` < 32 caractères, `PORT` hors plage, variable manquante | démarrage refusé avec un message clair (zod) |
| Migrations | rejouer, base vide | idempotentes, numérotées (`db/migrations/001_...`) |

Tests : `tests/e2e/health.test.ts`, `cors.test.ts`, `tests/unit/config.test.ts`, `tests/integration/migrator.test.ts`.

## 12. Durcissement et sécurité ✅ (phase 6)

(Menaces, défenses et compromis : [`docs/SECURITY.md`](./SECURITY.md).)

**Implémentation** : `helmet` + 404 JSON (`app.ts`), `TRUST_PROXY` (`app.set("trust proxy", n)`), limite de connexion par e-mail (`byEmail`, palier `loginEmail`),
plafond de concurrence (port `IWorkSlots`, `LocalWorkSlots`, pris dans `TransformImage` autour du seul calcul coûteux), délais du serveur (`server-timeouts.ts`).

| Variante | Attendu |
|---|---|
| `GET /health` | `X-Content-Type-Options: nosniff`, `X-Frame-Options`, `Strict-Transport-Security`, `Cross-Origin-Resource-Policy: same-site`, **pas** de `X-Powered-By` |
| mêmes en-têtes sur un `401` ; CORS | toujours présents ; seule l'origine exacte autorisée reçoit `Access-Control-Allow-Origin` |
| route inconnue | `404` JSON `{ error: "NotFound" }` (pas de HTML Express) |
| `TRUST_PROXY=0`, 4 connexions avec des `X-Forwarded-For` différents (limite 3) | la 4e : `429` (l'en-tête est **ignoré**, on ne contourne pas la limite) |
| `TRUST_PROXY=1` | chaque IP annoncée a son compteur ; la même IP partage le sien |
| 4 connexions sur le **même e-mail** depuis 4 IP (limite 3) | la 4e : `429` + `Retry-After` ; un autre e-mail passe |
| `ALICE@x.com`, `  alice@x.com ` | même compteur que `alice@x.com` |
| bon mot de passe après la limite | refusé aussi (`429`) |
| clés Redis du palier `loginEmail` | **aucune adresse en clair** (empreinte hexadécimale) |
| corps sans e-mail exploitable | `400`, non compté |
| 2 transformations simultanées **à calculer**, plafond 1 | la 2e : `503 ServerBusy` + `Retry-After: 1`, sans traitement lancé |
| même transformation **déjà en cache**, plafond saturé | `200` `X-Cache: HIT` (le cache ne consomme pas de place) |
| succès, échec métier, panne technique | la place est toujours rendue ; le refus libère aussi le verrou du cache |
| client qui coupe un téléchargement d'image | aucune « erreur » journalisée, serveur sain |
| anonyme pendant la saturation | `401` (l'authentification passe avant le plafond) |
| fin du traitement, ou client qui coupe la connexion | la place est rendue |
| client qui envoie les **en-têtes** (ou le **corps**) goutte à goutte | connexion coupée en quelques secondes ; client normal servi |
| journaux (inscription, connexion ratée, JSON malformé, doublon, jeton falsifié) | ni mot de passe, ni jeton, ni empreinte de mot de passe |
| configuration | `TRUST_PROXY` entier 0-10 ; `MAX_CONCURRENT_TRANSFORMS` 1-64 ; limites e-mail positives |

Tests : `tests/e2e/hardening.test.ts` (vrai Redis), `tests/unit/infrastructure/` (`local-work-slots`, `by-email`), `tests/unit/application/transform-image.test.ts` (plafond), `tests/integration/server-timeouts.test.ts` (vrais sockets), `tests/unit/config.test.ts`.

**À tester à la main** (API lancée) :

```bash
# 1. En-têtes de sécurité
curl -si localhost:3000/health | grep -iE "x-content-type|x-powered|x-frame|strict-transport|cross-origin"
curl -s localhost:3000/nimporte                                    # {"error":"NotFound",...}

# 2. On ne peut pas falsifier son IP (TRUST_PROXY=0 par défaut) : changer X-Forwarded-For ne contourne pas la limite
for i in $(seq 1 12); do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/login \
  -H 'Content-Type: application/json' -H "X-Forwarded-For: 9.9.9.$i" -d '{"email":"a@b.co","password":"x"}'; done; echo   # 401 ... puis 429
#    Relancer l'API avec TRUST_PROXY=1 : chaque X-Forwarded-For compte comme un client distinct (la limite par IP ne bloque plus).

# 3. Limite par e-mail depuis plusieurs « IP » (API lancée avec TRUST_PROXY=1 RATE_LIMIT_LOGIN_EMAIL=3)
for i in 1 2 3 4; do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/login \
  -H 'Content-Type: application/json' -H "X-Forwarded-For: 9.9.9.$i" -d '{"email":"Cible@Example.com","password":"x"}'; done; echo   # 401 401 401 429
docker compose exec redis redis-cli --scan --pattern 'ips:ratelimit:loginEmail:*'   # une empreinte, pas l'e-mail

# 4. Saturation : API lancée avec MAX_CONCURRENT_TRANSFORMS=1, 6 transformations simultanées (paramètres différents, grande image)
for r in 10 20 30 40 50 60; do curl -s -o /dev/null -w "%{http_code} " -X POST localhost:3000/images/$IMG/transform \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"rotate\":$r}" & done; wait; echo   # un 201 et des 503

# 5. Dépendances
npm audit                                                          # 0 vulnerabilities

# 6. Test de charge (≈ 1 min 30, base et Redis de TEST, rien de votre base de dev n'est touché) — voir docs/LOAD_TESTING.md
npm run loadtest                                                   # tableau req/s + latences ; code de sortie 0 si aucune erreur inattendue
#    Pendant ce temps, regarder la mémoire du process (Activity Monitor / `top`) : elle doit rester stable.
#    Essayer : LOADTEST_CONNECTIONS=100 npm run loadtest -w apps/api  → plus de 503 sur le scénario saturé, les autres restent à 0 erreur.
```

Penser à supprimer les clés `ips:ratelimit:*` entre deux essais (`redis-cli --scan --pattern 'ips:ratelimit:*'`, puis `DEL`) : la fenêtre de 15 minutes de la limite par e-mail est longue.

## 13. Les trois niveaux de tests

| Niveau | Question posée | Outils | Exemple |
|---|---|---|---|
| **Unitaire** | « Cette règle métier est-elle juste ? » | fakes en mémoire, aucun réseau | `Rotation.create(720)` renvoie une erreur |
| **Intégration** | « Mon implémentation parle-t-elle bien à la vraie techno ? » | vrai PostgreSQL, vrai Redis, vrai disque, vrai `sharp` | le verrou Redis est exclusif |
| **E2E** | « Le parcours HTTP complet marche-t-il ? » | `supertest` sur l'app complète | 8 requêtes simultanées → 1 × 201 + 7 × 200 |

Deux idées pour **juger la qualité** d'un test :
- **Test de mutation (à la main)** : casser volontairement le code (retirer le verrou) et vérifier que le test
  *échoue*. Un test qui passe quand le code est cassé ne prouve rien (cela m'est arrivé pour la concurrence).
- **Fakes qui ressemblent au réel** : `InMemoryTransformCache` implémente vraiment un verrou et une attente.

## 14. Tester soi-même : parcours suggéré

1. `POST /register` deux fois avec le même e-mail → `409`.
2. `POST /login`, copier le jeton, le modifier d'un caractère → `401`.
3. `POST /images` avec un `.txt` renommé en `.jpg` → `415`.
4. `POST /images/:id/transform` avec `{ "rotate": 45, "format": "jpeg" }` → coins blancs ; ouvrir l'image.
5. Répéter la même transformation → `200` + `X-Cache: HIT`, comparer les temps de réponse.
6. Lancer 10 transformations identiques en parallèle (Postman Runner, ou `xargs -P`) → un seul `201`.
7. `docker compose stop redis`, relancer une transformation → fonctionne ; `GET /health` → `degraded`.
8. Se connecter avec un second compte et demander l'image du premier → `404`.
9. Avec `RATE_LIMIT_TRANSFORM=2`, faire 3 transformations → la 3e donne `429` + `Retry-After` ; attendre ce délai, ça repasse.
10. Dans le navigateur (app Angular), ouvrir l'onglet Réseau : les en-têtes `RateLimit-*` sont visibles dans les réponses de l'API.
11. Phase 6 : relancer l'API avec `TRUST_PROXY=1` et vérifier que `X-Forwarded-For` change alors le compteur (section 12), puis `MAX_CONCURRENT_TRANSFORMS=1` et saturer avec des requêtes parallèles.
