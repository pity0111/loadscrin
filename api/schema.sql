-- Схема базы данных загрузочного экрана (Turso / SQLite).
-- API создаёт эту таблицу автоматически, вручную запускать не обязательно.
CREATE TABLE IF NOT EXISTS players (
  steamid64 TEXT PRIMARY KEY,  -- SteamID64 игрока
  steamid   TEXT,              -- STEAM_0:X:Y
  rpname    TEXT,              -- RP-имя
  wallet    INTEGER,           -- деньги (DarkRP wallet)
  rank      TEXT,              -- ранг (SAM)
  play_time INTEGER,           -- наиграно, секунд
  job       TEXT,              -- работа/должность
  updated_at INTEGER           -- когда обновлено (unix)
);
