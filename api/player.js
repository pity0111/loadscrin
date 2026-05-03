import mysql from "mysql2/promise";

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

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { steamid } = req.query;
  if (!steamid) return res.status(400).json({ error: "steamid обязателен" });

  let steamid64, steamidOld;
  try {
    steamid64  = toSteamID64(steamid);
    steamidOld = toSteamID(steamid64);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  let db;
  try {
    db = await mysql.createConnection({
      host:           process.env.DB_HOST     || "92.53.90.39",
      user:           process.env.DB_USER     || "gameserver33368",
      password:       process.env.DB_PASSWORD || "2pL00hVr",
      database:       process.env.DB_NAME     || "gameserver33368",
      connectTimeout: 8000,
    });
  } catch (e) {
    return res.status(500).json({ error: "DB_CONNECT: " + e.message });
  }

  let drp = {}, sam = {};

  // ── darkrp_player ──────────────────────────────────────────────────────────
  try {
    const [rows] = await db.execute(
      "SELECT CAST(uid AS CHAR) AS uid, wallet, rpname FROM darkrp_player WHERE uid = ? LIMIT 1",
      [steamid64]
    );
    drp = rows[0] || {};
  } catch (e) {
    await db.end();
    return res.status(500).json({ error: "DRP_QUERY: " + e.message });
  }

  // ── sam_players: сначала пробуем с rank, если нет колонки — без неё ────────
  let rank = "Игрок";
  let playTimeRaw = 0;
  try {
    const [rows] = await db.execute(
      "SELECT play_time, rank FROM sam_players WHERE steamid = ? LIMIT 1",
      [steamidOld]
    );
    if (rows[0]) {
      playTimeRaw = rows[0].play_time || 0;
      rank        = rows[0].rank      || "Игрок";
    }
  } catch (e) {
    // Возможно колонка rank называется иначе — пробуем без неё
    try {
      const [rows] = await db.execute(
        "SELECT play_time FROM sam_players WHERE steamid = ? LIMIT 1",
        [steamidOld]
      );
      if (rows[0]) playTimeRaw = rows[0].play_time || 0;
      rank = "Игрок"; // колонки rank нет — оставляем дефолт
    } catch (e2) {
      // таблица sam_players недоступна — не критично, продолжаем
    }
  }

  await db.end();

  // Форматируем время
  let playTime = "—";
  if (playTimeRaw) {
    const totalMin = Math.floor(playTimeRaw / 60);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    playTime = h > 0 ? `${h}ч ${m}м` : `${m}м`;
  }

  // Steam аватарка
  let avatar = null;
  const steamKey = process.env.STEAM_API_KEY;
  if (steamKey) {
    try {
      const r = await fetch(
        `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`
      );
      const d = await r.json();
      avatar = d?.response?.players?.[0]?.avatarmedium ?? null;
    } catch (_) {}
  }

  return res.status(200).json({
    steamid64,
    steamidOld,
    rpname:   drp.rpname ?? "Незнакомец",
    wallet:   drp.wallet  ?? 0,
    playTime,
    rank,
    avatar,
  });
}