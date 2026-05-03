import mysql from "mysql2/promise";

/**
 * Конвертирует STEAM_0:X:Y → SteamID64
 * Также принимает уже готовый SteamID64 (если строка числовая и длинная)
 */
function toSteamID64(steamid) {
  // Уже SteamID64?
  if (/^\d{17}$/.test(steamid)) return steamid;

  // STEAM_0:X:Y или STEAM_1:X:Y
  const match = steamid.match(/^STEAM_\d:(\d):(\d+)$/i);
  if (!match) throw new Error("Неверный формат SteamID: " + steamid);

  const authserver = BigInt(match[1]);
  const authid = BigInt(match[2]);
  return (BigInt("76561197960265728") + authid * BigInt(2) + authserver).toString();
}

export default async function handler(req, res) {
  // CORS — разрешаем загрузочному экрану обращаться
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET");

  const { steamid } = req.query;
  if (!steamid) {
    return res.status(400).json({ error: "Параметр steamid обязателен" });
  }

  let steamid64;
  try {
    steamid64 = toSteamID64(steamid);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  // ── MySQL ──────────────────────────────────────────────────────────────────
  let db;
  try {
    db = await mysql.createConnection({
      host: process.env.DB_HOST || "92.53.90.39",
      user: process.env.DB_USER || "gameserver33368",
      password: process.env.DB_PASSWORD || "2pL00hVr",
      database: process.env.DB_NAME || "gameserver33368",
    });
  } catch (e) {
    return res.status(500).json({ error: "Ошибка подключения к БД" });
  }

  try {
    // darkrp_player: uid (steamid64), wallet, rpname, job (текущая профессия = "ранг")
    const [rows] = await db.execute(
      `SELECT
         CAST(uid AS CHAR) AS uid,
         wallet,
         rpname,
         job
       FROM darkrp_player
       WHERE uid = ?
       LIMIT 1`,
      [steamid64]
    );

    await db.end();

    if (rows.length === 0) {
      return res.status(404).json({ error: "Игрок не найден в базе" });
    }

    const player = rows[0];

    // ── Steam Web API — аватарка ───────────────────────────────────────────
    let avatar = null;
    const steamKey = process.env.STEAM_API_KEY; // задай в Vercel → Settings → Environment Variables
    if (steamKey) {
      try {
        const steamRes = await fetch(
          `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${steamKey}&steamids=${steamid64}`
        );
        const steamData = await steamRes.json();
        avatar = steamData?.response?.players?.[0]?.avatarmedium ?? null;
      } catch (_) {
        // Steam API недоступен — плашка покажется без аватарки
      }
    }

    return res.status(200).json({
      steamid64,
      rpname: player.rpname || "Незнакомец",
      wallet: player.wallet ?? 0,
      job: player.job || "Гражданин",
      avatar,
    });
  } catch (e) {
    await db.end?.();
    return res.status(500).json({ error: "Ошибка запроса к БД" });
  }
}
