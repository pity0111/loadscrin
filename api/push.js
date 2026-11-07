import { createClient } from "@libsql/client";

// ── SteamID helpers ──────────────────────────────────────────────────────────
function toSteamID64(steamid) {
  if (/^\d{17}$/.test(steamid)) return steamid;
  const match = String(steamid).match(/^STEAM_\d:(\d):(\d+)$/i);
  if (!match) throw new Error("Неверный формат SteamID: " + steamid);
  const authserver = BigInt(match[1]);
  const authid     = BigInt(match[2]);
  return (BigInt("76561197960265728") + authid * BigInt(2) + authserver).toString();
}

function toSteamID(steamid64) {
  const big  = BigInt(steamid64) - BigInt("76561197960265728");
  const auth = big % BigInt(2);
  const id   = (big - auth) / BigInt(2);
  return `STEAM_0:${auth}:${id}`;
}

// ── Декодирование полей ──────────────────────────────────────────────────────
// Lua-скрипт шлёт текстовые поля в base64url (enc=b64), чтобы спецсимволы
// и кириллица не ломали запрос. Без enc= значения читаются как есть (curl).
function decodeField(v, enc) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v);
  if (enc !== "b64") return s;
  try {
    const norm = s.replace(/-/g, "+").replace(/_/g, "/");
    const buf  = Buffer.from(norm, "base64");
    const text = buf.toString("utf8");
    // Если после декодирования получился мусор — возвращаем исходную строку
    if (Buffer.compare(buf, Buffer.from(text, "utf8")) !== 0) return s;
    return text;
  } catch (_) {
    return s;
  }
}

function toInt(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Собираем параметры из query-string (надёжно) и из body (если есть)
function collectParams(req) {
  const out = { ...(req.query || {}) };
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch (_) { body = null; }
  }
  if (body && typeof body === "object") Object.assign(out, body);
  return out;
}

// ── Турсо (SQLite-облако) ────────────────────────────────────────────────────
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS players (
  steamid64 TEXT PRIMARY KEY,
  steamid   TEXT,
  rpname    TEXT,
  wallet    INTEGER,
  rank      TEXT,
  play_time INTEGER,
  job       TEXT,
  updated_at INTEGER
)`;

function getClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    const err = new Error(
      "DB_CONFIG: не задана переменная окружения TURSO_DATABASE_URL (см. SETUP.md)"
    );
    err.status = 500;
    throw err;
  }
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}

// ── Handler ──────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET" && req.method !== "POST") {
    return res.status(405).json({ error: "Только GET/POST" });
  }

  const params = collectParams(req);

  // ── Секрет: header от Lua или поле secret ────────────────────────────────
  const pushSecret = process.env.PUSH_SECRET;
  if (!pushSecret) {
    return res.status(500).json({
      error: "DB_CONFIG: не задана переменная окружения PUSH_SECRET (см. SETUP.md)",
    });
  }
  const given =
    (req.headers && (req.headers["x-push-secret"] || req.headers["X-Push-Secret"])) ||
    params.secret;
  if (given !== pushSecret) {
    return res.status(401).json({ error: "Неверный secret" });
  }

  // ── SteamID ───────────────────────────────────────────────────────────────
  let steamid64, steamidOld;
  try {
    steamid64  = toSteamID64(String(params.steamid || ""));
    steamidOld = toSteamID(steamid64);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const enc = params.enc;
  const data = {
    rpname:    decodeField(params.rpname, enc),
    rank:      decodeField(params.rank, enc),
    job:       decodeField(params.job, enc),
    wallet:    toInt(params.wallet),
    play_time: toInt(params.play_time ?? params.playtime),
  };

  try {
    const db = getClient();
    await db.execute(SCHEMA_SQL);

    // Обновляем только присланные поля, остальные не трогаем
    await db.execute({
      sql: `
INSERT INTO players (steamid64, steamid, rpname, wallet, rank, play_time, job, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(steamid64) DO UPDATE SET
  steamid   = excluded.steamid,
  rpname    = COALESCE(excluded.rpname,    players.rpname),
  wallet    = COALESCE(excluded.wallet,    players.wallet),
  rank      = COALESCE(excluded.rank,      players.rank),
  play_time = COALESCE(excluded.play_time, players.play_time),
  job       = COALESCE(excluded.job,       players.job),
  updated_at = excluded.updated_at`,
      args: [
        steamid64,
        steamidOld,
        data.rpname,
        data.wallet,
        data.rank,
        data.play_time,
        data.job,
        Math.floor(Date.now() / 1000),
      ],
    });

    return res.status(200).json({ ok: true, steamid64, updated: data });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
