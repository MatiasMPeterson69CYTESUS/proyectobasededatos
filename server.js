import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import rateLimit from "express-rate-limit";
import pg from "pg";
import { z } from "zod";

const app = express();

// ---- Config
const PORT = process.env.PORT || 3000;
const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";
const DATABASE_URL = process.env.DATABASE_URL || "postgres://tsr:tsr@localhost:5432/tsr";
const API_KEY = process.env.API_KEY || ""; // si está vacío, no exige autenticación

// ---- Middlewares
app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "5mb" }));
app.use(morgan("tiny"));
app.use(rateLimit({ windowMs: 60_000, max: 600 }));

// ---- DB
const pool = new pg.Pool({ connectionString: DATABASE_URL });

// ---- Migración mínima
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      player TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('carreras','futbol')),
      started_at timestamptz NOT NULL,
      duration_ms int NOT NULL CHECK (duration_ms >= 0),
      total_score numeric NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS splits (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      t_ms int NOT NULL CHECK (t_ms >= 0),
      lap int NOT NULL CHECK (lap >= 0),
      score numeric NOT NULL,
      note text,
      PRIMARY KEY (session_id, t_ms)
    );`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_player  ON sessions (player);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_mode    ON sessions (mode);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_started ON sessions (started_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_splits_session   ON splits (session_id);`);
}

// ---- Auth por API Key (opcional)
function requireApiKey(req, res, next) {
  if (!API_KEY) return next(); // sin API_KEY, no exigir
  if (req.headers["x-api-key"] === API_KEY) return next();
  return res.status(401).json({ ok: false, error: "unauthorized" });
}

// ---- Validación (zod)
const SplitSchema = z.object({
  t: z.number().int().nonnegative(),
  lap: z.number().int().nonnegative(),
  score: z.number(),
  note: z.string().nullable().optional(),
});

const SessionUpsertSchema = z.object({
  id: z.string().min(3),
  player: z.string().min(1),
  mode: z.enum(["carreras","futbol"]),
  startedAt: z.number().int().nonnegative(),     // epoch ms
  durationMs: z.number().int().nonnegative(),
  totalScore: z.number(),
  splits: z.array(SplitSchema).max(200_000).optional().default([]),
});

// ---- Rutas públicas
app.get("/api/health", (_req,res)=> res.json({ok:true}));
app.get("/api/version", (_req,res)=> res.json({name:"timesplit-api", version:"1.0.0"}));

// ---- A partir de aquí, si hay API_KEY, se exige
app.use("/api", requireApiKey);

// POST /api/sessions (upsert + bulk splits)
app.post("/api/sessions", async (req, res) => {
  const parse = SessionUpsertSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ ok:false, error: parse.error.flatten() });
  }
  const s = parse.data;

  // coherencia: durationMs >= max(t)
  const maxT = s.splits.reduce((m, sp) => Math.max(m, sp.t), 0);
  if (s.durationMs < maxT) {
    return res.status(400).json({ ok:false, error: "durationMs must be >= max split.t" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const upsertQ = `
      INSERT INTO sessions (id, player, mode, started_at, duration_ms, total_score, updated_at)
      VALUES ($1,$2,$3,to_timestamp($4/1000.0),$5,$6, now())
      ON CONFLICT (id)
      DO UPDATE SET player=EXCLUDED.player, mode=EXCLUDED.mode,
                    started_at=EXCLUDED.started_at, duration_ms=EXCLUDED.duration_ms,
                    total_score=EXCLUDED.total_score, updated_at=now()
    `;
    await client.query(upsertQ, [s.id, s.player, s.mode, s.startedAt, s.durationMs, s.totalScore]);

    let inserted = 0;
    if (s.splits?.length) {
      const insertSplit = `
        INSERT INTO splits (session_id, t_ms, lap, score, note)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (session_id, t_ms) DO NOTHING
      `;
      for (const sp of s.splits) {
        await client.query(insertSplit, [s.id, sp.t, sp.lap, sp.score, sp.note ?? null]);
        inserted++;
      }
    }

    await client.query("COMMIT");
    res.json({ ok: true, upserted: s.id, splits_inserted: inserted });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ ok:false, error: e.message });
  } finally {
    client.release();
  }
});

// GET /api/sessions (listado + filtros + paginado)
app.get("/api/sessions", async (req, res) => {
  const page  = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
  const offset = (page - 1) * limit;

  const player = req.query.player ? String(req.query.player) : null;
  const mode   = req.query.mode ? String(req.query.mode) : null;
  const from   = req.query.from ? String(req.query.from) : null;
  const to     = req.query.to ? String(req.query.to) : null;

  const where = [];
  const vals = [];
  let i = 1;
  if (player) { where.push(`player = $${i++}`); vals.push(player); }
  if (mode)   { where.push(`mode = $${i++}`);   vals.push(mode); }
  if (from)   { where.push(`started_at >= $${i++}`); vals.push(new Date(from)); }
  if (to)     { where.push(`started_at <= $${i++}`); vals.push(new Date(to)); }
  const whereSQL = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const qData = `
    SELECT s.*, (SELECT COUNT(*) FROM splits sp WHERE sp.session_id = s.id) AS splits
    FROM sessions s
    ${whereSQL}
    ORDER BY started_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  const qCount = `SELECT COUNT(*)::int AS total FROM sessions ${whereSQL}`;

  const [rows, count] = await Promise.all([
    pool.query(qData, vals),
    pool.query(qCount, vals),
  ]);

  res.json({ data: rows.rows, page, limit, total: count.rows[0].total });
});

// GET /api/sessions/:id (detalle + splits)
app.get("/api/sessions/:id", async (req, res) => {
  const id = req.params.id;
  const s = await pool.query(`SELECT * FROM sessions WHERE id = $1`, [id]);
  if (!s.rowCount) return res.status(404).json({ ok:false, error:"not_found" });
  const splits = await pool.query(
    `SELECT t_ms, lap, score, note FROM splits WHERE session_id = $1 ORDER BY t_ms ASC`,
    [id]
  );
  res.json({ ...s.rows[0], splits: splits.rows });
});

// GET /api/leaderboard?mode&limit (top N por mejor total_score)
app.get("/api/leaderboard", async (req, res) => {
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "10"), 10) || 10));
  const mode = req.query.mode ? String(req.query.mode) : null;

  const where = mode ? `WHERE mode = $1` : "";
  const vals = mode ? [mode] : [];

  const q = `
    SELECT player, mode, MAX(total_score) AS best_score
    FROM sessions
    ${where}
    GROUP BY player, mode
    ORDER BY best_score DESC
    LIMIT ${limit}
  `;
  const r = await pool.query(q, vals);
  res.json(r.rows);
});

// GET /api/players (lista de jugadores con #sesiones y mejor score)
app.get("/api/players", async (req, res) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"), 10) || 100));
  const search = req.query.search ? `%${String(req.query.search)}%` : null;

  const where = search ? `WHERE player ILIKE $1` : "";
  const vals = search ? [search] : [];

  const q = `
    SELECT player,
           COUNT(*)::int AS sessions,
           MAX(total_score) AS best_score
    FROM sessions
    ${where}
    GROUP BY player
    ORDER BY sessions DESC, best_score DESC
    LIMIT ${limit}
  `;
  const r = await pool.query(q, vals);
  res.json(r.rows);
});

// GET /api/modes (estadísticas por modo)
app.get("/api/modes", async (_req, res) => {
  const q = `
    SELECT mode,
           COUNT(*)::int AS sessions,
           AVG(total_score)::float AS avg_score,
           MAX(total_score) AS max_score
    FROM sessions
    GROUP BY mode
    ORDER BY mode ASC
  `;
  const r = await pool.query(q);
  res.json(r.rows);
});

// GET /api/stats (totales globales)
app.get("/api/stats", async (_req,res)=>{
  const q1 = await pool.query("SELECT COUNT(*)::int AS sessions, COUNT(DISTINCT player) AS players FROM sessions");
  const q2 = await pool.query("SELECT mode, COUNT(*)::int AS total, AVG(total_score)::float AS avg_score FROM sessions GROUP BY mode");
  res.json({
    sessions: q1.rows[0].sessions,
    players: q1.rows[0].players,
    byMode: q2.rows
  });
});

// ---- Start
app.listen(PORT, async () => {
  await migrate();
  console.log("API on http://localhost:" + PORT);
});
