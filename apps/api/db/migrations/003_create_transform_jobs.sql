-- Jobs de transformation asynchrone (phase 4). PostgreSQL est la SOURCE DE VÉRITÉ du statut d'un job :
-- BullMQ (Redis) ne sert que de transport. Si Redis est vidé, l'historique des jobs reste lisible ici.
CREATE TABLE transform_jobs (
  id              uuid        PRIMARY KEY,
  owner_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  source_image_id uuid        NOT NULL REFERENCES images (id) ON DELETE CASCADE,
  -- Paramètres bruts demandés par le client (revalidés par le worker, jamais crus sur parole).
  params          jsonb       NOT NULL,
  status          text        NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  result_image_id uuid        REFERENCES images (id) ON DELETE SET NULL,
  error_kind      text,
  error_message   text,
  -- Nombre de tentatives de traitement déjà démarrées (retries BullMQ compris).
  attempts        integer     NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX transform_jobs_owner_created_idx ON transform_jobs (owner_id, created_at DESC);
