# Image Processing Service

API backend d'apprentissage (Node.js, TypeScript, Express, PostgreSQL). Voir `CLAUDE.md`
(source de vérité), `ENGINEERING_RULES.md` (architecture) et `WORKFLOW.md` (cycle de travail).

## Prérequis

- Node.js >= 22 (testé avec 24)
- Docker (pour PostgreSQL local) — ou un PostgreSQL installé via Homebrew

## Installation

```bash
npm install
cp .env.example .env   # puis adapter les valeurs (JWT_SECRET : au moins 32 caractères)
```

## Lancer PostgreSQL

```bash
docker compose up -d --wait
```

Crée deux bases : `imageservice_dev` et `imageservice_test`. Le port hôte est **5433**
(pour éviter un conflit avec un PostgreSQL déjà sur 5432). Le script
`docker/init-db.sql` ne s'exécute qu'à la première création du volume ; pour repartir
de zéro : `docker compose down -v`.

## Migrer, démarrer

```bash
npm run migrate   # applique db/migrations/NNN_*.sql sur la base de dev
npm run dev       # serveur avec rechargement, http://localhost:3001
```

## Tests et qualité

```bash
npm run test:unit         # domaine / config, sans réseau ni DB
npm run test:integration  # migrator contre imageservice_test
npm run test:e2e          # requêtes HTTP (supertest) sur la base de test
npm test                  # les trois
npm run typecheck && npm run lint
```

## Endpoints

| Méthode | Route | Description |
|---|---|---|
| GET | `/health` | 200 si l'app et la base répondent, 503 si la base est injoignable |
| POST | `/register` | Corps `{ email, password }` (mot de passe : 8 caractères min.). 201 `{ id, email }` (jamais le hash), 400 validation / JSON malformé, 409 e-mail déjà pris |
| POST | `/login` | Corps `{ email, password }`. 200 `{ token }` (JWT), 400 validation, 401 identifiants incorrects (même réponse pour e-mail inconnu et mauvais mot de passe) |

Les routes protégées (à venir) attendent l'en-tête `Authorization: Bearer <token>` ; sans jeton valide : 401.

## Variables d'environnement

Voir `.env.example`. L'application refuse de démarrer si la configuration est invalide.
