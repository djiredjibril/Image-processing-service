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
