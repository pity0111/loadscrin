import { createClient } from "@libsql/client";

// ── SteamID helpers ──────────────────────────────────────────────────────────
function toSteamID64(steamid) {
  if (/^\d{17}$/.test(steamid)) return steamid;
  const match = steamid.match(/^STEAM_\d:(\d):(\d+)$/i);
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

function formatPlayTime(seconds) {
  seconds = Number(seconds) || 0;
  if (seconds <= 0) return "0 минут";
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} м` : `${m} м`;
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
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { steamid } = req.query || {};
  if (!steamid) return res.status(400).json({ error: "steamid обязателен" });

  let steamid64, steamidOld;
  try {
    steamid64  = toSteamID64(String(steamid));
    steamidOld = toSteamID(steamid64);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const result = {
    steamid64,
    steamidOld,
    found:    false,   // был ли игрок уже в базе (Lua что-то отправил)
    rpname:   null,
    wallet:   null,
    playTime: null,
    rank:     null,
    job:      null,
    avatar:   null,
    updatedAt: null,
  };

  try {
    const db = getClient();
    await db.execute(SCHEMA_SQL);

    const rs = await db.execute({
      sql: "SELECT * FROM players WHERE steamid64 = ? LIMIT 1",
      args: [steamid64],
    });
    const row = rs.rows[0];

    if (row) {
      result.found     = true;
      result.rpname    = row.rpname   ?? null;
      result.wallet    = row.wallet   ?? null;
      result.playTime  = formatPlayTime(row.play_time);
      result.rank      = row.rank     ?? null;
      result.job       = row.job      ?? null;
      result.updatedAt = row.updated_at ?? null;
    }

    // Аватарка Steam (нужен STEAM_API_KEY в переменных окружения Vercel)
    const steamKey = process.env.STEAM_API_KEY;
    if (steamKey) {
      try {
        const r = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`
        );
        const d = await r.json();
        result.avatar = d?.response?.players?.[0]?.avatarmedium ?? null;
      } catch (_) {}
    }

    return res.status(200).json(result);
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
