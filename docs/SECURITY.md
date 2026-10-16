# Sécurité et durcissement : menaces, défenses, et où c'est dans le code

> Guide d'apprentissage (phase 6). Il relie chaque **menace** à sa **défense**, au code qui l'implémente et au test qui la prouve.
> Principe : on ne « sécurise » pas en général ; on se demande **qui attaque, comment, et ce qui l'arrête**.

---

## 1. La carte : menace → défense → code

| Menace (ce que fait l'attaquant) | Défense | Où | Phase |
|---|---|---|---|
| Se faire passer pour un utilisateur (jeton falsifié, `alg: none`) | JWT signé HS256, algorithme imposé, expiration obligatoire | `jwt-token-service.ts` | 1 |
| Voler la base et casser les mots de passe | `argon2id` (lent, salé, coûteux en RAM), jamais le mot de passe en clair | `argon2-password-hasher.ts` | 1 |
| Deviner si un e-mail a un compte (énumération) | Même réponse `401` + faux hash vérifié (durée comparable) | `login-user.ts` | 1 |
| Envoyer un faux fichier image (`.php` renommé en `.jpg`) | Type lu dans les **magic bytes**, jamais l'extension ni le `Content-Type` | `upload-image.ts` | 1 |
| « Bombe de décompression » (petit fichier, énorme image) | Dimensions lues dans les métadonnées **avant** décodage, `413` | `upload-image.ts`, `sharp` | 1 |
| Lire l'image d'un autre utilisateur | Propriétaire vérifié partout, `404` (jamais `403`) | use cases | 1 |
| Chemin piégé (`../../etc/passwd`) | Clés générées par le serveur ; `StorageKey` refuse `..` | `storage-key.ts` | 1 |
| Injection SQL | SQL paramétré uniquement (`$1`) | `pg-*-repository.ts` | 1 |
| Injection dans le filigrane (SVG/XML) | Liste blanche de caractères + échappement | `watermark.ts` | 2 |
| Appeler l'API depuis un site malveillant | CORS : **une seule origine exacte**, jamais `*` | `app.ts` | 1 |
| Inonder l'API de requêtes | Rate limiting par palier (IP, utilisateur) | `rate-limit-middleware.ts` | 3 |
| Épuiser la RAM avec des traitements lourds en parallèle | **Plafond de concurrence** (503) + file BullMQ à concurrence basse | `concurrency-limit-middleware.ts` | 4, **6** |
| Brute-force d'un compte depuis plein d'IP | **Limite de connexion par e-mail** (empreinte, 15 min) | `rate-limit-middleware.ts` | **6** |
| Falsifier son IP (`X-Forwarded-For`) pour contourner le rate limiting | **`TRUST_PROXY`** : on ne croit l'en-tête qu'à travers N proxies déclarés | `app.ts`, `config.ts` | **6** |
| Garder des connexions ouvertes sans rien envoyer (slowloris) | **Délais** serveur : en-têtes, requête, keep-alive | `server-timeouts.ts` | **6** |
| Faire interpréter une réponse comme autre chose (MIME sniffing), cadrage, etc. | **En-têtes de sécurité** (`helmet`) | `app.ts` | **6** |
| Sonder le serveur (pages d'erreur qui révèlent le framework) | 404 en JSON, pas de `X-Powered-By`, 500 sans détail | `app.ts`, `error-handler.ts` | **6** |
| Récupérer des secrets dans les logs | Aucun mot de passe, jeton ni empreinte journalisé (testé) | tous | **6** |
| Utiliser une dépendance vulnérable | `npm audit` (0 vulnérabilité à la fin de la phase) | CI / manuel | **6** |

(En gras : ajouté par la phase 6.)

## 2. Les nouveautés de la phase 6, en détail

### 2.1 `TRUST_PROXY` : à qui faire confiance pour connaître l'IP du client ?
Derrière un reverse proxy (nginx, un load balancer), la connexion TCP vient **du proxy** : sans précaution, toutes les requêtes ont la même IP, et le rate limiting
par IP bloque tout le monde ensemble. Le proxy transmet l'IP réelle dans `X-Forwarded-For`... mais **n'importe quel client peut aussi écrire cet en-tête lui-même**.

```
client (203.0.113.7) ──► proxy ──► API      X-Forwarded-For: 203.0.113.7        (ajouté par le proxy)
attaquant ───────────────────────► API      X-Forwarded-For: 1.2.3.4            (inventé : « je suis 1.2.3.4 »)
```

Réglage : `TRUST_PROXY=N` = « il y a exactement N proxies de confiance devant moi ». Express lit alors la N-ième adresse **en partant de la droite**
(celle ajoutée par TON proxy, pas celles qu'un client a pu inventer à gauche).
- `0` (défaut) : l'en-tête est **ignoré** ; l'IP est celle de la connexion. Sûr tant qu'il n'y a pas de proxy.
- Trop **bas** (0 derrière un proxy) : tous les clients paraissent avoir l'IP du proxy → blocage collectif.
- Trop **haut** : un client peut falsifier son IP → il **contourne** le rate limiting.
Il n'y a pas de bonne valeur « générique » : elle dépend de l'infrastructure, d'où une variable explicite et un défaut prudent. Testé : avec 0, changer d'IP annoncée ne contourne pas la limite.

### 2.2 Limite de connexion par e-mail
La limite par IP (10/min) arrête un attaquant seul. Un attaquant avec **1000 IP** (botnet) essaie 10 mots de passe par IP sur le **même compte** : chaque IP reste sous
la limite, mais le compte reçoit 10 000 essais. D'où une seconde limite, **par compte visé** : `RATE_LIMIT_LOGIN_EMAIL` (10) par fenêtre de 15 min.
- **Empreinte, pas e-mail en clair** : la clé Redis est `SHA-256(e-mail normalisé)` tronquée : l'adresse (donnée personnelle) n'est jamais stockée lisible dans Redis.
- **Normalisation** : `A@x.com`, ` a@X.COM ` comptent comme la même adresse (sinon on contourne en changeant la casse).
- **Compromis assumé** : un attaquant peut *bloquer exprès* un compte en le martelant (déni de service ciblé, 15 min). On accepte ce risque : l'alternative (laisser tester des
  milliers de mots de passe) est pire. Atténuations possibles (hors périmètre) : verrouillage progressif, CAPTCHA, alerte à l'utilisateur.
- La limite compte **toutes** les tentatives, y compris avec le bon mot de passe : sinon l'attaquant saurait quand il a trouvé le bon en voyant la limite disparaître.

### 2.3 Plafond de concurrence (protéger la mémoire)
Le rate limiting borne le **nombre par minute**, pas le **nombre en même temps** : 10 transformations de 49 Mpx lancées ensemble, ce sont ~10 Go de RAM sans qu'aucun quota soit dépassé.
`MAX_CONCURRENT_TRANSFORMS` (2) limite les transformations **synchrones** simultanées par process ; au-delà : `503 ServerBusy` + `Retry-After: 1`, **immédiat**.
- **Refuser plutôt qu'attendre** : une file en mémoire garderait les connexions et corps de requête ouverts, donc la RAM occupée.
- Placé **après** l'authentification et le quota : un anonyme reçoit `401`, pas `503`.
- La place est rendue sur l'événement `close` : à la fin de la réponse **ou** si le client coupe la connexion.
- La voie **asynchrone** (BullMQ, phase 4) est l'autre réponse : sa concurrence est réglée côté worker (`WORKER_CONCURRENCY`).
- Limite connue : le compteur est **par process**. Avec 3 instances de l'API, le plafond global est 3×.

### 2.4 Délais du serveur (slowloris)
Un client qui envoie un octet toutes les secondes garde une connexion ouverte presque gratuitement ; quelques milliers suffisent à saturer un serveur.
`configureServerTimeouts` fixe : `headersTimeout` 10 s (en-têtes complets), `requestTimeout` 60 s (requête entière : une image de 10 Mo doit pouvoir arriver sur une liaison lente, pas indéfiniment),
`keepAliveTimeout` 5 s. Testé avec de vrais sockets : un client qui envoie les en-têtes (ou le corps) goutte à goutte est coupé en quelques secondes.

### 2.5 En-têtes de sécurité (`helmet`)
Quelques en-têtes qui ferment des familles d'attaques côté navigateur : `X-Content-Type-Options: nosniff` (le navigateur n'« interprète » pas un fichier autrement que son type annoncé),
`X-Frame-Options` / `frame-ancestors` (pas de cadrage), `Strict-Transport-Security` (HTTPS obligatoire, actif seulement derrière HTTPS), `Content-Security-Policy` stricte, pas de `X-Powered-By`.
`Cross-Origin-Resource-Policy: same-site` : les images peuvent être chargées par l'app web (même site, autre port/sous-domaine), pas par un autre site.
Une API JSON n'a pas besoin de plus ; les 404 sont en JSON (la page HTML par défaut d'Express révèle le framework).

### 2.6 Hygiène des journaux
Un test exécute les parcours (inscription, connexion réussie et ratée, JSON malformé, doublon, jeton falsifié) en **capturant la console**, puis vérifie qu'aucun mot de passe, jeton
ni empreinte n'y figure. Un journal est lu par beaucoup de monde et conservé longtemps : y trouver un secret est une fuite.

## 3. Ce qui N'EST PAS fait (et pourquoi)
- **Pas de HTTPS dans l'application** : il est terminé par le reverse proxy (c'est lui qui porte le certificat). `TRUST_PROXY` et HSTS en tiennent compte.
- **Pas de révocation de JWT** : un jeton valide l'est jusqu'à son expiration (1 h). Révoquer demanderait un état serveur (liste noire dans Redis), hors périmètre.
- **Pas de rotation de `JWT_SECRET`**, pas de CAPTCHA, pas de verrouillage progressif, pas de détection d'anomalies.
- **Pas d'analyse antivirus** des fichiers : on vérifie le format et les dimensions, pas l'absence de contenu malveillant dans les métadonnées.
- **Pas de Dockerfile** : la remarque « polices du système dans un conteneur » (le filigrane SVG utilise des polices du système) se posera au moment de conteneuriser l'API.

## 4. Vérifier soi-même
Voir la section « Durcissement et sécurité » de `docs/TESTING_GUIDE.md` (commandes `curl` pour les en-têtes, le contournement par `X-Forwarded-For`, la limite par e-mail, la saturation).

## 5. À retenir
1. Raisonner **menace → défense → preuve (test)**.
2. **Ne jamais faire confiance à `X-Forwarded-For`** sauf à travers un nombre déclaré de proxies.
3. Une limite par IP ne suffit pas : limiter **aussi par cible** (le compte visé).
4. Borner **le temps** (délais) et **la mémoire** (concurrence), pas seulement le nombre de requêtes.
5. Refuser vite vaut mieux qu'attendre : une file qui s'allonge consomme la ressource qu'on veut protéger.
6. Ne rien stocker ni journaliser de sensible : des **empreintes** plutôt que des e-mails, aucun secret dans les logs.
7. Toute défense a un **compromis** (ici : on peut bloquer exprès un compte) : le connaître et le documenter.
