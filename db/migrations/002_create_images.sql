-- Métadonnées des images. Le fichier lui-même vit dans le stockage (IFileStorage),
-- référencé par `storage_key`. `original_id` est NULL pour un original et pointe vers
-- l'original pour un dérivé (phase 2).
CREATE TABLE images (
  id           uuid        PRIMARY KEY,
  owner_id     uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  storage_key  text        NOT NULL UNIQUE,
  original_id  uuid        REFERENCES images (id) ON DELETE CASCADE,
  format       text        NOT NULL CHECK (format IN ('jpeg', 'png', 'webp')),
  size_bytes   integer     NOT NULL CHECK (size_bytes > 0),
  width        integer     NOT NULL CHECK (width > 0),
  height       integer     NOT NULL CHECK (height > 0),
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Pour la liste paginée d'un utilisateur, la plus récente d'abord.
CREATE INDEX images_owner_created_idx ON images (owner_id, created_at DESC);
