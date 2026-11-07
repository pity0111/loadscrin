import { d1Query, ensurePlayersTable } from "../shared/d1.js";
import { toSteamID64, toSteamID, formatPlayTime } from "../shared/steamid.js";

// ── Handler: отдаёт данные игрока для плашки на загрузочном экране ──────────
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
    await ensurePlayersTable();

    const { rows } = await d1Query(
      "SELECT * FROM players WHERE steamid64 = ? LIMIT 1",
      [steamid64]
    );
    const row = rows[0];

    if (row) {
      result.found     = true;
      result.rpname    = row.rpname    ?? null;
      result.wallet    = row.wallet    ?? null;
      result.playTime  = formatPlayTime(row.play_time);
      result.rank      = row.rank      ?? null;
      result.job       = row.job       ?? null;
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
