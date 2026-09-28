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
  // 2: finished games (saved when at least one player is signed in)
  `
  CREATE TABLE games (
    id TEXT PRIMARY KEY,
    finished_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    difficulty TEXT NOT NULL,
    theme TEXT NOT NULL,
    timer_mode TEXT NOT NULL,
    reason TEXT NOT NULL,
    result JSONB NOT NULL
  );
  CREATE TABLE game_players (
    game_id TEXT NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    seat SMALLINT NOT NULL,
    player_id TEXT NOT NULL,
    user_id BIGINT REFERENCES users (id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    outcome TEXT NOT NULL,
    final_ms INTEGER,
    PRIMARY KEY (game_id, seat)
  );
  CREATE INDEX game_players_user ON game_players (user_id);
  `,
  // 3: friends. One row per pair; `status` is pending until the addressee accepts.
  `
  CREATE TABLE friendships (
    requester_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    addressee_id BIGINT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
  );
  CREATE UNIQUE INDEX friendships_pair ON friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));
  CREATE INDEX friendships_addressee ON friendships (addressee_id);
  `,
];
