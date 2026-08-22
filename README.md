# PifPaf Reels — кабинет блогера

Vanilla JS + Express + SQLite. Просмотры/обложки/даты рилсов через Apify.

## Локально

```bash
cp .env.example .env
# впиши APIFY_TOKEN с https://console.apify.com/account/integrations
npm install
npm run dev
```

Открой http://localhost:3000

## Деплой (Render)

1. New → Web Service → подключи репозиторий
2. Build: `npm install`
3. Start: `npm start`
4. Env: `APIFY_TOKEN`, `SESSION_SECRET`, `NODE_ENV=production`

Или кнопка ниже / CLI:

```bash
# пример через Railway
railway up
```
