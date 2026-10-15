# Concepts appris

Journal des concepts rencontrés, feature par feature (ce que c'est, pourquoi, piège).

## Phase 1

### Feature 0 : socle technique (`feat/p1-foundation`)

1. **`Result<T, E>` (Ok/Err)** : les erreurs métier prévisibles deviennent des valeurs que le
   compilateur oblige à traiter, alors qu'un `throw` est invisible dans les types. `throw`
   reste réservé aux vraies pannes (bug, infrastructure).
2. **Fail fast sur la config (zod)** : on valide les variables d'environnement au démarrage
   et on refuse de démarrer si elles sont invalides. `loadConfig` renvoie un `Result` pour
   rester testable ; c'est `main.ts` qui décide de quitter.
3. **Migrations en transaction** : chaque migration et son enregistrement dans
   `schema_migrations` sont dans le même `BEGIN`/`COMMIT`. Un échec fait un `ROLLBACK`
   complet : jamais d'état à moitié migré.
4. **Pool de connexions `pg`** : il réutilise les connexions ouvertes au lieu d'en créer une
   par requête. Piège : il faut le fermer proprement à l'arrêt (`pool.end()`).
5. **Séparer `createApp()` de `listen()`** : `supertest` teste l'app sans ouvrir de port, et
   la composition root injecte la base voulue (dev ou test).

### Feature 1 : inscription (`feat/p1-register-user`)

1. **Où vit `Result` ?** Le domaine renvoie des `Result` mais ne doit rien importer d'extérieur :
   le type est défini dans `domain/shared` et ré-exporté par `application/shared`. Un conflit
   entre deux règles se résout en déplaçant le code, pas en cassant le sens des dépendances.
2. **Value Object = invariant garanti par construction** : `Email.create()` normalise et valide,
   donc un `Email` existant est toujours valide. `PasswordHash` distingue un hash d'une `string`
   et masque sa sérialisation (`toJSON`) pour qu'il ne fuite ni en réponse ni en log.
3. **Course critique (race condition)** : vérifier `findByEmail` puis insérer ne suffit pas, deux
   requêtes simultanées peuvent passer. La vraie garantie est la contrainte `UNIQUE` en base ;
   le repository traduit l'erreur Postgres `23505` en `EmailAlreadyUsedError`.
4. **Hachage argon2id** : lent et gourmand en mémoire par conception (anti force brute/GPU),
   salé automatiquement. D'où : valider le mot de passe AVANT de hacher.
5. **Un seul traducteur erreur → HTTP** (`error-mapping.ts`) avec un `switch` exhaustif sur `kind` :
   si on ajoute une erreur, le compilateur signale l'oubli. Piège de test : un test qui
   `DROP` une table partagée casse les autres, d'où un schéma dédié pour le test du migrator.

### Feature 2 : connexion et middleware JWT (`feat/p1-login-user`)

1. **Anti-énumération** : une seule `InvalidCredentialsError` pour e-mail mal formé, inconnu ou
   mauvais mot de passe, et même réponse HTTP 401 : l'attaquant ne peut pas deviner quels comptes existent.
2. **Attaque par le temps (timing)** : un e-mail inconnu répondrait plus vite (pas de hachage). On
   vérifie donc un hash factice (calculé une fois) pour égaliser le temps de réponse.
3. **JWT** : un jeton signé (HS256) contient `sub` (id utilisateur) et `exp`. Le serveur ne stocke rien
   (stateless) : il vérifie seulement la signature. Piège : accepter uniquement l'algorithme attendu
   (sinon `alg: none` ou un changement d'algorithme contourne la signature) et exiger `exp`.
4. **Le port `ITokenService`** garde le domaine ignorant de JWT ; `verify` renvoie `null` au lieu de
   lever une erreur pour un jeton invalide (un jeton invalide est un cas normal, pas une panne).
5. **Middleware** : lit `Authorization: Bearer`, place l'identité dans `req.auth` (augmentation de
   type Express), répond 401 + `WWW-Authenticate: Bearer`. Il ne logge jamais le jeton.

### Feature 3 : upload d'image (`feat/p1-upload-image`)

1. **Magic bytes** : l'extension et le `Content-Type` viennent du client, donc falsifiables. Le vrai type se lit
   dans les premiers octets (JPEG `FF D8 FF`, PNG `89 50 4E 47…`, WebP `RIFF….WEBP`), puis le décodeur confirme.
2. **Deux limites, deux protections** : le poids (413, borné dès la lecture par multer) protège le réseau et la RAM
   de transit ; les dimensions protègent contre les « decompression bombs » (un petit PNG qui décode en Go de
   pixels). `sharp.metadata()` ne lit que l'en-tête, sans décoder les pixels. 413 pour les dimensions : requête
   bien formée mais ressource trop grande, comme pour le poids.
3. **Compensation (saga locale)** : disque et base n'ont pas de transaction commune. On écrit le fichier, puis la
   ligne ; si la ligne échoue, on supprime le fichier et on relance l'erreur. Sinon : fichier orphelin. Le nettoyage
   est « au mieux » : son échec ne doit pas masquer l'erreur d'origine.
4. **Clés de stockage générées** : `originals/<uuid>.<ext>` ; jamais le nom du client (path traversal, collisions).
   `LocalFileStorage` écrit avec le drapeau `wx` (jamais d'écrasement : l'original est immuable) et vérifie que le
   chemin résolu reste dans la racine (défense en profondeur).
5. **Détails qui piègent** : l'orientation EXIF inverse largeur et hauteur d'une photo de téléphone (on lit les
   dimensions après orientation) ; l'authentification passe AVANT multer pour ne pas lire le fichier d'un inconnu ;
   multer en `memoryStorage` garde le fichier en RAM, d'où la limite de poids.

### Feature 4 : lecture d'une image (`feat/p1-get-image`)

1. **Autorisation par propriétaire = 404, pas 403** : un 403 confirmerait que l'image existe (fuite d'information).
   Image inconnue, UUID invalide et image d'autrui donnent la même réponse. C'est le use case qui compare `owner_id`.
2. **Streaming** : on renvoie un flux (`createReadStream` → `pipeline` → réponse) au lieu de lire tout le fichier en
   mémoire. La RAM utilisée ne dépend plus de la taille du fichier. `pipeline` gère aussi la fermeture des
   flux et les erreurs en cours d'envoi (après l'envoi des en-têtes, on ne peut plus changer le statut).
3. **Valider l'identifiant avant la base** : un `id` qui n'est pas un UUID ferait lever une erreur SQL
   (`invalid input syntax for type uuid`), donc un 500. On le valide (zod) et on répond 404.
4. **En-têtes de sécurité** : `Content-Type` déduit du format STOCKÉ (pas d'une extension) et
   `X-Content-Type-Options: nosniff` pour que le navigateur n'interprète pas le fichier autrement.
5. **Incohérence base/stockage** : si la ligne existe mais que le fichier a disparu, on répond 404 et on LOGGE
   l'anomalie côté serveur : c'est un problème d'exploitation, pas une erreur du client.

### Feature 5 : liste paginée (`feat/p1-list-images`)

1. **Pagination `LIMIT/OFFSET`** : `offset = (page - 1) * limit`. Le plafond (`limit` <= 50) est un invariant du value
   object `Pagination` : sans lui, un client pourrait demander toute la table. Hors bornes = 400, pas de correction silencieuse.
2. **Ordre stable** : trier seulement par `created_at` est ambigu si deux lignes ont la même date, et une image
   peut alors apparaître sur deux pages (ou aucune). On ajoute l'`id` comme critère de départage.
3. **Total** : le client a besoin de `total` pour calculer le nombre de pages. `count(*)` est un `bigint` que `pg` renvoie
   en chaîne (pour ne pas perdre de précision) : il faut le convertir. Une page au-delà de la fin renvoie `items: []` mais le bon total.
4. **Isolation par propriétaire dans la requête** (`WHERE owner_id = $1`), jamais en filtrant en mémoire après coup :
   le total et les lignes ne fuient rien d'un autre utilisateur. Index `(owner_id, created_at DESC)` pour servir ce tri.
5. **Validation en deux temps** : zod convertit la query string (toujours des chaînes) en nombres avec leurs défauts ;
   le domaine impose les bornes. Piège : `?page=1&page=2` donne un tableau, et `?limit=` donne `0` : tout doit finir en 400.
   Refactor : `ImageSummary` partagé évite de dupliquer la forme publique d'une image entre upload et liste.

### Monorepo (`chore/monorepo-structure`)

1. **npm workspaces** : un `package.json` racine déclare `workspaces: ["apps/*"]` ; `npm install` installe tout en une
   fois dans un seul `node_modules` partagé (les dépendances communes sont hissées à la racine). Un seul
   `package-lock.json` pour tout le dépôt.
2. **Scripts délégués** : `npm run test --workspaces --if-present` lance le script dans chaque application qui le
   définit ; `-w apps/api` cible un seul workspace. Le répertoire courant devient celui du workspace (d'où les
   chemins relatifs `db/migrations`, `.env` et `storage/` qui continuent de fonctionner sans modification de code).
3. **`git mv` conserve l'historique** (`git log --follow`) ; une restructuration doit être un commit à part,
   sans changement de comportement, avec la même suite de tests verte avant et après (ici : 137 tests).
4. **Infra partagée à la racine** (`docker-compose.yml`, Postman) : elle ne dépend d'aucune application en particulier.

### CORS (`feat/api-cors`)

1. **Origine = schéma + hôte + port.** `http://localhost:4200` (Angular) et `http://localhost:3001` (API) sont deux origines
   différentes : le navigateur bloque la lecture de la réponse tant que l'API ne l'autorise pas explicitement (CORS).
2. **CORS protège l'utilisateur dans le navigateur, pas l'API.** Curl ou un autre serveur ignorent CORS : l'API reste
   protégée par son authentification (un test le vérifie : 401 même depuis l'origine autorisée).
3. **Requête « preflight »** : avant un POST avec en-tête `Authorization`, le navigateur envoie un `OPTIONS` SANS jeton
   pour demander la permission. Le middleware CORS doit donc passer AVANT l'authentification, sinon il serait refusé en 401.
4. **Liste blanche stricte** : une seule origine exacte (jamais `*`, validée au démarrage), méthodes `GET`/`POST`,
   en-têtes `Authorization`/`Content-Type`, `Vary: Origin`. Pas de `credentials` : l'API utilise un jeton Bearer, pas de cookie.
5. **Piège de la bibliothèque** : avec `origin: "<chaîne>"`, `cors` renvoie TOUJOURS cette origine, même à un tiers (le
   navigateur bloque quand même). Une fonction de comparaison stricte ne renvoie aucun en-tête aux origines inconnues.

### Application web Angular + Tailwind (`feat/web-app`)

1. **Une balise `<img>` ne peut pas envoyer `Authorization`.** Pour afficher une image protégée, on la télécharge avec
   `HttpClient` en `blob` (l'intercepteur ajoute le jeton), puis on crée une URL locale `URL.createObjectURL(blob)`.
   Piège : cette URL garde le blob en mémoire tant qu'elle n'est pas révoquée (`revokeObjectURL`) : le composant la libère
   quand l'identifiant change ou quand il est détruit. Conséquence : il n'y a pas de miniature côté serveur, la galerie
   télécharge les images en taille réelle (les transformations de la phase 2 pourront y remédier).
2. **Intercepteur HTTP fonctionnel** : un point unique ajoute `Bearer <jeton>` et traite le 401 (déconnexion + retour
   à `/login`). Il n'envoie le jeton QU'À l'URL de l'API (jamais à un autre domaine) et ne redirige pas sur un 401 sans
   jeton (mauvais mot de passe à la connexion : c'est une erreur de formulaire, pas une session expirée).
3. **Guards = ergonomie, pas sécurité** : `authGuard` masque les pages privées, mais seule l'API protège vraiment les
   données (elle exige un jeton valide et filtre par propriétaire). Tout ce qui tourne dans le navigateur peut être contourné.
4. **Stockage du jeton** : `localStorage` est simple mais lisible par du JavaScript injecté (XSS). Un cookie `HttpOnly`
   serait plus sûr, mais impose cookies + protection CSRF côté API. Compromis assumé pour un projet d'apprentissage local.
5. **Signals + mode sans zone** : l'état (`signal`, `computed`) pilote l'affichage sans `zone.js` ; un `effect` avec
   `onCleanup` gère le téléchargement annulable. Le contrôle de fichier côté navigateur (type, poids) n'est qu'un
   confort : l'API revérifie tout (magic bytes, poids, dimensions). Tailwind v4 se branche via PostCSS (`@import 'tailwindcss'`).
