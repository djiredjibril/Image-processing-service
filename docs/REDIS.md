# Redis : comprendre, utiliser, et où il sert dans ce projet

> Guide d'apprentissage. Il part de zéro, puis montre exactement comment Redis est
> utilisé dans *Image Processing Service*.

---

## 1. C'est quoi Redis ?

Redis est une **base de données en mémoire (RAM)** de type **clé → valeur**.

| | PostgreSQL | Redis |
|---|---|---|
| Stockage | disque (durable) | RAM (ultra rapide) |
| Modèle | tables, relations, SQL | clés → valeurs (chaînes, listes, hash, ensembles...) |
| Vitesse typique | quelques ms | **moins d'1 ms** |
| Rôle idéal | la **vérité** (comptes, images) | ce qui est **temporaire ou rapide** (cache, compteurs, verrous) |
| Si on perd tout | catastrophe | on peut reconstruire |

Image mentale : PostgreSQL est ton **classeur d'archives**, Redis est le **post-it collé
sur ton écran**. Le post-it est instantané à lire, mais on ne lui confie rien d'irremplaçable.

Exemples d'interaction (dans `redis-cli`) :

```
SET ips:demo "bonjour"        → OK
GET ips:demo                  → "bonjour"
SET ips:demo "x" EX 10        → la clé disparaît seule après 10 secondes (TTL)
INCR ips:compteur             → 1, puis 2, puis 3... (atomique)
DEL ips:demo                  → supprime la clé
```

## 2. Pourquoi l'utiliser ici ?

Trois besoins que PostgreSQL gère mal ou trop lentement :

1. **Cache** : éviter de refaire une transformation d'image coûteuse (sharp utilise du CPU
   et de la RAM) quand on redemande exactement la même.
2. **Verrou distribué** : si 8 requêtes identiques arrivent en même temps, n'en traiter
   qu'une seule (anti « cache stampede »).
3. **Rate limiting** : compter les requêtes par minute et par
   utilisateur. Il faut un compteur très rapide, atomique, qui s'efface tout seul.

Les trois reposent sur deux propriétés de Redis : **la vitesse** et **l'expiration
automatique (TTL)**.

## 3. Où est-il dans le projet ?

```
docker-compose.yml                         Redis 7 (image redis:7-alpine), port 6380
apps/api/src/
  domain/ports/transform-cache.ts          ITransformCache : le contrat (le domaine ignore Redis)
  domain/value-objects/transform-cache-key.ts   calcule la clé de cache (SHA-256)
  infrastructure/cache/redis-client.ts     création du client ioredis, santé, attente au démarrage
  infrastructure/cache/redis-transform-cache.ts   l'implémentation Redis du port
  application/use-cases/transform-image.ts  le use case qui utilise le cache
  main.ts                                  composition root : branche Redis au démarrage
```

Respect de la Clean Architecture : le domaine et le use case parlent à une **interface**
(`ITransformCache`). Seule `infrastructure/cache/` connaît Redis. En test unitaire, on
remplace Redis par un faux en mémoire.

Configuration (`.env`) :

| Variable | Rôle | Défaut |
|---|---|---|
| `REDIS_URL` | adresse de Redis | `redis://localhost:6380/0` |
| `CACHE_TTL_SECONDS` | durée de vie d'une entrée de cache | `86400` (24 h) |
| `TEST_REDIS_URL` | Redis des tests (base **1**, jamais la 0) | `redis://localhost:6380/1` |

Lancer Redis : `docker compose up -d redis`. Le port est 6380 (pas 6379) pour ne pas
entrer en conflit avec un Redis déjà installé sur ton Mac.

## 4. Comment fonctionne le cache des transformations ?

### Le problème
`POST /images/:id/transform` avec les mêmes paramètres, deux fois, recréerait deux images
identiques : du CPU gaspillé et des doublons en base.

### La solution
```
requête ──► clé = SHA-256(utilisateur + image source + paramètres normalisés)
              │
              ├─ Redis a la clé ?  ──oui──► on vérifie en base que l'image existe
              │                              et t'appartient ──► 200 + X-Cache: HIT
              │
              └─ non ──► verrou ──► sharp transforme ──► enregistrement en base
                                    ──► Redis mémorise clé → id ──► 201 + X-Cache: MISS
```

Points clés :

- **On met en cache un index, pas des octets.** Redis stocke `clé → id de l'image dérivée`
  (quelques dizaines d'octets), pas l'image. Les fichiers restent dans le stockage.
- **PostgreSQL reste la vérité.** Avant de servir un HIT, on revérifie en base. Si
  l'entrée est périmée ou erronée, on l'ignore et on retraite.
- **Clé canonique** : `rotate -90` et `rotate 270`, ou les champs dans un autre ordre,
  donnent la même clé. L'utilisateur est inclus dans la clé : pas de fuite entre comptes.
  Une constante `TRANSFORM_CACHE_VERSION` est à incrémenter si le rendu change, pour
  invalider tout l'ancien cache d'un coup.
- **TTL de 24 h** : les entrées se nettoient seules.
- **Écriture après la base** : on n'écrit dans Redis qu'une fois l'image réellement
  enregistrée, sinon une entrée pourrait pointer vers du vide.

### Le verrou anti-ruée (cache stampede)
Sans verrou, 8 requêtes simultanées arrivent toutes avant que la première ait fini, ratent
toutes le cache et font toutes le travail : 8 doublons.

Avec le verrou :

```
SET lock:transform:<hash> <jeton> NX PX 30000
      NX = « seulement si elle n'existe pas »   PX = expire après 30 000 ms
```

- Une seule requête obtient le verrou et travaille.
- Les 7 autres **attendent** (vérification toutes les 100 ms, 5 s maximum), puis lisent
  le résultat dans le cache : 1 création (`201`), 7 `200`.
- Le verrou **expire seul** (30 s) : si le serveur plante en plein travail, rien ne reste
  bloqué.
- Il est libéré par un petit script **Lua** qui vérifie le *jeton* : on ne supprime que
  son propre verrou, jamais celui d'une autre requête.

## 5. Et si Redis tombe ? (fail-open)

Redis est une **optimisation**, pas une dépendance vitale. Si Redis est en panne :

- le cache et le verrou deviennent « inactifs » et l'API **continue de fonctionner** ;
- les transformations sont simplement refaites (plus lent, éventuellement des doublons) ;
- `GET /health` répond `degraded` au lieu de `ok` (et `503` si c'est PostgreSQL qui tombe).

Pour que la panne ne ralentisse pas toute l'API, le client est configuré « fail-fast » :
`commandTimeout` de 500 ms, pas de file d'attente hors ligne, reconnexion automatique
espacée. Une commande Redis qui échoue ne bloque jamais une requête plus d'une demi-seconde.

À l'inverse, on parle de **fail-closed** quand on refuse tout si la dépendance est
tombée. Pour du cache, ce serait absurde : on choisit fail-open.

## 6. Rate limiting ✅

Objectif : limiter le nombre de requêtes par fenêtre de temps et répondre `429 Too Many Requests` au-delà,
avec `Retry-After`. Principe « fenêtre fixe », exécuté **d'un bloc** (script Lua, donc atomique) :

```
INCR  ips:ratelimit:<palier>:<qui>        → 1, 2, 3...
si c'est la 1re requête : PEXPIRE ... 60000   → la fenêtre se réinitialise toute seule
PTTL  ...                                  → temps restant (pour Retry-After)
```

`INCR` est atomique : même avec 1000 requêtes simultanées, personne ne « rate » un comptage. Mettre `INCR` et
`PEXPIRE` dans le même script évite qu'un crash entre les deux laisse une clé sans expiration (utilisateur bloqué à vie).

| Palier | Compté par | Défaut |
|---|---|---|
| `auth` (`/register`, `/login`) | IP | 10 / min |
| `upload` | utilisateur | 20 / min |
| `transform` | utilisateur | 10 / min |
| `read` (liste et lecture) | utilisateur | 300 / min |

Fichiers : port `domain/ports/rate-limiter.ts`, implémentation `infrastructure/cache/redis-rate-limiter.ts`,
middleware `infrastructure/http/rate-limit-middleware.ts`, branchement dans `http/app.ts`. Réglable avec les
variables `RATE_LIMIT_*`. Fail-open : Redis tombé → aucune limite appliquée (le limiteur renvoie `null`).

Voir ses clés en direct : faire 3 requêtes puis `KEYS ips:ratelimit:*` et `TTL ips:ratelimit:read:<id>`.

## 6 bis. Et BullMQ ?

Redis sert aussi de socle à la **file d'attente** de la phase 4 (clés `ips:bull:*`). Voir [`docs/BULLMQ.md`](./BULLMQ.md) : contrairement au
cache, la file est **vitale** (fail-closed : sans Redis, `POST /images/:id/jobs` répond `503`).

## 7. Commandes pour explorer toi-même

```bash
docker compose up -d redis                       # démarrer
docker compose exec redis redis-cli              # ouvrir la console

KEYS ips:*                                       # lister nos clés (à éviter en production)
GET ips:cache:transform:<hash>                   # voir un id mis en cache
TTL ips:cache:transform:<hash>                   # secondes restantes avant expiration
MONITOR                                          # voir les commandes en direct (Ctrl+C)
FLUSHDB                                          # vider la base courante (dev seulement !)
```

Note : le client ajoute le préfixe `ips:` à toutes les clés (`keyPrefix`), pour que nos
données ne se mélangent pas à celles d'une autre application sur le même Redis.
Les clés réelles sont donc `ips:cache:transform:<hash>` et `ips:lock:transform:<hash>`.

## 7 bis. Observer Redis sans le casser

| Besoin | Commande | Remarque |
|---|---|---|
| Version, mémoire, clients, durée de fonctionnement | `INFO` (ou `INFO memory`) | ce que lit `RedisMonitor` pour la page « Supervision » |
| Lister des clés | `SCAN 0 MATCH 'ips:cache:*' COUNT 100` (répéter avec le curseur renvoyé jusqu'à 0) | **incrémental** : avance par petits pas |
| Lister des clés (à éviter) | `KEYS ips:*` | **bloque** Redis pendant tout le parcours : dangereux dès qu'il y a beaucoup de clés ; `RedisMonitor` utilise `SCAN` et plafonne le parcours (`approximate`) |
| Voir les commandes en direct | `MONITOR` | instructif en développement, jamais en production |
| Compteurs d'activité de l'application | `MGET ips:stats:cache_hit ips:stats:cache_miss ips:stats:rate_limited` | incrémentés avec `INCR` (atomique) ; repartent de zéro quand Redis est vidé |

Piège : avec ioredis et l'option `keyPrefix`, le motif d'un `SCAN MATCH` n'est **pas** préfixé automatiquement (il faut écrire `ips:*` en entier), et un `KEYS` avec préfixe peut ne rien renvoyer.

## 8. À retenir

1. Redis = RAM, clé → valeur, très rapide, expiration native (TTL).
2. Idéal pour du **temporaire** : cache, compteurs, verrous. Jamais pour la vérité.
3. On cache un **index** et on **revérifie en base** : PostgreSQL reste la source de vérité.
4. Les opérations atomiques (`SET NX`, `INCR`, scripts Lua) permettent de coordonner
   plusieurs requêtes simultanées sans conflit.
5. Redis est derrière une **interface** et en **fail-open** : sa panne dégrade les
   performances, pas la disponibilité.
