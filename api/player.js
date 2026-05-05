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

  let result = {
    steamid64,
    steamidOld,
    rpname:   "Незнакомец",
    wallet:   25000,
    playTime: "0 минут",
    rank:     "Юзер",
    avatar:   null,
  };

  // ── darkrp_player ──────────────────────────────────────────────────────────
  try {
    const [rows] = await db.execute(
      "SELECT CAST(uid AS CHAR) AS uid, wallet, rpname FROM darkrp_player WHERE uid = ? LIMIT 1",
      [steamid64]
    );
    if (rows[0]) {
      result.rpname = rows[0].rpname ?? result.rpname;
      result.wallet = rows[0].wallet ?? result.wallet;
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
      result.playTime = formatPlayTime(rows[0].play_time);
      result.rank = rows[0]['rank'] || rows[0].rank || "Юзер";
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
      result.playTime = formatPlayTime(rows[0].play_time);
      result.rank = rows[0]['rank'] || rows[0].rank || "Юзер";
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