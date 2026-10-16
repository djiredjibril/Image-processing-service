# BullMQ : comprendre, utiliser, et où il sert dans ce projet

> Guide d'apprentissage, comme `docs/REDIS.md`. Il part de zéro, puis montre exactement comment BullMQ est
> utilisé dans *Image Processing Service* (phase 4).

---

## 1. Le problème : pourquoi une file d'attente ?

Aujourd'hui, `POST /images/:id/transform` **traite l'image pendant la requête** : le client attend, la connexion HTTP
reste ouverte, et un traitement lourd (grande image, filigrane, rotation) monopolise du CPU et jusqu'à ~1 Go de RAM
dans le process de l'API. Trois problèmes :

1. **Latence** : le client attend le résultat (parfois plusieurs secondes) ; un proxy ou un navigateur peut couper.
2. **Fragilité** : si l'API redémarre en plein traitement, le travail est perdu sans trace.
3. **Dimensionnement** : l'API (rapide, beaucoup de petites requêtes) et le traitement d'images (lourd, peu nombreux)
   ont des besoins opposés, mais ils vivent dans le même process.

La solution classique : le client dépose une **demande**, l'API répond tout de suite `202 Accepted` avec un
identifiant, et un **worker** (un autre process) exécute le travail en arrière-plan. Le client **interroge**
(« polling ») un endpoint de statut jusqu'à ce que ce soit fini.

```
client ──POST /images/:id/jobs──► API ──(1) écrit le job en base (queued)
                                      ──(2) met l'identifiant en file (Redis/BullMQ)
        ◄──────── 202 { id, status: "queued" }

worker ◄── prend le job dans la file ── (3) status = processing ── (4) transforme l'image
                                         (5) status = completed + id de l'image dérivée

client ──GET /jobs/:id──► API ──► lit le statut en base ──► { status, image? }   (répété jusqu'à "completed")
```

## 2. Le vocabulaire

| Terme | Sens | Dans le projet |
|---|---|---|
| **Producteur** (*producer*) | Celui qui dépose un job | l'API (`BullMqTransformJobQueue`) |
| **File** (*queue*) | Liste ordonnée de jobs en attente | `transform-image` (clés Redis `ips:bull:transform-image:*`) |
| **Worker** | Process qui prend les jobs et les exécute | `src/worker.ts` |
| **Job** | Une unité de travail (ici, une transformation) | `TransformJob` (domaine) + job BullMQ du même identifiant |
| **Tentatives** (*attempts*) | Combien de fois on essaie avant d'abandonner | `QUEUE_ATTEMPTS` (3) |
| **Backoff** | Attente croissante entre deux tentatives | exponentiel : 1 s, 2 s, 4 s... (`QUEUE_BACKOFF_MS`) |
| **Concurrence** | Jobs traités en même temps par un worker | `WORKER_CONCURRENCY` (2) |

BullMQ est une bibliothèque Node qui implémente tout cela **au-dessus de Redis** (listes, ensembles triés, scripts Lua
atomiques). Redis ne sert donc pas qu'au cache : il est aussi le « tableau d'affichage » des jobs.

## 3. Où dans le code ?

```
apps/api/
  db/migrations/003_create_transform_jobs.sql   table transform_jobs (statut = source de vérité)
  src/domain/
    entities/transform-job.ts                   machine à états : queued → processing → completed | failed
    repositories/transform-job-repository.ts    port : save, update, findById, delete
    ports/transform-job-queue.ts                port : enqueue(jobId)
    errors/job-errors.ts                        JobNotFound, InvalidJobTransition, QueueUnavailable
  src/application/use-cases/
    process-transform-job.ts                    ce que fait le worker pour UN job
  src/infrastructure/
    persistence/pg-transform-job-repository.ts  implémentation PostgreSQL
    queue/bull-connection.ts                    connexions Redis dédiées à BullMQ
    queue/bullmq-transform-job-queue.ts         producteur (Queue.add)
    queue/transform-worker.ts                   worker (Worker) + nouvelles tentatives
  src/worker.ts                                 point d'entrée du process worker (npm run worker)
```

Clean Architecture : le domaine et les use cases ne connaissent ni BullMQ ni Redis, seulement les ports
`ITransformJobQueue` et `ITransformJobRepository`. En test unitaire, la file est un faux en mémoire.

## 4. Les décisions de conception (et pourquoi)

### 4.1 PostgreSQL est la source de vérité du statut, BullMQ n'est que le transport
BullMQ garde aussi un état des jobs dans Redis, mais Redis est ici **jetable** (pas de persistance, on peut le vider).
Si le statut n'existait que là, un `FLUSHDB` effacerait l'historique et le client ne saurait plus où en est son job.
Le statut vit donc dans la table `transform_jobs` ; Redis ne porte que « il y a du travail à faire ». Conséquence :
BullMQ conserve très peu (`removeOnComplete` : 1 h ou 1000 jobs ; `removeOnFail` : 24 h).

### 4.2 On ne met en file que l'identifiant
La charge utile du job BullMQ est `{ jobId }`. Les paramètres (potentiellement un texte de filigrane) et le
propriétaire sont relus **en base** par le worker. Avantages : une seule source de vérité, rien de sensible dans Redis,
et le worker n'obtient jamais le propriétaire d'une donnée de la file (qui pourrait être falsifiée) : il utilise celui
enregistré en base.

### 4.3 Deux sortes d'échecs, deux traitements
| Échec | Exemple | Réessayer sert-il ? | Traitement |
|---|---|---|---|
| **Métier** | `rotate: 45.5`, image supprimée, fichier corrompu | Non, même résultat | Le job passe `failed` **tout de suite** (message client en base). Pour BullMQ, le travail est « terminé » : aucune nouvelle tentative |
| **Technique** | PostgreSQL ou le disque en panne | Oui, c'est peut-être passager | L'exception remonte : BullMQ réessaie avec *backoff* ; si les 3 tentatives échouent, le job passe `failed` (`ProcessingFailed`, message **générique**) |

Piège à retenir : *« completed » côté BullMQ ne veut pas dire « réussi » côté métier.* Le statut qui compte est celui
de la base.

### 4.4 La file est vitale : fail-closed (contraste avec Redis cache)
Pour le cache et le rate limiting, on a choisi **fail-open** : sans Redis, on continue sans cache. Ici c'est
l'inverse : sans file, le travail ne serait **jamais fait**. Si Redis est injoignable, `enqueue` renvoie
`QueueUnavailable` (en ~1 s au plus) et l'API répond `503` ; le job qui venait d'être écrit en base est supprimé.
On ne promet jamais un travail qu'on ne peut pas exécuter.

### 4.5 Idempotence : « au moins une fois » oblige à tolérer les doublons
Une file garantit en pratique « **au moins une fois** » : un job peut être livré deux fois (worker planté après avoir
fini mais avant d'avoir confirmé). Donc : (1) le job BullMQ reçoit **le même identifiant** que la ligne en base, et
BullMQ ignore un second ajout du même identifiant ; (2) `ProcessTransformJob` ne retraite pas un job déjà terminé ;
(3) la transformation elle-même passe par le cache et son verrou (phase 3) : même rejouée, elle ne crée pas de doublon.

### 4.6 Deux connexions Redis différentes
Le client du cache est « fail-fast » (`commandTimeout` 500 ms, `keyPrefix`). BullMQ refuse le `keyPrefix` d'ioredis (il a
son propre `prefix`, ici `ips:bull`), et le worker attend les jobs avec des commandes **bloquantes** qui exigent
`maxRetriesPerRequest: null` et aucun `commandTimeout`. D'où `bull-connection.ts` : une connexion « producteur »
(échoue vite) et une connexion « worker » (patiente et se reconnecte seule).

### 4.7 Concurrence basse et arrêt propre
Un traitement sharp peut prendre ~1 Go (image de 49 Mpx) : `WORKER_CONCURRENCY` reste bas (2). Pour plus de débit, on
lance **plusieurs process worker**, pas plus de threads dans un seul. À l'arrêt (`SIGINT`/`SIGTERM`), `worker.close()`
**attend la fin des jobs en cours** avant de quitter : on ne coupe pas une transformation à moitié.

## 5. Lancer et explorer

```bash
docker compose up -d                  # PostgreSQL + Redis
npm run migrate                       # crée la table transform_jobs
npm run dev -w apps/api               # l'API
npm run worker -w apps/api            # le worker, dans un AUTRE terminal (Ctrl+C = arrêt propre)
```

Variables : `QUEUE_ATTEMPTS`, `QUEUE_BACKOFF_MS`, `WORKER_CONCURRENCY` (voir `.env.example`).

Observer la file avec `redis-cli` (`docker compose exec redis redis-cli`) :

```
KEYS ips:bull:transform-image:*          # toutes les clés de la file
LLEN ips:bull:transform-image:wait       # jobs en attente
ZCARD ips:bull:transform-image:delayed   # jobs en attente d'une nouvelle tentative (backoff)
LLEN ips:bull:transform-image:active     # jobs en cours
ZCARD ips:bull:transform-image:failed    # jobs échoués définitivement
HGETALL ips:bull:transform-image:<jobId> # le job : on y voit data = {"jobId":"..."} et rien d'autre
```

Et en base : `SELECT id, status, attempts, error_kind FROM transform_jobs ORDER BY created_at DESC;`

## 6. À retenir

1. Une file découple **« demander »** de **« faire »** : réponse immédiate (`202`), travail en arrière-plan, process séparés.
2. BullMQ = file + workers + tentatives + backoff, **sur Redis**.
3. Le **statut** vit en base (durable) ; la file ne transporte que l'**identifiant**.
4. Échec **métier** = définitif tout de suite ; échec **technique** = nouvelle tentative avec attente croissante.
5. « Au moins une fois » impose l'**idempotence**.
6. Une file est **vitale** (fail-closed → 503) alors qu'un cache est facultatif (fail-open).
7. Concurrence basse, plusieurs process pour monter en charge, arrêt propre qui attend les jobs en cours.
