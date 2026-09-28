/**
 * Database schema, one entry per version. Never edit an entry that has
 * shipped; add a new one. Statements are separated by ";" at a line end.
 */
export const MIGRATIONS: string[] = [
  // 1: accounts and sessions
  `
  CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    email TEXT NOT NULL,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE UNIQUE INDEX users_email ON users (lower(email));
  CREATE UNIQUE INDEX users_username ON users (lower(username));
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
  );
  CREATE INDEX sessions_user ON sessions (user_id);
  `,
];
