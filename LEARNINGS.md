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
