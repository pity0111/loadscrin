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

function formatPlayTime(seconds) {
  if (!seconds || seconds <= 0) return "0 минут";
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} м` : `${m} м`;
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

  // ── Реквизиты БД — только из переменных окружения Vercel ─────────────────
  const dbHost = process.env.DB_HOST;
  const dbUser = process.env.DB_USER;
  const dbPass = process.env.DB_PASSWORD;
  const dbName = process.env.DB_NAME;
  const dbPort = Number(process.env.DB_PORT) || 3306;

  if (!dbHost || !dbUser || !dbPass || !dbName) {
    return res.status(500).json({
      error: "DB_CONFIG: не заданы переменные окружения DB_HOST, DB_USER, DB_PASSWORD, DB_NAME",
    });
  }

  let db;
  try {
    db = await mysql.createConnection({
      host:     dbHost,
      user:     dbUser,
      password: dbPass,
      database: dbName,
      port:     dbPort,
      connectTimeout: 8000,
    });
  } catch (e) {
    return res.status(500).json({ error: "DB_CONNECT: " + e.message });
  }

  let result = {
    steamid64,
    steamidOld,
    found:    false,   // найден ли игрок вообще в базе
    rpname:   null,
    wallet:   null,
    playTime: null,
    rank:     null,
    avatar:   null,
  };

  // ── darkrp_player ──────────────────────────────────────────────────────────
  try {
    const [rows] = await db.execute(
      "SELECT CAST(uid AS CHAR) AS uid, wallet, rpname FROM darkrp_player WHERE uid = ? LIMIT 1",
      [steamid64]
    );
    if (rows[0]) {
      result.found  = true;
      result.rpname = rows[0].rpname ?? null;
      result.wallet = rows[0].wallet ?? null;
    }
  } catch (e) {
    await db.end();
    return res.status(500).json({ error: "DRP_QUERY: " + e.message });
  }

  // ── sam_players: пробуем разные варианты названия колонки ранга ────────────
  // Вариант 1: play_time + rank
  try {
    const [rows] = await db.execute(
      "SELECT play_time, `rank` FROM sam_players WHERE steamid = ? LIMIT 1",
      [steamidOld]
    );
    if (rows[0]) {
      result.found    = true;
      result.playTime = formatPlayTime(rows[0].play_time);
      result.rank     = rows[0]['rank'] || null;
    }
    await db.end();

    // Steam аватарка
    const steamKey = process.env.STEAM_API_KEY;
    if (steamKey) {
      try {
        const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`);
        const d = await r.json();
        result.avatar = d?.response?.players?.[0]?.avatarmedium ?? null;
      } catch (_) {}
    }

    return res.status(200).json(result);
  } catch (e) {
    result._debug_v1 = e.message;
  }

  // Вариант 2: может колонка называется `group` вместо rank
  try {
    const [rows] = await db.execute(
      "SELECT play_time, `rank` AS rank FROM sam_players WHERE steamid = ? LIMIT 1",
      [steamidOld]
    );
    if (rows[0]) {
      result.found    = true;
      result.playTime = formatPlayTime(rows[0].play_time);
      result.rank     = rows[0]['rank'] || null;
    }
    await db.end();

    const steamKey = process.env.STEAM_API_KEY;
    if (steamKey) {
      try {
        const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`);
        const d = await r.json();
        result.avatar = d?.response?.players?.[0]?.avatarmedium ?? null;
      } catch (_) {}
    }

    return res.status(200).json(result);
  } catch (e) {
    result._debug_v2 = e.message;
  }

  // Вариант 3: только play_time без ранга
  try {
    const [rows] = await db.execute(
      "SELECT play_time FROM sam_players WHERE steamid = ? LIMIT 1",
      [steamidOld]
    );
    if (rows[0]) {
      result.found    = true;
      result.playTime = formatPlayTime(rows[0].play_time);
    }
  } catch (e) {
    result._debug_v3 = e.message;
  }

  await db.end();

  const steamKey = process.env.STEAM_API_KEY;
  if (steamKey) {
    try {
      const r = await fetch(`https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`);
      const d = await r.json();
      result.avatar = d?.response?.players?.[0]?.avatarmedium ?? null;
    } catch (_) {}
  }

  return res.status(200).json(result);
}