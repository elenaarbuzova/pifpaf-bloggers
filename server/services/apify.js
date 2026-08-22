import { ApifyClient } from 'apify-client';

const REEL_URL_RE =
  /^https?:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/[A-Za-z0-9_-]+\/?/i;

export function isValidInstagramUrl(url) {
  try {
    const u = new URL(url.trim());
    return REEL_URL_RE.test(u.href);
  } catch {
    return false;
  }
}

function pickViews(item) {
  const keys = [
    'videoViewCount',
    'videoPlayCount',
    'playCount',
    'viewCount',
    'viewsCount',
    'video_view_count',
  ];
  for (const k of keys) {
    if (typeof item[k] === 'number') return item[k];
  }
  return 0;
}

function pickCover(item) {
  return (
    item.displayUrl ||
    item.thumbnailUrl ||
    item.thumbnail_url ||
    item.imageUrl ||
    item.coverUrl ||
    (Array.isArray(item.images) ? item.images[0] : null) ||
    null
  );
}

function pickDate(item) {
  const raw =
    item.timestamp ||
    item.takenAt ||
    item.taken_at_timestamp ||
    item.publishedAt ||
    item.date;
  if (!raw) return null;
  if (typeof raw === 'number') {
    const ms = raw < 1e12 ? raw * 1000 : raw;
    return new Date(ms).toISOString();
  }
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? String(raw) : d.toISOString();
}

export async function scrapeReel(instagramUrl) {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    throw new Error('APIFY_TOKEN не задан. Добавь токен в .env');
  }

  const client = new ApifyClient({ token });
  const actorId =
    process.env.APIFY_ACTOR_ID || 'apify/instagram-reel-scraper';

  const input = {
    directUrls: [instagramUrl.trim()],
    resultsLimit: 1,
    resultsType: 'posts',
  };

  const run = await client.actor(actorId).call(input, {
    waitSecs: 120,
  });

  const { items } = await client.dataset(run.defaultDatasetId).listItems();
  if (!items?.length) {
    throw new Error('Apify не вернул данные по этой ссылке');
  }

  const item = items[0];
  if (item.error || item.errorDescription) {
    throw new Error(item.errorDescription || item.error || 'Ошибка скрапинга');
  }

  return {
    views_count: pickViews(item),
    cover_url: pickCover(item),
    publish_date: pickDate(item),
  };
}
