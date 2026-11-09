--[[
    sv_loadscreen_push.lua
    ─────────────────────────────────────────────────────────────────────────
    Отправляет данные игрока (RP-имя, деньги, ранг, наигранное время, работа)
    на загрузочный экран, когда игрок начинает подключаться.

    Как работает:
      1. При старте карты (и далее периодически) скрипт выгружает данные всех
         игроков из SQLite (sv.db: darkrp_player, sam_players) в облако —
         поэтому к моменту захода плашка уже знает игрока.
      2. Когда игрок начинает подключаться — CheckPassword / PlayerConnect /
         player_connect / ClientSignOnStateChanged отправляют данные ещё раз.
      3. После спавна (PlayerInitialSpawn) данные обновляются ещё раз
         (добавляются работа, актуальные деньги/имя из DarkRP-переменных).

    Куда класть:
      garrysmod/addons/loadscrin/lua/autorun/server/sv_loadscreen_push.lua

    Настройки — см. КОНФИГ ниже. SECRET должен совпадать с переменной
    PUSH_SECRET на Vercel (см. SETUP.md).
 ]]

-- ═══════════════════════════════════ КОНФИГ ══════════════════════════════════
local API_URL = "https://loadscrin.vercel.app/api/push"  -- адрес API
local SECRET  = "ЗАМЕНИ_МЕНЯ_НА_СЛУЧАЙНУЮСТРОКУ"         -- = PUSH_SECRET на Vercel
local ENABLED = true                                      -- вкл/выкл отправки
local DEBUG   = true                                      -- лог в серверную консоль

local COOLDOWN = 3     -- минимум секунд между пушами одного игрока
local SPAWN_DELAY = 3  -- задержка обновления данных после спавна (сек)

-- Повторные пуши после подключения (сек от первого). Нужны на случай, если
-- в первый момент база ещё читается/обновляется — один из пусков дойдёт.
local PUSH_RETRIES = { 8, 20, 40 }

-- ── Полная синхронизация sv.db → D1 ─────────────────────────────────────────
-- Самое важное: данные попадают в облако ДО того, как игрок увидит загрузочный
-- экран. При смене карты хуки подключения вообще не срабатывают, поэтому
-- без этой синхронизации плашка остаётся пустой.
local SYNC_ON_START = true    -- синхронизировать сразу после старта карты
local SYNC_DELAY    = 15      -- через сколько секунд после старта карты
local SYNC_INTERVAL = 1800    -- повторная синхронизация (сек), 0 = выключить
local SYNC_LIMIT    = 500     -- максимум игроков за один проход
local SYNC_SPACING  = 0.35    -- пауза между запросами при синхронизации (сек)
-- ════════════════════════════════════════════════════════════════════════════

local function Log(msg)
    if not DEBUG then return end
    MsgC(Color(120, 80, 255, 255), "[loadscrin] ",
         Color(230, 230, 230, 255), tostring(msg), "\n")
end

-- Секрет должен быть "серьёзной" строкой: только латиница и цифры,
-- минимум 8 символов. Такая проверка ловит и забытый дефолтный текст,
-- и запрещённые символы (пробелы, кириллица, & и = ломают URL запроса).
local function IsConfigured()
    if not ENABLED then return false end
    if not isstring(SECRET) or #SECRET < 8 then return false end
    if SECRET:find("[^%w]") then return false end
    return true
end

-- ── base64url ────────────────────────────────────────────────────────────────
-- Текстовые поля шлём в base64url: остаются только [A-Za-z0-9-_],
-- поэтому кириллица, пробелы и спецсимволы не ломают запрос
-- (неважно, кодирует ли GMod URL сам или нет).
local B64_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"

local function EncodeB64Url(s)
    if s == nil then return nil end
    s = tostring(s)

    -- Нативный base64 из GMod (если есть)
    if util and util.Base64Encode then
        local ok, res = pcall(util.Base64Encode, s, true)
        if ok and isstring(res) then
            res = res:gsub("\r", ""):gsub("\n", "")
            res = res:gsub("%+", "-"):gsub("%/", "_"):gsub("=", "")
            return res
        end
    end

    -- Запасной вариант: чистый Lua
    local out = {}
    for i = 1, #s, 3 do
        local a = s:byte(i)
        local b = s:byte(i + 1)
        local c = s:byte(i + 2)
        local n = a * 65536 + (b or 0) * 256 + (c or 0)
        out[#out + 1] = B64_CHARS:sub(math.floor(n / 262144) % 64 + 1, math.floor(n / 262144) % 64 + 1)
        out[#out + 1] = B64_CHARS:sub(math.floor(n / 4096) % 64 + 1,     math.floor(n / 4096) % 64 + 1)
        if b then
            out[#out + 1] = B64_CHARS:sub(math.floor(n / 64) % 64 + 1, math.floor(n / 64) % 64 + 1)
        end
        if c then
            out[#out + 1] = B64_CHARS:sub(n % 64 + 1, n % 64 + 1)
        end
    end
    return table.concat(out)
end

-- ── SteamID ──────────────────────────────────────────────────────────────────
local SID64_PATTERN = "^%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d$"
local SID_PATTERN   = "^STEAM_[01]:[01]:%d+$"

local function ToSteam64(v)
    if isnumber(v) then
        -- SteamID64 из sql.Query может прийти числом; tostring() даст
        -- экспоненциальную запись и потеряет точность, поэтому форматируем
        if v >= 1e15 then v = string.format("%.0f", v) else v = tostring(v) end
    end
    if not isstring(v) or v == "" then return nil end
    if v:match(SID64_PATTERN) then return v end
    local up = v:upper()
    if up:match(SID_PATTERN) and util and util.SteamIDTo64 then
        local s = util.SteamIDTo64(up)
        if isstring(s) and #s >= 15 and s:match("^%d+$") then return s end
    end
    return nil
end

local function ToOldSteamID(steamid64)
    if util and util.SteamIDFrom64 then
        local s = util.SteamIDFrom64(steamid64)
        if isstring(s) and s:match(SID_PATTERN) then return s end
    end
    return nil
end

-- ── Чтение SQLite (sv.db) ────────────────────────────────────────────────────
local schemaCache = {}
local pragmaSupported = nil   -- nil = ещё не пробовали, false = не поддерживается

local function TableExists(name)
    if schemaCache[name] then return true end
    local rows = sql.Query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '" .. name .. "'")
    local exists = istable(rows) and #rows > 0
    -- отрицательный результат НЕ кэшируем: таблица может появиться позже
    if exists then schemaCache[name] = true end
    return exists
end

local function GetColumns(tbl)
    local cacheKey = "cols:" .. tbl
    if schemaCache[cacheKey] then return schemaCache[cacheKey] end
    if not TableExists(tbl) then return {} end

    local cols = {}

    -- Способ 1: PRAGMA table_info (если GMod-версия его поддерживает)
    if pragmaSupported ~= false then
        local rows = sql.Query("PRAGMA table_info(" .. tbl .. ")")
        if istable(rows) and #rows > 0 then
            for _, r in ipairs(rows) do
                if r.name then cols[#cols + 1] = string.lower(r.name) end
            end
            pragmaSupported = true
        else
            pragmaSupported = false   -- больше не пробуем PRAGMA в этой сессии
        end
    end

    -- Способ 2: колонки берём из любой строки таблицы
    if #cols == 0 then
        local probe = sql.Query("SELECT * FROM " .. tbl .. " LIMIT 1")
        if istable(probe) and probe[1] then
            for k in pairs(probe[1]) do
                cols[#cols + 1] = string.lower(k)
            end
        end
    end

    -- Кэшируем только успешный результат: у пустой таблицы колонки могут
    -- появиться позже (в неё запишутся первые игроки)
    if #cols > 0 then schemaCache[cacheKey] = cols end
    return cols
end

local function FindCol(cols, ...)
    for _, want in ipairs({ ... }) do
        for _, c in ipairs(cols) do
            if c == want then return c end
        end
    end
    return nil
end

-- Возвращает строку с ключами в нижнем регистре (или nil)
local function ReadRow(tbl, col, value)
    if not col or value == nil then return nil end
    local q = "SELECT * FROM " .. tbl .. " WHERE " .. col ..
              " = " .. sql.SQLStr(tostring(value)) .. " LIMIT 1"
    local rows = sql.Query(q)
    if not istable(rows) or not rows[1] then return nil end

    local out = {}
    for k, v in pairs(rows[1]) do
        out[string.lower(k)] = v
    end
    return out
end

-- Собираем всё, что есть о игроке, из локальной базы
local function CollectDBData(steamid64, name)
    local data = { steamid = steamid64 }
    local old  = ToOldSteamID(steamid64)

    -- ── DarkRP: RP-имя и кошелёк ──
    local dcols = GetColumns("darkrp_player")
    if #dcols > 0 then
        local uidCol = FindCol(dcols, "uid", "steamid", "steamid64")
        local row = ReadRow("darkrp_player", uidCol, steamid64)
                 or (old and ReadRow("darkrp_player", uidCol, old))
        if row then
            local nameCol  = FindCol(dcols, "rpname", "name")
            local moneyCol = FindCol(dcols, "wallet", "money", "cash")
            if nameCol and isstring(row[nameCol]) and row[nameCol] ~= "" then
                data.rpname = row[nameCol]
            end
            if moneyCol and row[moneyCol] ~= nil then
                data.wallet = tonumber(row[moneyCol])
            end
        end
    end

    -- ── SAM: ранг и наигранное время ──
    local scols = GetColumns("sam_players")
    if #scols > 0 then
        local sidCol = FindCol(scols, "steamid", "steamid64", "uid")
        local row = (old and ReadRow("sam_players", sidCol, old))
                 or ReadRow("sam_players", sidCol, steamid64)
        if row then
            local rankCol  = FindCol(scols, "rank", "group", "usergroup")
            local timeCol  = FindCol(scols, "play_time", "playtime", "time_played", "total_time")
            if rankCol and isstring(row[rankCol]) and row[rankCol] ~= "" then
                data.rank = row[rankCol]
            end
            if timeCol and row[timeCol] ~= nil then
                data.play_time = math.floor(tonumber(row[timeCol]) or 0)
            end
        end
    end

    -- Если в базе ещё нет RP-имени — используем ник с подключения
    if not data.rpname and isstring(name) and name ~= "" then
        data.rpname = name
    end

    return data
end

local function HasData(data)
    return data.rpname ~= nil
        or data.wallet ~= nil
        or data.rank ~= nil
        or data.play_time ~= nil
        or data.job ~= nil
end

-- ── Отправка на API ──────────────────────────────────────────────────────────
local lastPush = {}

local function Send(data)
    if not IsConfigured() then
        Log("SECRET не настроен или содержит запрещённые символы — нужна латиница/цифры, минимум 8 (отредактируй начало файла)")
        return
    end
    if not data or not data.steamid then return end

    local url = API_URL
        .. "?steamid=" .. data.steamid
        .. "&enc=b64"
        .. "&secret=" .. SECRET

    if data.rpname    then url = url .. "&rpname="    .. EncodeB64Url(data.rpname) end
    if data.rank      then url = url .. "&rank="      .. EncodeB64Url(data.rank) end
    if data.job       then url = url .. "&job="       .. EncodeB64Url(data.job) end
    if data.wallet    then url = url .. "&wallet="    .. tostring(data.wallet) end
    if data.play_time then url = url .. "&play_time=" .. tostring(math.floor(data.play_time)) end

    http.Fetch(url,
        function(body, len, headers, code)
            code = tonumber(code) or 0
            if code >= 200 and code < 300 then
                Log("Отправлено [" .. data.steamid .. "] " ..
                    (data.rpname or "?") .. " | $" .. tostring(data.wallet or "-") ..
                    " | " .. (data.rank or "-"))
            else
                Log("Ошибка HTTP " .. tostring(code) .. ": " .. tostring(body))
            end
        end,
        function(err)
            Log("Ошибка отправки: " .. tostring(err))
        end,
        { ["X-Push-Secret"] = SECRET }
    )
end

-- Общий пуш из базы с защитой от спама
local function PushDB(steamid64, name)
    if not steamid64 then return end
    local now = CurTime()
    if lastPush[steamid64] and (now - lastPush[steamid64]) < COOLDOWN then return end

    local data = CollectDBData(steamid64, name)
    -- Пока нечего показывать (новый игрок, база пустая) — не помечаем отправленным,
    -- чтобы следующий триггер (player_connect с ником) смог отправить имя
    if not HasData(data) then return end

    lastPush[steamid64] = now
    Send(data)
end

-- Обновление после спавна: реальные переменные DarkRP + работа + группа
local function PushLive(ply)
    if not IsValid(ply) then return end
    local sid = ToSteam64(ply:SteamID64())
    if not sid then return end

    local data = CollectDBData(sid, ply:Nick())

    if not data.rpname then
        local v = ply.getDarkRPVar and ply:getDarkRPVar("rpname")
        data.rpname = v or ply:Nick()
    end
    if data.wallet == nil then
        local v = ply.getDarkRPVar and ply:getDarkRPVar("money")
        if v ~= nil then data.wallet = tonumber(v) end
    end
    if not data.rank then
        data.rank = ply:GetUserGroup()   -- ULX/SAM группа, если в базе ранга нет
    end
    if not data.job then
        local v = ply.getDarkRPVar and ply:getDarkRPVar("job")
        if not v and team then v = team.GetName(ply:Team()) end
        data.job = v
    end

    lastPush[sid] = CurTime()
    Send(data)
end

-- ═══════════════════ ПОЛНАЯ СИНХРОНИЗАЦИЯ sv.db → D1 ════════════════════════
-- Читает СПИСОК всех игроков из базы и по одному отправляет их данные в облако.
-- Это гарантирует, что к моменту захода игрока его данные уже в D1, даже если
-- хуки подключения не сработали (смена карты, реконнект и т.п.).
local syncQueue  = {}
local syncQueued = {}
local syncActive = false

local function SyncStep()
    local sid = table.remove(syncQueue, 1)
    if not sid then
        syncActive = false
        syncQueued = {}
        Log("Синхронизация завершена")
        return
    end
    syncQueued[sid] = nil

    local data = CollectDBData(sid)
    if HasData(data) then
        lastPush[sid] = CurTime()
        Send(data)
    end

    timer.Simple(SYNC_SPACING, SyncStep)
end

local function EnqueueSync(sid)
    if not sid or syncQueued[sid] then return end
    syncQueued[sid] = true
    syncQueue[#syncQueue + 1] = sid
end

-- Добавляет в очередь все SteamID из таблицы (колонку ищем автоматически)
local function QueueFromTable(tbl, cols, idNames)
    if #cols == 0 then return end
    local col = FindCol(cols, unpack(idNames))
    if not col then return end

    local rows = sql.Query(
        "SELECT " .. col .. " AS loadscrin_sid FROM " .. tbl ..
        " LIMIT " .. math.floor(SYNC_LIMIT)
    )
    if not istable(rows) then return end

    for _, r in ipairs(rows) do
        -- берём единственное значение из строки (имя колонки может отличаться)
        for _, v in pairs(r) do
            EnqueueSync(ToSteam64(v))
            break
        end
    end
end

local function SyncAll(reason)
    local before = #syncQueue

    QueueFromTable("darkrp_player", GetColumns("darkrp_player"), { "uid", "steamid", "steamid64" })
    QueueFromTable("sam_players",   GetColumns("sam_players"),   { "steamid", "steamid64", "uid" })

    local added = #syncQueue - before
    Log("Синхронизация (" .. tostring(reason) .. "): " .. added .. " игрок(ов) в очереди")

    if #syncQueue > 0 and not syncActive then
        syncActive = true
        timer.Simple(1, SyncStep)
    end
end

-- ═══════════════════════════ ХУКИ ПОДКЛЮЧЕНИЯ ═══════════════════════════════
if not IsConfigured() then
    Log("!! ВНИМАНИЕ: SECRET не задан или содержит запрещённые символы (нужна латиница/цифры, минимум 8) !!")
end

-- Серия повторных пушей для одного игрока.
-- Каждый новый вызов отменяет предыдущую серию (по номеру поколения).
local burstGen  = {}
local lastBurst = {}

local function Burst(steamid64, name, tag)
    if not steamid64 then return end

    burstGen[steamid64] = (burstGen[steamid64] or 0) + 1
    local gen = burstGen[steamid64]

    Log(tag .. ": отправляю данные для " .. steamid64)

    local function attempt()
        if burstGen[steamid64] ~= gen then return end   -- серию отменили
        local ply = player.GetBySteamID64 and player.GetBySteamID64(steamid64)
        if IsValid(ply) then
            PushLive(ply)          -- игрок уже в мире — берём живые данные DarkRP
        else
            PushDB(steamid64, name) -- ещё грузится — читаем из sv.db
        end
    end

    attempt()
    for _, delay in ipairs(PUSH_RETRIES) do
        timer.Simple(delay, attempt)
    end
end

-- Не дёргаем серию чаще, чем раз в 10 секунд на игрока
-- (CheckPassword, player_connect и signon срабатывают почти одновременно)
local function MaybeBurst(steamid64, name, tag)
    if not steamid64 then return end
    local now = CurTime()
    if lastBurst[steamid64] and (now - lastBurst[steamid64]) < 10 then return end
    lastBurst[steamid64] = now
    Burst(steamid64, name, tag)
end

-- 1. Самый ранний момент: игрок только начал подключаться
hook.Add("CheckPassword", "loadscrin_push_checkpassword", function(steamid64, ip, svPass, clPass, name)
    if not ENABLED then return end
    MaybeBurst(ToSteam64(steamid64), name, "CheckPassword")
    -- ничего не возвращаем: на проверку пароля не влияем
end)

-- 2. Хук подключения (не срабатывает при смене карты, но ловит новых игроков)
hook.Add("PlayerConnect", "loadscrin_push_playerconnect", function(name, ip)
    if not ENABLED then return end
    for _, ply in ipairs(player.GetAll()) do
        if IsValid(ply) and ply:Nick() == name then
            MaybeBurst(ToSteam64(ply:SteamID64()), name, "PlayerConnect")
            return
        end
    end
end)

-- 3. Игровое событие подключения: содержит networkid (SteamID)
gameevent.Listen("player_connect", function(ev)
    if not ENABLED then return end
    MaybeBurst(ToSteam64(ev.networkid or ev.steamid), ev.name, "player_connect")
end)

-- 4. Игрок прошёл авторизацию в Steam (есть и валидный Player, и SteamID)
hook.Add("PlayerAuthed", "loadscrin_push_authed", function(ply, steamid)
    if not ENABLED then return end
    local sid = ToSteam64(steamid) or (IsValid(ply) and ToSteam64(ply:SteamID64()))
    MaybeBurst(sid, IsValid(ply) and ply:Nick() or nil, "PlayerAuthed")
end)

-- 5. Steam подтвердил SteamID (самый ранний момент с готовым SteamID)
--    Внимание: у этого хука НЕТ аргумента Player — только name, steamID, ownerID
hook.Add("NetworkIDValidated", "loadscrin_push_netvalidated", function(name, steamid, ownerid)
    if not ENABLED then return end
    MaybeBurst(ToSteam64(steamid) or ToSteam64(ownerid), name, "NetworkIDValidated")
end)

-- 6. После спавна — обновляем данные (работа, деньги, имя из DarkRP)
hook.Add("PlayerInitialSpawn", "loadscrin_push_initialspawn", function(ply)
    if not ENABLED or not IsValid(ply) or ply:IsBot() then return end
    timer.Simple(SPAWN_DELAY, function()
        if IsValid(ply) then PushLive(ply) end
    end)
end)

-- 7. Синхронизация всей базы при старте карты и далее периодически.
--    Именно это делает плашку непустой при обычном заходе (и при смене карты).
if ENABLED and IsConfigured() then
    if SYNC_ON_START then
        timer.Simple(SYNC_DELAY, function() SyncAll("старт карты") end)
    end
    if SYNC_INTERVAL and SYNC_INTERVAL > 0 then
        timer.Create("loadscrin_sync", SYNC_INTERVAL, 0, function() SyncAll("периодическая") end)
    end
end

-- Периодическая чистка кэшей (чтобы таблицы не росли бесконечно)
timer.Create("loadscrin_push_cleanup", 300, 0, function()
    local now = CurTime()
    for sid, t in pairs(lastPush) do
        if now - t > 120 then lastPush[sid] = nil end
    end
    for sid, t in pairs(lastBurst) do
        if now - t > 120 then lastBurst[sid] = nil end
    end
    for sid, gen in pairs(burstGen) do
        if not lastBurst[sid] then burstGen[sid] = nil end
    end
end)

-- ═════════════════════ ОТЛАДКА: команда в консоли ═══════════════════════════
-- loadscrin_test <steamid64 или STEAM_0:X:Y>  — читает базу и шлёт на API
-- Доступно только консоли сервера и админам
concommand.Add("loadscrin_test", function(ply, _, args)
    if IsValid(ply) and not ply:IsAdmin() then return end
    local raw = table.concat(args or {}, " ")
    local sid = ToSteam64(raw)
    if not sid then
        Log("Использование: loadscrin_test <steamid64|STEAM_0:X:Y>")
        return
    end
    local data = CollectDBData(sid, nil)
    Log("Данные из базы для " .. sid .. ":")
    PrintTable(data)
    if HasData(data) then
        lastPush[sid] = nil
        PushDB(sid, nil)
    else
        Log("В базе по этому SteamID ничего нет — отправляю пустую запись (тест канала)")
        Send(data)
    end
end)

-- loadscrin_syncall — вручную запустить полную синхронизацию sv.db → D1.
-- Полезно после установки/обновления скрипта: сразу заливает всех игроков,
-- не дожидаясь старта карты.
concommand.Add("loadscrin_syncall", function(ply)
    if IsValid(ply) and not ply:IsAdmin() then return end
    SyncAll("команда")
end)
