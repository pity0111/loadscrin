// Серверные хелперы для SteamID и времени игры (используются api/*.js)

export function toSteamID64(steamid) {
  if (/^\d{17}$/.test(steamid)) return steamid;
  const match = String(steamid).match(/^STEAM_\d:(\d):(\d+)$/i);
  if (!match) throw new Error("Неверный формат SteamID: " + steamid);
  const authserver = BigInt(match[1]);
  const authid     = BigInt(match[2]);
  return (BigInt("76561197960265728") + authid * BigInt(2) + authserver).toString();
}

export function toSteamID(steamid64) {
  const big  = BigInt(steamid64) - BigInt("76561197960265728");
  const auth = big % BigInt(2);
  const id   = (big - auth) / BigInt(2);
  return `STEAM_0:${auth}:${id}`;
}

export function formatPlayTime(seconds) {
  seconds = Number(seconds) || 0;
  if (seconds <= 0) return "0 минут";
  const totalMin = Math.floor(seconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} м` : `${m} м`;
}
