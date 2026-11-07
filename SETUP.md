# Настройка загрузочного экрана (Vercel + Turso + SQLite)

## Как это работает

```
┌─────────────────────┐   читает sv.db     ┌──────────────────────┐
│  GMod-сервер        │  (darkrp_player,   │  API на Vercel       │
│  sv_loadscreen_     │   sam_players)     │  /api/push  (запись) │
│  push.lua           │ ─────────────────► │  /api/player (чтение)│
└─────────────────────┘   HTTP GET при     └──────────┬───────────┘
                                    подключении       │
                                                      ▼
                                           ┌──────────────────────┐
                                           │  Turso (SQLite)      │
                                           │  таблица players     │
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

MySQL больше не нужен: все данные игроков лежат в SQLite (Turso — это SQLite
в облаке), а отдаются они на экран только после того, как Lua-скрипт положил
их туда при подключении игрока.

---

## Шаг 1. Turso (база данных)

1. Зарегистрируйтесь на <https://turso.tech> (есть бесплатный тир).
2. Установите CLI и создайте базу:

```bash
curl -sSfL https://get.turso.io | bash
turso auth login
turso db create loadscrin
turso db show loadscrin --url     # это TURSO_DATABASE_URL
turso db tokens create loadscrin  # это TURSO_AUTH_TOKEN
```

3. Таблица создастся автоматически при первом запросе API.
   При желании создайте её вручную — SQL лежит в `api/schema.sql`
   (в консоли Turso: Database → SQL → вставить).

## Шаг 2. Vercel (переменные окружения)

В проекте на Vercel → **Settings → Environment Variables** добавьте:

| Переменная | Значение |
|---|---|
| `TURSO_DATABASE_URL` | URL базы из `turso db show --url` |
| `TURSO_AUTH_TOKEN` | токен из `turso db tokens create` |
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

Проверить базу:

```bash
turso db shell loadscrin "SELECT * FROM players"
```

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

Перезапустите сервер (или сделайте `changeload`/`changelevel`).

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
| `Ошибка HTTP 500` + `DB_CONFIG` | Не заданы `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN`, или не был Redeploy после добавления env |
| `Ошибка отправки: ...` | Сервер не может достучаться до `loadscrin.vercel.app` (проверь доступ к исходящему HTTP на хостинге) |
| В базе пусто, хотя игроки есть | Данные пишутся только при подключении — зайди на сервер один раз и повтори `loadscrin_test` |
| Кириллица кракозябрами | Не должно случаться: текст шлётся в base64url. Если всё же видишь мусор — пришли лог |

## Файлы проекта

```
loadscrin/
├── index.html                     # сам загрузочный экран (логика плашки обновлена)
├── sleek.js / sleek.css           # прогресс, статус, фон
├── api/
│   ├── player.js                  # GET  — отдаёт данные игрока (Turso)
│   ├── push.js                    # POST/GET — приём данных от Lua (Turso)
│   ├── schema.sql                 # схема таблицы (создаётся автоматически)
│   └── package.json
├── lua/autorun/server/
│   └── sv_loadscreen_push.lua     # ← скрипт для GMod-сервера
├── package.json
└── SETUP.md                       # этот файл
```
