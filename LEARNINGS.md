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

### Transformations d'images (`feat/p2-transform-image`)

1. **L'ordre des opérations change le résultat.** Recadrer puis tourner n'est pas tourner puis recadrer (les coordonnées du crop
   ne désignent pas la même zone). L'ordre est fixé et documenté : orientation EXIF → crop → rotate → flip → mirror → resize →
   filtre → encodage. Avec `sharp`, c'est l'ordre des appels qui compte ; on l'a vérifié avec de vrais pixels (image à quatre
   quadrants colorés : « le rouge passe en haut à droite après une rotation de 90° horaire »), pas seulement avec des tailles.
2. **L'original est immuable, la transformation est une nouvelle ressource.** Le dérivé a sa propre ligne (`original_id`), son
   propre fichier (`derived/<uuid>.<ext>`), et la même compensation que l'upload (fichier supprimé si la base échoue,
   factorisée dans `storeImage`). Un dérivé de dérivé pointe vers l'ORIGINAL racine : on retrouve toujours la source d'origine.
3. **Valider en couches.** zod contrôle la forme (types, champs inconnus refusés avec `strictObject`) ; les value objects
   contrôlent les bornes et les valeurs autorisées ; `TransformationSet.checkAgainst` contrôle la cohérence avec l'image
   (crop dans l'image, qualité inutile pour un PNG) ; le résultat est contrôlé en sortie (taille maximale).
4. **Piège JPEG et transparence.** Le JPEG n'a pas de canal alpha. Les coins vides d'une rotation libre sortaient NOIRS : `sharp`
   aplatit avant d'agrandir le canevas, donc le fond transparent était supprimé à l'encodage. Correction : un fond blanc opaque
   dès le départ quand la sortie est JPEG. Un test sur les pixels l'a révélé ; la tolérance de couleur doit rester large
   (le JPEG est avec perte : le blanc dérive près des zones colorées) mais très loin du noir.
5. **Sécurité des images.** L'EXIF (donc le GPS) est supprimé : on applique d'abord l'orientation, sinon la photo se retrouverait
   couchée, puis `sharp` ne conserve aucune métadonnée. Une rotation à 45° agrandit le canevas (jusqu'à ×1,41 par côté) : la
   taille du résultat est limitée, sinon un client pourrait obtenir une image bien plus grande que la limite. Observé : transformer
   une image de 7000×7000 (49 Mpx) prend ~0,3 s mais le process monte à ~1,1 Go de mémoire. Le traitement est ici synchrone ;
   les phases 4 (file d'attente, concurrence limitée) et 6 (durcissement) devront borner cela.

### Filigrane texte (`feat/p2-watermark`)

1. **Un texte envoyé par l'utilisateur qui finit dans un document SVG est une entrée dangereuse (injection SVG/XML).** Deux défenses
   cumulées : une LISTE BLANCHE de caractères dans le value object (lettres, chiffres, espace, ponctuation courante : ni `<`, `>`,
   guillemet double, saut de ligne, ni caractère de contrôle) et l'ÉCHAPPEMENT systématique à l'insertion (`&` en premier pour ne
   pas doubler les autres entités). Chacune suffit seule à bloquer l'attaque ; on garde les deux (défense en profondeur) et on
   teste chacune séparément (un test de mutation prouve que retirer l'échappement fait échouer le test).
2. **Compter des caractères, ce n'est pas compter des octets ni des points de code.** « é » peut être un caractère ou deux points
   de code (e + accent combiné). `Intl.Segmenter` compte les caractères visibles (graphèmes) ; `[...texte].length` est piégeux.
3. **La taille finale n'est connue qu'après le calcul du pipeline** (rotation, resize...). Pour dimensionner le calque, on matérialise
   d'abord l'image en pixels bruts (sans perte), puis on superpose le SVG aux dimensions exactes. Coût : un tampon de plus en
   mémoire, seulement quand un filigrane est demandé.
4. **Ordre : le filigrane vient après resize et filtre.** Après le resize, sa taille suit l'image finale ; après le filtre, il
   garde sa couleur (un sépia ne le teinte pas). Un test de pixels sur fond noir (tout pixel clair vient du filigrane) vérifie la
   position, l'opacité et l'ordre.
5. **Dépendance cachée : les polices.** `sharp` dessine le texte du SVG avec les polices du système ; ça marche sur ce Mac, mais un
   serveur minimal (conteneur sans police) peut ne rien afficher. À vérifier avant tout déploiement. Le texte est réduit pour tenir
   dans la largeur de l'image, sans descendre sous une taille minimale lisible.

## Phase 3

### Fondations Redis (`feat/p3-redis-foundation`)

1. **Cache et compteurs = optimisations, pas source de vérité.** PostgreSQL reste la référence ; Redis peut tomber sans
   que l'API s'arrête. D'où un client réglé pour ÉCHOUER VITE : `enableOfflineQueue: false` (une commande sans connexion est
   rejetée tout de suite au lieu d'attendre dans une file, ce qui bloquerait les requêtes HTTP), `commandTimeout: 500` ms
   (un Redis qui ne répond plus ne ralentit pas l'API) et reconnexion automatique avec délai croissant.
2. **Un événement `error` non écouté plante Node.** Les clients Redis sont des « EventEmitter » : sans écouteur `error`, une
   connexion refusée fait tomber tout le process. On l'écoute et on ne logge que la première erreur d'une panne et le retour
   à la normale (pas un message par tentative de reconnexion).
3. **Piège de démarrage révélé par un test** : sans file d'attente hors-ligne, une commande envoyée avant la fin de la connexion
   échoue. D'où `waitForRedis` : attente brève au démarrage, jamais bloquante si Redis est absent (l'API démarre « degraded »).
4. **Santé à deux niveaux** : `/health` renvoie 503 si PostgreSQL tombe (indispensable) mais 200 « degraded » si seul Redis tombe
   (service dégradé, pas interrompu).
5. **Isolation des tests** : base Redis 1 pour les tests (0 pour le dev), préfixe de clés `ips:`, et un garde-fou qui refuse de
   vider (`FLUSHDB`) la base si l'URL de test pointait par erreur sur la base 0. Port hôte 6380 (comme 5433 pour Postgres) pour
   ne pas entrer en conflit avec d'autres projets locaux. Pas de persistance : des données jetables n'en ont pas besoin.

### Cache des transformations (`feat/p3-transform-cache`)

1. **On met en cache un INDEX, pas les octets** : `clé → identifiant du dérivé`. Les images restent dans le stockage et la base ;
   Redis n'économise que le recalcul (et évite les doublons). Avant de servir une entrée, on la revérifie en base (le dérivé existe
   encore ? même propriétaire ? même racine ?) : une entrée périmée ou « empoisonnée » est ignorée, jamais crue sur parole.
2. **La clé doit être canonique.** Deux demandes qui donnent forcément le même résultat doivent produire la même clé (valeurs par défaut
   explicites ou omises, `flip: false` ≡ absent, -90° ≡ 270°), sinon le cache rate des occasions. Pour qu'elle soit stable on
   hache un tableau POSITIONNEL (ordre fixé par construction) et non un objet. La clé contient l'utilisateur (aucune fuite entre
   comptes) et une VERSION du traitement : changer le pipeline sans incrémenter la version servirait d'anciens résultats.
3. **Cache stampede (ruée).** À froid, N requêtes identiques simultanées font toutes un MISS et calculent N dérivés. Remède :
   un verrou par clé (`SET key jeton NX PX ttl`, atomique) ; le détenteur calcule, les autres attendent le résultat. Détails qui comptent :
   le verrou EXPIRE seul (le détenteur peut planter), on le libère avec un script Lua qui vérifie le jeton (un détenteur lent ne doit pas
   supprimer le verrou d'un autre), on RELIT le cache après avoir obtenu le verrou (double vérification), et l'attendant abandonne dès
   que le verrou disparaît sans résultat. On n'écrit dans le cache qu'APRÈS l'enregistrement en base : une clé ne pointe jamais vers rien.
4. **Un test qui passe n'est pas forcément un bon test.** Mon premier test de concurrence passait même sans verrou : l'image de test
   était si petite que la 1re requête finissait avant l'arrivée des autres. On l'a détecté en désactivant le verrou (test de mutation) puis
   corrigé avec une grande image (8 × 201 sans verrou, 1 × 201 + 7 × 200 avec). Vérifier qu'un test ÉCHOUE quand on casse le code.
5. **Fail-open et sémantique HTTP.** Si Redis tombe, le cache se comporte comme un cache vide (aucune méthode ne lève) et la transformation
   se fait quand même. Un HIT renvoie 200 (rien n'a été créé) et non 201, avec `X-Cache: HIT|MISS` ; cet en-tête doit être listé dans
   `Access-Control-Expose-Headers` sinon le navigateur le masque au JavaScript. Mesuré : MISS 145 ms, HIT 4,6 ms (×30).

### Rate limiting (`feat/p3-rate-limiting`)

1. **Fenêtre fixe avec un compteur atomique.** `INCR` crée et incrémente la clé ; la 1re requête pose l'expiration (`PEXPIRE`) qui
   constitue la fenêtre. Les deux étapes sont dans UN script Lua : si le process s'arrêtait entre `INCR` et `PEXPIRE`, la clé n'expirerait
   jamais et l'utilisateur serait bloqué à vie. Compromis connu : jusqu'à 2× la limite à cheval sur deux fenêtres (une fenêtre glissante
   l'évite, au prix de plus de complexité).
2. **À qui compte-t-on ?** Avant la connexion on ne connaît que l'IP (palier `auth`, par IP) ; après, on compte par utilisateur. Un
   palier par type de coût (transformation = cher → 10/min ; lecture = bon marché → 300/min). Le palier par utilisateur doit passer
   APRÈS l'authentification, sinon on ne sait pas qui compter, et un 401 ne consomme aucun quota.
3. **Les bons codes et en-têtes.** `429` + `Retry-After` (secondes) disent au client QUAND réessayer ; `RateLimit-Limit/Remaining/Reset`
   lui permettent de s'auto-limiter. Comme pour `X-Cache`, ils doivent figurer dans `exposedHeaders` de CORS sinon le navigateur les masque.
4. **Fail-open pour une protection aussi.** Si Redis tombe, mieux vaut ne plus limiter que couper tout le service (le limiteur renvoie
   `null` = « pas de décision »). Revers : pendant la panne, plus de protection (à surveiller en production).
5. **Un test de contrat partagé.** Le même jeu de tests (`rate-limiter-contract.ts`) vérifie le fake en mémoire (horloge truquée) ET
   Redis (vraie attente) : le fake ne ment pas sur le comportement. Test de mutation : retirer `PEXPIRE` seul ne casse rien (la garde
   `ttl < 0` le compense : « mutant équivalent ») ; retirer les deux fait échouer 4 tests. Piège macOS : `sed -i` y exige une syntaxe
   différente et une mutation « appliquée » peut en réalité ne rien changer, vérifier qu'elle a bien eu lieu.

## Phase 4

### File d'attente, worker et jobs (`feat/p4-job-queue`)

1. **Pourquoi une file.** Découpler « demander » de « faire » : l'API répond tout de suite, un worker (autre process) exécute.
   On gagne en latence perçue, en robustesse (un redémarrage ne perd pas le travail) et en dimensionnement (API et traitement
   d'images n'ont pas les mêmes besoins). BullMQ = file + workers + tentatives + backoff, sur Redis.
2. **Statut en base, transport dans la file.** Redis est jetable : le statut (`queued → processing → completed | failed`) vit en
   PostgreSQL, et la file ne transporte que l'identifiant du job (rien de sensible dans Redis, une seule source de vérité,
   et le propriétaire est relu en base, jamais pris dans la file).
3. **Échec métier ≠ échec technique.** Paramètres invalides : réessayer redonnerait la même erreur → `failed` immédiat, la file
   considère le travail terminé. Base ou disque en panne : on laisse l'exception remonter, BullMQ réessaie avec backoff exponentiel,
   et seul l'épuisement des tentatives marque `failed` (message générique). « completed » côté BullMQ ≠ « réussi » côté métier.
4. **« Au moins une fois » exige l'idempotence.** Un job peut être livré deux fois : même identifiant côté BullMQ (le doublon est
   ignoré), `ProcessTransformJob` ne retraite pas un job terminé, et la transformation passe par le cache et son verrou.
5. **Fail-closed pour une file, fail-open pour un cache.** Sans file, le travail ne se ferait jamais : on répond 503 plutôt que de
   promettre. Piège rencontré : `queue.add` attend LUI-MÊME la connexion sans limite de temps, donc avec Redis arrêté la requête
   restait suspendue ; un test d'intégration l'a révélé (timeout), corrigé en vérifiant la connexion (~1 s) et en bornant l'appel.
   BullMQ impose aussi ses propres connexions (`maxRetriesPerRequest: null`, pas de `commandTimeout`, pas de `keyPrefix`).

### API asynchrone : 202 + polling (`feat/p4-async-transform-api`)

1. **`202 Accepted` + `Location` + polling.** `202` = « demande acceptée, pas encore faite » (à ne pas confondre avec `201` « créé »). `Location`
   dit où suivre la ressource, `GET /jobs/:id` est rappelé par le client jusqu'à un statut final. Le polling est répétitif : il compte dans un quota « lecture » large.
2. **Valider tôt (fail fast), revalider tard.** Les paramètres invalides reçoivent un `400` immédiat plutôt qu'un job qui échouera, mais le worker
   revérifie tout : entre la demande et le traitement, l'image peut avoir été supprimée.
3. **Ordre et compensation.** Écrire en base PUIS mettre en file (un worker ne reçoit jamais un identifiant inconnu) ; si la file échoue, supprimer le job
   (pas d'orphelin `queued`). Même motif que la compensation de l'upload : deux systèmes (PostgreSQL, Redis) ne partagent pas de transaction.
4. **Pas de contournement des quotas.** Créer un job consomme le même quota que la transformation synchrone ; sinon l'endpoint asynchrone serait une porte dérobée.
5. **Ce que la vérification manuelle a trouvé et que les tests n'avaient pas vu** : le point d'entrée du worker ne chargeait pas le `.env` (les tests n'exécutent
   pas `worker.ts`), et un double `SIGTERM` (relayé par `tsx`) fermait deux fois le pool PostgreSQL et plantait l'arrêt. Lancer vraiment le programme reste indispensable.

## Phase 5

### Stockage objet S3 (`feat/p5-s3-storage`)

1. **Le stockage objet et l'API S3.** Des objets (fichier + métadonnées) rangés par clé dans des buckets, accessibles par le réseau : partagé entre
   machines, ce que le disque local ne permet pas. S3 est devenu un standard imité par SeaweedFS, Garage, MinIO, R2... : coder contre l'API évite de
   dépendre d'un fournisseur. Pas de vrais dossiers : `originals/x.png` est UNE clé.
2. **Le port a payé.** `IFileStorage` existait depuis la phase 1 : `S3FileStorage` s'est ajouté sans toucher un use case ni une route, et une fabrique
   (`createFileStorage`) choisit l'implémentation, la même pour l'API et le worker. Un test de CONTRAT partagé (disque et S3) prouve l'interchangeabilité.
3. **Immutabilité atomique.** `If-None-Match: *` (412 si la clé existe) remplace « `exists` puis `put` », qui laissait une course entre deux écritures
   simultanées. Même idée que le drapeau `wx` du disque ; testé avec 5 écritures simultanées.
4. **Pièges d'un service tiers.** Une erreur 500 opaque (`No free volumes left`) s'est résolue en lisant les LOGS du service (SeaweedFS réserve ~7 volumes
   par bucket). Et « healthy » ≠ « prêt » : le healthcheck testait le master mais pas la passerelle S3 ; il teste maintenant le bon port, en `127.0.0.1`
   (`localhost` peut viser IPv6). L'application réessaie aussi au démarrage.
5. **Vital, donc fail-closed.** Sans stockage, rien ne marche : on refuse de démarrer plutôt que de démarrer cassé. Les identifiants S3 viennent de
   l'environnement, ne sont jamais journalisés, et le compte de dev du `docker-compose` n'est valable qu'en local.

### URLs présignées (`feat/p5-presigned-urls`)

1. **Déléguer le téléchargement au stockage.** L'API n'autorise plus que « qui a le droit ? » et délivre une URL de courte durée ; le navigateur télécharge ensuite
   directement depuis S3 : l'API ne porte plus la bande passante des images.
2. **SigV4 en une phrase.** La signature est un HMAC calculé avec le secret (qui ne quitte jamais l'API) sur l'hôte, le chemin, la clé et la durée : le stockage refait le calcul,
   donc modifier UN caractère (clé, durée, hôte) donne un 403, comme l'expiration. Elle est calculée localement, sans appel réseau. Vérifié contre un vrai SeaweedFS.
3. **Une URL signée est une permission portée par l'URL** (*bearer capability*) : à ne délivrer qu'après l'autorisation (404 pour autrui, avant même de regarder si le stockage sait
   signer), de courte durée, jamais journalisée, en `Cache-Control: no-store`, et non révocable avant l'expiration.
4. **L'hôte est signé.** On ne peut pas signer avec une adresse interne puis la « corriger » : d'où `S3_PUBLIC_ENDPOINT` et un second client S3 réservé à la signature.
5. **Capacité optionnelle d'un port.** Le disque ne sait pas signer : le signeur est `null` et la route répond `501 Not Implemented`, au lieu de faire semblant. Les tests
   (mutation) ont confirmé que l'ordre « autorisation puis capacité » est bien vérifié.

## Phase 6

### Durcissement sécurité (`feat/p6-security-hardening`)

1. **Raisonner menace → défense → preuve.** Une carte (`docs/SECURITY.md`) relie chaque attaque (brute-force, falsification d'IP, slowloris, épuisement de RAM...) à sa défense, au code et au test.
2. **Ne jamais croire `X-Forwarded-For`.** Un client peut l'écrire lui-même : on ne le lit qu'à travers un nombre DÉCLARÉ de proxies (`TRUST_PROXY`). Trop bas, tout le monde partage l'IP du proxy ;
   trop haut, on contourne le rate limiting. Défaut prudent (0) et test du contournement.
3. **Limiter aussi par cible.** La limite par IP n'arrête pas un botnet qui vise UN compte : limite par e-mail (empreinte SHA-256, normalisée, jamais l'adresse en clair dans Redis). Compromis assumé : on peut
   bloquer exprès un compte (déni de service ciblé).
4. **Borner le temps et la mémoire.** Délais serveur (en-têtes, requête, keep-alive) contre le slowloris ; plafond de concurrence (503 immédiat plutôt qu'une file qui garde la RAM occupée), relâché sur `close`
   même si le client coupe. Le rate limiting borne le NOMBRE par minute, pas le nombre EN MÊME TEMPS.
5. **Des tests qui prouvent vraiment.** Mon premier test de saturation dépendait du temps de calcul de sharp et la mutation « plafond avant authentification » survivait ; remplacé par un faux processeur « à porte »
   (déterministe). Le test des délais ne distinguait pas `headersTimeout` de `requestTimeout` : réglé pour qu'un seul agisse à la fois. Autre piège : un `keys()` ioredis avec `keyPrefix` ne renvoyait rien, donc un
   test « zéro clé » passait à vide ; un témoin positif l'a démasqué.

