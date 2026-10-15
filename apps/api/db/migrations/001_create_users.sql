-- Table des utilisateurs. L'unicité de l'e-mail est garantie par la base (contrainte
-- `users_email_key`), seule protection fiable contre deux inscriptions simultanées.
CREATE TABLE users (
  id            uuid        PRIMARY KEY,
  email         text        NOT NULL UNIQUE,
  password_hash text        NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);
