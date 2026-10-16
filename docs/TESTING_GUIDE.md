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
[11. Santé, CORS, config](#11-santé-cors-configuration) · [12. Les trois niveaux de tests](#12-les-trois-niveaux-de-tests) ·
[13. Tester soi-même](#13-tester-soi-même)

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

## 8. Rate limiting 🔜 (phase 3, branche suivante)

**Principe** : limiter le nombre de requêtes par fenêtre de temps ; au-delà → `429 Too Many Requests`.
Plan : compteur Redis à **fenêtre fixe** (`INCR` + `PEXPIRE`, atomique via script Lua), derrière un port
`IRateLimiter`, avec des paliers :

| Palier | Clé de comptage | Limite prévue |
|---|---|---|
| authentification (`/register`, `/login`) | adresse IP | 10 / min |
| upload | utilisateur | 20 / min |
| transformation | utilisateur | 10 / min |
| lecture (GET) | utilisateur | 300 / min |

Variantes qui seront à tester : dépasser la limite (429 + `Retry-After` + `RateLimit-*`), attendre la
réinitialisation de la fenêtre, deux utilisateurs indépendants, Redis arrêté (fail-open), limites configurables
par variables d'environnement.

*Pourquoi l'IP pour l'authentification ?* Avant la connexion on ne connaît pas l'utilisateur. Revers : derrière un
proxy, toutes les requêtes semblent venir de la même IP (`trust proxy`, traité en phase 6).

## 9. File d'attente (BullMQ) 🔜 (phase 4, pas commencée)

**À quoi ça servira** : aujourd'hui `POST /transform` traite l'image *pendant* la requête. En phase 4, l'API
répondra tout de suite `202 Accepted` avec un identifiant de job, un **worker** traitera l'image en arrière-plan, et le
client **interrogera** (`polling`) un endpoint de statut. BullMQ s'appuie sur Redis pour stocker les jobs.

Ce qu'on pourra alors tester : statuts d'un job (`waiting`, `active`, `completed`, `failed`), nouvelle tentative
après échec, plusieurs workers en parallèle, un job qui échoue toujours (file « morte »), l'arrêt propre d'un
worker, la cohérence avec le cache de la section 7.

> Rien de BullMQ n'existe dans le code : la règle du projet interdit d'implémenter une phase future.

## 10. Stockage ✅ (S3 🔜 phase 5)

**Implémentation** : le port `IFileStorage` (`put`, `get`, `delete`, `exists`) est défini dans le domaine ;
`LocalFileStorage` écrit sur disque. Les clés sont des chaînes (`originals/<uuid>.jpg`), jamais des chemins
absolus. Aucune route ni use case n'utilise `fs`.

| Variante | Attendu |
|---|---|
| `put` puis `get` | mêmes octets |
| `exists` avant/après `delete` | `true` / `false` |
| clé avec `..`, `/` initial ou `\` | `StorageKey` refuse de se construire (par construction), et `LocalFileStorage` revérifie le chemin (défense en profondeur) |
| `get` d'une clé absente | renvoie `null`, pas de crash |

Test : `tests/integration/local-file-storage.test.ts`. En phase 5, un `S3FileStorage` respectera le **même**
contrat, et les mêmes tests de contrat s'appliqueront.

## 11. Santé, CORS, configuration ✅

| Sujet | Variantes | Attendu |
|---|---|---|
| `GET /health` | tout va bien / Redis arrêté / PostgreSQL arrêté | `ok` / `degraded` (200) / `503` |
| CORS | origine autorisée, autre origine | l'en-tête n'est renvoyé que pour **une seule origine exacte** (`CORS_ORIGIN`) ; `X-Cache` exposé |
| Config | `JWT_SECRET` < 32 caractères, `PORT` hors plage, variable manquante | démarrage refusé avec un message clair (zod) |
| Migrations | rejouer, base vide | idempotentes, numérotées (`db/migrations/001_...`) |

Tests : `tests/e2e/health.test.ts`, `cors.test.ts`, `tests/unit/config.test.ts`, `tests/integration/migrator.test.ts`.

## 12. Les trois niveaux de tests

| Niveau | Question posée | Outils | Exemple |
|---|---|---|---|
| **Unitaire** | « Cette règle métier est-elle juste ? » | fakes en mémoire, aucun réseau | `Rotation.create(720)` renvoie une erreur |
| **Intégration** | « Mon implémentation parle-t-elle bien à la vraie techno ? » | vrai PostgreSQL, vrai Redis, vrai disque, vrai `sharp` | le verrou Redis est exclusif |
| **E2E** | « Le parcours HTTP complet marche-t-il ? » | `supertest` sur l'app complète | 8 requêtes simultanées → 1 × 201 + 7 × 200 |

Deux idées pour **juger la qualité** d'un test :
- **Test de mutation (à la main)** : casser volontairement le code (retirer le verrou) et vérifier que le test
  *échoue*. Un test qui passe quand le code est cassé ne prouve rien (cela m'est arrivé pour la concurrence).
- **Fakes qui ressemblent au réel** : `InMemoryTransformCache` implémente vraiment un verrou et une attente.

## 13. Tester soi-même : parcours suggéré

1. `POST /register` deux fois avec le même e-mail → `409`.
2. `POST /login`, copier le jeton, le modifier d'un caractère → `401`.
3. `POST /images` avec un `.txt` renommé en `.jpg` → `415`.
4. `POST /images/:id/transform` avec `{ "rotate": 45, "format": "jpeg" }` → coins blancs ; ouvrir l'image.
5. Répéter la même transformation → `200` + `X-Cache: HIT`, comparer les temps de réponse.
6. Lancer 10 transformations identiques en parallèle (Postman Runner, ou `xargs -P`) → un seul `201`.
7. `docker compose stop redis`, relancer une transformation → fonctionne ; `GET /health` → `degraded`.
8. Se connecter avec un second compte et demander l'image du premier → `404`.
