CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  player       TEXT NOT NULL,
  mode         TEXT NOT NULL CHECK (mode IN ('carreras','futbol')),
  started_at   TIMESTAMPTZ NOT NULL,
  duration_ms  INTEGER NOT NULL CHECK (duration_ms >= 0),
  total_score  NUMERIC NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS splits (
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  t_ms         INTEGER NOT NULL CHECK (t_ms >= 0),
  lap          INTEGER NOT NULL CHECK (lap >= 0),
  score        NUMERIC NOT NULL,
  note         TEXT,
  PRIMARY KEY (session_id, t_ms)
);

CREATE INDEX IF NOT EXISTS idx_sessions_player  ON sessions (player);
CREATE INDEX IF NOT EXISTS idx_sessions_mode    ON sessions (mode);
CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_splits_session   ON splits (session_id);
