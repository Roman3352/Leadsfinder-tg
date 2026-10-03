# Деплой с телефона (iPhone + Termius) на VPS (Ubuntu 24.04)

Рассчитано на то, что у вас уже есть сервер (например, созданный на Hetzner —
Ubuntu 24.04, любой тариф от CPX11) и вы подключаетесь к нему через Termius.

## 1. Подключение и первичная настройка

В Termius: New Host → IP сервера → логин `root` → пароль (пришёл на почту)
или SSH-ключ, если добавляли при создании сервера.

```bash
apt update && apt upgrade -y
apt install -y curl git
curl -fsSL https://get.docker.com | sh
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v   # должно показать v22...
```

Создать отдельного пользователя (не работать под root постоянно):

```bash
adduser --disabled-password --gecos "" leadfinder
usermod -aG docker leadfinder
mkdir -p /opt/lead-finder
chown leadfinder:leadfinder /opt/lead-finder
```

## 2. Загрузка кода

Самый простой способ без git — через SFTP прямо в Termius:
откройте host → значок SFTP внизу → перетащите распакованную папку проекта
в `/opt/lead-finder` на сервере (Termius поддерживает загрузку файлов из
приложения "Файлы" на iPhone).

Если удобнее через git — выложите код в приватный репозиторий на GitHub и:

```bash
su - leadfinder
cd /opt
git clone <ваш-репозиторий> lead-finder
cd lead-finder
```

## 3. Настройка

```bash
su - leadfinder
cd /opt/lead-finder
cp .env.example .env
nano .env
```

В nano впишите как минимум `TELEGRAM_BOT_TOKEN` и `GOOGLE_PLACES_API_KEY`
(`ALLOWED_TELEGRAM_IDS` пока можно оставить пустым — бот сам подскажет ваш ID
при первом сообщении). Сохранить: `Ctrl+O`, `Enter`, выйти: `Ctrl+X`.

```bash
npm run db:up
npm install
npm run db:generate
npm run db:push
npm run db:health
```

Должно вывести `✅ All 9 expected tables present`.

## 4. Первый запуск и получение своего Telegram ID

```bash
npm start
```

Откройте бота в Telegram, отправьте `/start` — он ответит вашим Telegram ID.
Остановите бота (`Ctrl+C`), впишите этот ID в `.env` → `ALLOWED_TELEGRAM_IDS`,
сохраните.

## 5. Постоянная работа (systemd)

Выйти обратно под root (`exit`) и:

```bash
cp /opt/lead-finder/deploy/lead-finder.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now lead-finder
systemctl status lead-finder
```

Логи в реальном времени: `journalctl -u lead-finder -f`.

Теперь бот работает постоянно, даже если вы закроете Termius и выключите
телефон. Обновления: залейте новые файлы в `/opt/lead-finder` и выполните
`systemctl restart lead-finder`.

## Дальше — только Telegram

После этого весь дальнейший контроль — из чата с ботом: `/start` → 🔎 Найти
клиентов. К серверу возвращаться нужно только для обновлений кода или если
что-то в логах пошло не так.
