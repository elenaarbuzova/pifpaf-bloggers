# PifPaf Reels — кабинет блогера

## Локально

```bash
cp .env.example .env
# APIFY_TOKEN → https://console.apify.com/account/integrations
npm install
npm start
```

http://localhost:3000

## Деплой на Render (стабильный URL)

1. Открой: **https://render.com/deploy?repo=https://github.com/elenaarbuzova/pifpaf-bloggers**
2. Подключи GitHub, нажми **Apply**
3. В Environment добавь `APIFY_TOKEN` (твой ключ Apify)
4. Дождись деплоя — получишь URL вида `https://pifpaf-bloggers.onrender.com`

`render.yaml` уже в репозитории — Render подхватит настройки сам.

## Что умеет

- Личные кабинеты блогеров
- Reel по ссылке → просмотры, дата, обложка через Apify
- Total Views, средние, график по дням, период 7/30/90Д
- Лента сетка / список
