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
  if (!steamid) return res.status(400).json({ error: "Параметр steamid обязателен" });

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
    return res.status(500).json({ error: "Ошибка подключения к БД: " + e.message });
  }

  try {
    const [drpRows] = await db.execute(
      `SELECT CAST(uid AS CHAR) AS uid, wallet, rpname
       FROM darkrp_player WHERE uid = ? LIMIT 1`,
      [steamid64]
    );

    // rank добавлен в запрос
    const [samRows] = await db.execute(
      `SELECT play_time, rank
       FROM sam_players WHERE steamid = ? LIMIT 1`,
      [steamidOld]
    );

    await db.end();

    if (drpRows.length === 0 && samRows.length === 0) {
      return res.status(404).json({ error: "Игрок не найден" });
    }

    const drp = drpRows[0] || {};
    const sam = samRows[0] || {};

    // Время: секунды → "Xч Yм"
    let playTimeFormatted = "—";
    if (sam.play_time) {
      const totalMinutes = Math.floor(sam.play_time / 60);
      const hours        = Math.floor(totalMinutes / 60);
      const minutes      = totalMinutes % 60;
      playTimeFormatted  = hours > 0 ? `${hours}ч ${minutes}м` : `${minutes}м`;
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
      rpname:   drp.rpname   ?? "Незнакомец",
      wallet:   drp.wallet   ?? 0,
      playTime: playTimeFormatted,
      rank:     sam.rank     ?? "Игрок",
      avatar,
    });

  } catch (e) {
    await db.end?.();
    return res.status(500).json({ error: "Ошибка запроса: " + e.message });
  }
}