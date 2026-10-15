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
