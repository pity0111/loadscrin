# Настройка загрузочного экрана (Vercel + Cloudflare D1)

## Как это работает

```
┌─────────────────────┐   читает sv.db     ┌──────────────────────┐
│  GMod-сервер        │  (darkrp_player,   │  API на Vercel       │
│  sv_loadscreen_     │   sam_players)     │  /api/push  (запись) │
│  push.lua           │ ─────────────────► │  /api/player (чтение)│
└─────────────────────┘   HTTP GET при     └──────────┬───────────┘
                                    подключения       │ HTTPS API
                                                      ▼
                                           ┌──────────────────────┐
                                           │ Cloudflare D1        │
                                           │ (SQLite в облаке)    │
                                           │ таблица players      │
                                           └──────────────────────┘
                                                      ▲
                                           ┌──────────┴───────────┐
                                           │ Загрузочный экран    │
                                           │ (index.html в CEF)   │
                                           │ ждёт steamid из      │
                                           │ GameDetails и читает │
                                           │ /api/player          │
                                           └──────────────────────┘
```

MySQL и Turso не нужны: данные игроков лежат в **Cloudflare D1** — это
обычный SQLite, только в облаке Cloudflare (регистрация и работа доступны
из РФ, карта не нужна, бесплатный тир). Vercel-функции ходят в D1 по
HTTPS API, поэтому никакие npm-зависимости не используются.

---

## Шаг 1. Cloudflare (база данных D1)

### 1.1 Регистрация

<https://dash.cloudflare.com/sign-up> — email и пароль, карта не нужна.

### 1.2 Создать базу

В левой панели найди раздел **D1** (если его нет — Workers & Pages → D1) →
**Create database**:

- Имя: `loadscrin`
- Location: можно «Automatic» (важно лишь то, что база доступна по HTTPS)

### 1.3 Таблица

В карточке базы → вкладка **Console** → вставь содержимое `api/schema.sql`
→ **Run**.

> Не обязательно: таблица создаётся автоматически при первом запросе API.

### 1.3 API-токен

Аватарка (правый верхний) → **My Profile** → **API Tokens** →
**Create Token** → **Create Custom Token**:

| Поле | Значение |
|---|---|
| Permissions | **Account** → **D1** → **Edit** |
| Account Resources | **Include** → **Specific account** → твой аккаунт |

→ Continue to summary → имя `loadscrin-vercel` → **Create Token** →
**Copy** (токен показывается только один раз!).

### 1.4 Идентификаторы

- **Account ID**: главная страница дашборда, блок справа (или в URL сразу
  после `dash.cloudflare.com/`)
- **Database ID**: D1 → база `loadscrin` → вкладка Info → **Copy Database ID**

## Шаг 2. Vercel (переменные окружения)

В проекте на Vercel → **Settings → Environment Variables** добавьте:

| Переменная | Что туда положить |
|---|---|
| `CF_ACCOUNT_ID` | Account ID из Cloudflare |
| `CF_D1_DATABASE_ID` | Database ID из Cloudflare |
| `CF_D1_API_TOKEN` | созданный API-токен |
| `PUSH_SECRET` | случайная строка **только из букв и цифр** (см. ниже) |
| `STEAM_API_KEY` | *опционально* — чтобы были аватарки Steam |

Сгенерировать секрет (PowerShell):

```powershell
$chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'
-join((1..24) | ForEach-Object { $chars[(Get-Random $chars.Length)] })
```

> Важно: секрет попадает в URL запроса, поэтому только латиница/цифры —
> без пробелов, `&`, `=`, кириллицы.

После добавления переменных — **Redeploy** проекта (Deployments → ⋯ → Redeploy),
иначе функции не подхватят новые env.

Задеплойте код (git-push в подключённый репозиторий или `vercel --prod`).

## Шаг 3. Проверка API (PowerShell)

```powershell
# 1) «Кладём» тестовые данные (можно писать обычным текстом, без base64)
curl.exe "https://loadscrin.vercel.app/api/push?steamid=76561198012345678&secret=ТВОЙ_SECRET&rpname=Ivan&wallet=123456&rank=VIP&play_time=7200&job=Gangster"

# 2) «Читаем» их обратно
curl.exe "https://loadscrin.vercel.app/api/player?steamid=76561198012345678"
```

Ожидаемо: первый вернёт `{"ok":true,...}`, второй — `{"found":true,"rpname":"Ivan",...}`.

Проверить базу: D1 → база `loadscrin` → **Console** →
`SELECT * FROM players;` → **Run**.

## Шаг 4. Lua-скрипт на GMod-сервере (MyArena)

Файл: `lua/autorun/server/sv_loadscreen_push.lua`
(положить как `garrysmod/addons/loadscrin/lua/autorun/server/sv_loadscreen_push.lua`
— через FTP/файловый менеджер хостинга)

В начале файла задайте:

```lua
local API_URL = "https://loadscrin.vercel.app/api/push"
local SECRET  = "ТВОЙ_ТОТ_ЖЕ_SECRET"   -- должен совпадать с PUSH_SECRET
local DEBUG   = true                    -- лог в консоль сервера
```

Перезапустите сервер (или сделайте `changelevel`).

Скрипт шлёт данные в три момента:

1. **`CheckPassword`** — игрок только начал подключаться: читает из sv.db
   RP-имя, кошелёк (`darkrp_player`), ранг и время игры (`sam_players`).
2. **`player_connect`** — то же самое, но с ником игрока
   (для игроков, которых ещё нет в базе).
3. **`PlayerInitialSpawn` +3 c** — обновление: работа, актуальные деньги/имя
   из DarkRP-переменных, группа пользователя (если ранга нет в базе).

### Проверка в игре

В серверной консоли:

```
loadscrin_test 76561198012345678
```

Скрипт напечатает `[loadscrin] Данные из базы для ...` и результат отправки.
Если в консоли появляется `SECRET не настроен` — не совпадает/не задан SECRET.

### Какие таблицы читаются

| Таблица | Что берётся | Колонки (ищутся автоматически) |
|---|---|---|
| `darkrp_player` | имя, деньги | `uid`/`steamid`, `rpname`, `wallet`/`money` |
| `sam_players` | ранг, время игры | `steamid`, `rank`, `play_time` |

Скрипт сам смотрит через `PRAGMA table_info`, так что отличие в названии
колонки (например `playtime` вместо `play_time`) не сломает работу.
Если у тебя другая таблица с временем игры — скажи, добавлю.

## Шаг 5. Загрузочный экран

- `sv_loadingurl "https://loadscrin.vercel.app"` (или твой домен).
- Если домен другой — поменяй его в двух местах:
  - `index.html` → `var API_BASE = 'https://loadscrin.vercel.app/api';`
  - `sv_loadscreen_push.lua` → `local API_URL = ".../api/push"`
- На плашке игрок увидит: RP-имя, ранг, кошелёк, наигранное время и
  аватарку Steam (аватарка требует `STEAM_API_KEY`).

Плашка появляется сразу с shimmer-эффектом и заполняется, как только данные
доедут (обычно 1–5 секунд после начала подключения). Если данных ещё нет
(`found:false`), экран повторяет запрос до 14 раз (~45 сек).

---

## Частые проблемы

| Симптом | Причина / решение |
|---|---|
| На экране «Нет данных» | Посмотри лог `[loadscrin]` в консоли сервера и сделай `loadscrin_test <steamid64>` |
| `Ошибка HTTP 401` | `SECRET` в Lua не совпадает с `PUSH_SECRET` на Vercel |
| `error: DB_CONFIG: ...` | Не заданы `CF_ACCOUNT_ID` / `CF_D1_DATABASE_ID` / `CF_D1_API_TOKEN`, или не был Redeploy после добавления env |
| `error: D1_QUERY: Invalid access token` | Токен неверный или без права **D1 → Edit**; проверь, что привязан к нужному аккаунту |
| `error: D1_FETCH: ...` | Vercel не может достучаться до api.cloudflare.com (крайне редко) |
| `error: D1_QUERY: no such table` | Проверь, что база создана и `CF_D1_DATABASE_ID` именно от неё |
| В базе пусто, хотя игроки есть | Данные пишутся только при подключении — зайди на сервер один раз и повтори `loadscrin_test` |
| Кириллица кракозябрами | Не должно случаться: текст шлётся в base64url. Если всё же видишь мусор — пришли лог |

## Файлы проекта

```
loadscrin/
├── index.html                     # сам загрузочный экран (логика плашки обновлена)
├── sleek.js / sleek.css           # прогресс, статус, фон
├── api/
│   ├── player.js                  # GET  — отдаёт данные игрока (D1)
│   ├── push.js                    # GET/POST — приём данных от Lua (D1)
│   ├── schema.sql                 # схема таблицы (создаётся автоматически)
│   └── package.json
├── shared/                        # серверный код, общий для api/*.js
│   ├── d1.js                      # клиент Cloudflare D1 (HTTPS API)
│   └── steamid.js                 # конвертация SteamID и формат времени
├── lua/autorun/server/
│   └── sv_loadscreen_push.lua     # ← скрипт для GMod-сервера
├── package.json
└── SETUP.md                       # этот файл
```
