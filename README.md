# AI Lead Finder — Telegram-бот

Личный инструмент: ищет в Google Places компании без сайта или с плохим сайтом
в выбранной нише/городе, дешёво их проверяет (без AI), для перспективных —
углублённо анализирует сайт (Firecrawl + PageSpeed), считает прозрачный
Lead Score, и по кнопке пишет вам объяснение (Sales Brief) и готовое
персональное сообщение клиенту на немецком.

Никакого веб-приложения нет специально: всё управление — кнопками в Telegram.
Бот работает через long polling, поэтому ему НЕ нужен домен, HTTPS или
открытый порт — только исходящий интернет.

## Что уже сделано

- Поиск компаний (Google Places, двухэтапно: Search → Details только для
  отобранных, чтобы не платить за дорогие поля массово)
- Определение "нет сайта" / только соцсеть вместо сайта
- Quick check сайта (без AI: https, mobile, CTA, контакты, портфолио и т.д.)
- Deep analysis (Firecrawl) и PageSpeed — только для перспективных сайтов,
  с кэшем по домену и бюджетными лимитами
- Прозрачный deterministic Lead Score 0–100 с расшифровкой "откуда баллы"
- AI Sales Brief и персональное outreach-сообщение на немецком (OpenAI,
  модель задаётся в `.env`, не зашита в код)
- Простой CRM (статусы, заметки, цена, избранное), фильтры и сортировка лидов
- Dashboard, Settings с оценкой расходов
- Бюджетные лимиты на каждый провайдер + общий месячный бюджет в EUR
- 102 автоматических теста (`npm test`), включая полный end-to-end прогон
  всего pipeline на подменных данных

## Быстрый старт (на сервере — см. DEPLOY.md, если у вас только телефон)

Для запуска требуется Node.js 20.6 или новее.

```bash
cp .env.example .env
# впишите как минимум: TELEGRAM_BOT_TOKEN, ALLOWED_TELEGRAM_IDS, GOOGLE_PLACES_API_KEY
npm run db:up          # поднимет Postgres в Docker
npm install
npm run db:generate
npm run db:push        # создаст таблицы по prisma/schema.prisma
npm run db:health      # проверка: соединение + все таблицы на месте
npm test                # 102 теста на всю бизнес-логику, без реальных API-ключей
npm start                # бот стартует (long polling)
```

Откройте бота в Telegram и отправьте `/start`.

Если `ALLOWED_TELEGRAM_IDS` пуст, бот на любое сообщение ответит вашим
Telegram ID — впишите его в `.env`, перезапустите бота, и он заработает.
Это защита: без этого бот не отвечает вообще никому, даже вам.

## Обязательные и опциональные ключи

Обязательно: `TELEGRAM_BOT_TOKEN`, `ALLOWED_TELEGRAM_IDS`, `GOOGLE_PLACES_API_KEY`.

Опционально (без них соответствующий шаг просто пропускается, остальное
работает): `FIRECRAWL_API_KEY` (deep analysis), `PAGESPEED_API_KEY`,
`OPENAI_API_KEY` + `DEFAULT_LLM_MODEL` (Sales Brief и сообщения).

## Бюджеты и стоимость

`MAX_GOOGLE_REQUESTS_PER_JOB`, `MAX_FIRECRAWL_CREDITS_PER_JOB`,
`MAX_PAGESPEED_REQUESTS_PER_JOB`, `MAX_AI_CALLS_PER_JOB` — лимиты на один
поиск. `MAX_MONTHLY_API_BUDGET` (EUR) — общий лимит на месяц, копится из
реального лога `ApiUsageLog`. Все ставки провайдеров, по которым считается
оценка стоимости — в `.env` (`GOOGLE_TEXT_SEARCH_USD_PER_1000_MAX` и т.д.),
это ПРИБЛИЗИТЕЛЬНЫЕ значения, сверьте с актуальными прайсами.

## Структура

```
src/
  bot/            — Telegram-бот (grammy): роутинг, клавиатуры, рендер, сессии
  jobs/           — budget-tracker, конкурентность, оркестратор одного поиска
  integrations/   — Google Places, Firecrawl, PageSpeed (только HTTP-клиенты)
  website-analysis/ — quick check, deep analysis, эвристики, pipeline
  scoring/        — deterministic Lead Score
  leads/          — Lead view-модель, репозиторий (фильтры/CRM), AI-обёртка
  llm/            — LLMProvider abstraction + OpenAI implementation
  config/         — env и pricing
prisma/schema.prisma
scripts/          — test-*.ts (npm test) и их fake-db заглушки
deploy/           — systemd unit для постоянной работы на сервере
```

## Тесты

`npm test` гоняет весь `scripts/test-*.ts` (все внешние API замоканы —
реальные ключи не нужны). Среди прочего есть полный end-to-end тест
(`test-run-job.ts`): от поиска в Google Places до готового Sales Brief,
на трёх бизнесах с разными исходными данными, с проверкой, что дешёвая
фильтрация действительно экономит вызовы Firecrawl/PageSpeed/AI и что
бюджетный лимит корректно и без падения останавливает job.
