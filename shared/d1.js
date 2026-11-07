// Серверный помощник для Cloudflare D1 (SQLite в облаке Cloudflare).
// Используется файлами api/*.js — хранится вне /api, чтобы не стать эндпоинтом.
//
// D1 доступна по HTTPS API, поэтому никакие npm-зависимости не нужны:
// Vercel-функция просто делает fetch на api.cloudflare.com.

const CF_API = "https://api.cloudflare.com/client/v4";

function getConfig() {
  const accountId   = process.env.CF_ACCOUNT_ID;
  const databaseId  = process.env.CF_D1_DATABASE_ID;
  const apiToken    = process.env.CF_D1_API_TOKEN;

  if (!accountId || !databaseId || !apiToken) {
    const err = new Error(
      "DB_CONFIG: задай переменные CF_ACCOUNT_ID, CF_D1_DATABASE_ID и CF_D1_API_TOKEN (см. SETUP.md)"
    );
    err.status = 500;
    throw err;
  }

  return {
    url: `${CF_API}/accounts/${accountId}/d1/database/${databaseId}/query`,
    token: apiToken,
  };
}

/**
 * Выполняет SQL-запрос в D1.
 * @param {string} sql   SQL с плейсхолдерами ?
 * @param {any[]}  [params] значения для плейсхолдеров
 * @returns {Promise<{rows: object[], meta: object}>}
 */
export async function d1Query(sql, params = []) {
  const cfg = getConfig();

  let res;
  try {
    res = await fetch(cfg.url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ sql, params }),
    });
  } catch (e) {
    const err = new Error("D1_FETCH: не удалось достучаться до Cloudflare — " + e.message);
    err.status = 502;
    throw err;
  }

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok || !data || data.success === false) {
    const msg =
      (Array.isArray(data?.errors) && data.errors.map((e) => e.message).join("; ")) ||
      `HTTP ${res.status}`;
    const err = new Error("D1_QUERY: " + msg);
    err.status = 502;
    throw err;
  }

  // Ответ: { result: [ { results: [...rows], meta: {...} } ] }
  const first = Array.isArray(data.result) ? data.result[0] : data.result;
  return {
    rows: (first && first.results) || [],
    meta: (first && first.meta) || {},
  };
}

// Схема таблицы данных игроков (создаётся автоматически)
export const PLAYERS_SCHEMA = `
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

export async function ensurePlayersTable() {
  await d1Query(PLAYERS_SCHEMA);
}
