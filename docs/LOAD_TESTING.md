# Tests de charge avec autocannon : comprendre, lancer, lire les résultats

> Guide d'apprentissage (phase 6), comme `docs/REDIS.md` ou `docs/BULLMQ.md`.

---

## 1. Pourquoi tester la charge ?

Les tests unitaires, d'intégration et E2E répondent à « **est-ce que c'est correct ?** ». Un test de charge répond à une autre question : « **combien ça encaisse, et comment ça casse ?** ».
Un code correct peut être trop lent (une requête SQL sans index), fuir de la mémoire, ou se comporter bizarrement quand 20 requêtes arrivent en même temps (verrous, concurrence, files).
C'est un **test de comportement sous contrainte**, pas un test de justesse.

Dans ce projet, il a révélé **deux défauts que les 600 autres tests n'avaient pas vus** (voir §6).

## 2. L'outil : autocannon

`autocannon` est un générateur de charge HTTP écrit en Node.js (installé en `devDependency`, aucun binaire à installer). Il ouvre N **connexions** simultanées et envoie des requêtes en continu
pendant D secondes, puis rapporte :

| Mesure | Sens | Comment la lire |
|---|---|---|
| **req/s** (*throughput*) | Requêtes traitées par seconde | « débit » du serveur, pour ce scénario |
| **latence p50** (médiane) | La moitié des requêtes sont plus rapides | le temps « typique » |
| **p97.5 / p99** | 97,5 % / 99 % des requêtes sont plus rapides | la **queue** de latence : ce que vivent les utilisateurs les moins chanceux |
| **max** | La pire requête | souvent un artefact (ramasse-miettes, démarrage) |
| **Mo/s** | Octets transférés par seconde | pertinent pour les gros fichiers (images) |
| **2xx / autres statuts** | Réponses réussies / en erreur (par code) | 429 et 503 peuvent être *voulus* |

**Pourquoi les percentiles et pas la moyenne ?** Une moyenne cache les cas extrêmes : 99 requêtes à 1 ms et 1 à 1 s donnent ~11 ms de moyenne, alors que 1 % des utilisateurs attend une seconde. On regarde p99.

Alternative à connaître : **k6** (Grafana), outil dédié avec scénarios en JavaScript, seuils (`thresholds`), rampes de charge et rapports. Plus puissant, mais c'est un binaire à installer ;
autocannon suffit pour ce projet et reste dans l'écosystème Node.

## 3. Lancer

```bash
docker compose up -d --wait      # PostgreSQL + Redis
npm run loadtest                 # depuis la racine (≈ 1 min 30)
LOADTEST_DURATION=5 LOADTEST_CONNECTIONS=50 npm run loadtest -w apps/api   # variantes
```

Le script (`apps/api/loadtest/run.ts`) :
1. démarre l'API dans un **process séparé** (port 3090) sur la base **de test** et le Redis **de test** (base 1), avec un dossier de stockage temporaire : **rien de votre base de développement n'est touché** ;
2. relève les quotas de rate limiting (on mesure la capacité du serveur, pas la limite ; elle est testée ailleurs) mais **garde le plafond de transformations simultanées** réel ;
3. crée un utilisateur et une image 1600×1200 (du bruit, pour un vrai traitement) ;
4. enchaîne les scénarios, affiche un tableau Markdown, puis **nettoie** (utilisateur supprimé, Redis de test vidé, dossier temporaire supprimé) ;
5. sort avec un **code non nul** si un scénario renvoie des erreurs inattendues (tout statut ≥ 400 non prévu, erreurs réseau, délais dépassés) : utilisable en CI.

## 4. Les scénarios et ce qu'ils mesurent

| Scénario | Ce qu'il exerce | Ce qu'on en attend |
|---|---|---|
| `health` | `GET /health` : Node + Express + un `SELECT 1` + un `PING` Redis | le **plancher** : le coût minimal d'une requête |
| `liste` | `GET /images` authentifié : JWT + quota Redis + requête PostgreSQL | coût d'une requête « normale » |
| `lecture-image` | `GET /images/:id` : flux d'un fichier de plusieurs Mo | limité par la **bande passante** (Mo/s), pas par le nombre de requêtes |
| `transform-cache-hit` | mêmes paramètres : réponse du cache Redis | rapide et **jamais refusée** (le plafond ne s'applique pas au cache) |
| `transform-miss-sature` | paramètres tous différents : vrai traitement sharp | le plafond de concurrence répond **503** au-delà de `MAX_CONCURRENT_TRANSFORMS` |
| `creation-job` | `POST /images/:id/jobs` (PostgreSQL + BullMQ), sans worker | capacité de l'API seule à accepter du travail asynchrone (202) |
| `login-argon2` | `POST /login` : argon2id, volontairement coûteux | très bas débit **par conception** (c'est la défense contre le brute-force) |
| `health-pendant-transformations` | `/health` **pendant** une saturation de transformations | l'API reste-t-elle **réactive** quand le CPU est occupé ? (boucle d'événements non bloquée) |

## 5. Résultats mesurés (indicatifs)

Mesurés sur un Mac de développement, client **et** serveur sur la même machine (boucle locale), 10 s par scénario, 20 connexions (4 pour le login), Node 24, `MAX_CONCURRENT_TRANSFORMS=2` :

| scénario | req/s | Mo/s | p50 | p97.5 | p99 | max | 2xx | autres statuts |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| health | 22 945 | 20,1 | 0 ms | 1 ms | 2 ms | 13 ms | 252 387 | - |
| liste | 11 341 | 12,5 | 1 ms | 3 ms | 3 ms | 9 ms | 124 735 | - |
| lecture-image | 24 | 123,7 | 957 ms | 1 317 ms | 1 336 ms | 1 373 ms | 218 | - |
| transform-cache-hit | 9 044 | 10,0 | 2 ms | 3 ms | 3 ms | 225 ms | 99 472 | - |
| transform-miss-sature | 6 886 | 7,1 | 2 ms | 5 ms | 5 ms | 306 ms | 181 | 503 × 68 673 |
| creation-job | 7 272 | 8,7 | 2 ms | 4 ms | 4 ms | 22 ms | 72 723 | - |
| login-argon2 | 86 | 0,1 | 45 ms | 52 ms | 56 ms | 105 ms | 860 | - |
| health-pendant-transformations | 2 245 | 2,0 | 0 ms | 2 ms | 2 ms | 7 ms | 24 696 | - |

**Comment lire ces chiffres (et ne pas les sur-interpréter) :**
- Ils sont **relatifs**, pas absolus : autre machine, autres chiffres. Ce qui compte, ce sont les **rapports** et les **comportements**.
- `lecture-image` : 24 req/s mais **124 Mo/s**. Le fichier fait ~5 Mo (bruit incompressible) : on est limité par le **débit de copie**, pas par le serveur. Les 957 ms sont le temps de transfert de 20 fichiers en parallèle.
- `transform-miss-sature` : ~18 traitements réussis par seconde (2 places, ~110 ms chacun) ; tout le reste reçoit **503 immédiatement** (2 ms) au lieu de s'empiler. C'est exactement l'effet voulu : le serveur **se protège** et reste rapide.
- `login-argon2` : 86/s avec 4 connexions. Un débit bas est la **fonction** d'argon2 : chaque tentative coûte ~45 ms de CPU, ce qui rend le brute-force coûteux pour l'attaquant comme pour nous.
- `health-pendant-transformations` : pendant que sharp sature le CPU, `/health` répond avec p99 = 2 ms : la **boucle d'événements n'est pas bloquée** (sharp travaille dans le pool de threads de libuv, pas dans le thread JavaScript).
- Réseau et client sur la même machine : ces tests ne mesurent ni la latence réseau, ni un vrai déploiement. Pour une vraie capacité, il faudrait générer la charge **depuis une autre machine**.

## 6. Ce que les tests de charge ont révélé (et qui a été corrigé)

1. **Le plafond de concurrence refusait… les réponses du cache.** Première version : un middleware HTTP limitait les transformations simultanées sur toute la route. Sous charge, le scénario « cache hit » recevait
   60 215 réponses `503` pour 3 641 succès : des requêtes qui coûtent 1 ms étaient refusées parce que 20 clients arrivaient en même temps, alors qu'elles n'occupent aucune ressource lourde.
   **Correction** : le plafond est devenu un port du domaine (`IWorkSlots`) appliqué **dans le use case, autour du seul calcul coûteux** ; le cache n'y touche jamais. Tests unitaires, E2E et mutation à l'appui.
   Leçon : on protège **la ressource rare** (RAM/CPU du traitement), pas la route.
2. **Un client qui coupe un téléchargement polluait les journaux d'erreurs** (`ERR_STREAM_PREMATURE_CLOSE`). Fermer un onglet pendant le chargement d'une image est normal ; sous charge, chaque téléchargement interrompu produisait une fausse « erreur » avec sa trace complète.
   **Correction** : cette erreur précise n'est plus journalisée (le flux source reste détruit proprement par `pipeline`, aucune fuite de connexion). Test avec de vraies annulations côté client.
3. **Constat sans correction : le téléchargement d'images passe par l'API** (`GET /images/:id`, ~124 Mo/s ici). C'est précisément ce que les **URLs présignées** (phase 5, `GET /images/:id/url`) évitent : le téléchargement va directement du stockage au navigateur.

## 7. Limites de ces tests
- Pas de **test d'endurance** (heures) ni de **test de montée en charge progressive** (rampes) : autocannon applique une charge constante.
- Pas de surveillance de la **mémoire** du serveur pendant la charge (à observer à la main : `ps`, `top`, ou l'Activity Monitor pendant `npm run loadtest`).
- Le scénario `creation-job` n'a **pas de worker** : il mesure l'API qui accepte du travail, pas le débit de traitement de bout en bout (qui dépend de `WORKER_CONCURRENCY` et du CPU).
- Les résultats varient d'un run à l'autre de 5 à 10 % : ne pas conclure sur une petite différence.

## 8. À retenir
1. Un test de charge mesure **débit, latence (percentiles) et comportement à saturation**, pas la justesse.
2. Regarder **p99**, pas la moyenne.
3. Un bon système sous surcharge **refuse vite** (503) au lieu de s'effondrer ou de s'empiler.
4. On protège **la ressource rare**, pas la route entière : un plafond mal placé refuse des requêtes qui ne coûtent rien.
5. Les chiffres sont **relatifs** (machine, réseau, client sur la même machine) ; on compare des scénarios entre eux et avant/après un changement.
6. Tester **réellement** (API lancée, vraie base, vrai Redis) révèle ce que les tests isolés ne voient pas.
