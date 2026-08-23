import { Router } from 'express';
import crypto from 'crypto';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';
import { isValidInstagramUrl, scrapeReel, normalizeInstagramUrl } from '../services/apify.js';
import { cacheCover, removeCover } from '../services/covers.js';
import { humanizeApifyError } from '../services/errors.js';

const router = Router();
router.use(requireAuth);

function mapVideo(row) {
  return {
    id: row.id,
    instagram_url: row.instagram_url,
    cover_url: row.cover_url,
    views_count: row.views_count ?? 0,
    publish_date: row.publish_date,
    status: row.status,
    error_message: row.error_message,
    updated_at: row.updated_at,
    created_at: row.created_at,
  };
}

async function processVideo(videoId, url) {
  const db = getDb();
  try {
    const data = await scrapeReel(url);
    const cachedCover = await cacheCover(videoId, data.cover_url);
    db.prepare(
      `UPDATE videos
       SET instagram_url = ?, cover_url = ?, views_count = ?, publish_date = ?,
           status = 'ready', error_message = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(
      data.instagram_url || url,
      cachedCover,
      data.views_count,
      data.publish_date,
      videoId
    );
  } catch (err) {
    console.error('Apify error:', err.message);
    db.prepare(
      `UPDATE videos
       SET status = 'failed', error_message = ?,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(humanizeApifyError(err.message), videoId);
  }
}

router.get('/', (req, res) => {
  try {
    const rows = getDb()
      .prepare(
        `SELECT * FROM videos
         WHERE user_id = ?
         ORDER BY datetime(created_at) DESC`
      )
      .all(req.session.userId);
    res.json({ videos: rows.map(mapVideo) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось загрузить видео' });
  }
});

router.get('/stats', (req, res) => {
  try {
    const db = getDb();
    const userId = req.session.userId;

    const row = db
      .prepare(
        `SELECT
           COALESCE(SUM(CASE WHEN status = 'ready' THEN views_count ELSE 0 END), 0) AS total_views,
           COUNT(*) AS total_videos,
           SUM(CASE WHEN status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
           COALESCE(AVG(CASE WHEN status = 'ready' THEN views_count END), 0) AS avg_views
         FROM videos WHERE user_id = ?`
      )
      .get(userId);

    const topReel = db
      .prepare(
        `SELECT id, instagram_url, cover_url, views_count, publish_date
         FROM videos
         WHERE user_id = ? AND status = 'ready'
         ORDER BY views_count DESC, datetime(created_at) DESC
         LIMIT 1`
      )
      .get(userId);

    const dayRows = db
      .prepare(
        `SELECT
           date(COALESCE(publish_date, created_at)) AS day,
           COALESCE(SUM(views_count), 0) AS views,
           COUNT(*) AS reels
         FROM videos
         WHERE user_id = ? AND status = 'ready'
         GROUP BY day
         ORDER BY day DESC
         LIMIT 14`
      )
      .all(userId);

    res.json({
      total_views: row.total_views || 0,
      total_videos: row.total_videos || 0,
      ready_count: row.ready_count || 0,
      avg_views: Math.round(row.avg_views || 0),
      top_reel: topReel
        ? {
            id: topReel.id,
            instagram_url: topReel.instagram_url,
            cover_url: topReel.cover_url,
            views_count: topReel.views_count,
            publish_date: topReel.publish_date,
          }
        : null,
      views_by_day: dayRows.reverse().map((d) => ({
        date: d.day,
        views: d.views,
        reels: d.reels,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось посчитать статистику' });
  }
});

router.post('/', (req, res) => {
  try {
    const instagram_url = normalizeInstagramUrl(
      String(req.body.instagram_url || '').trim()
    );
    if (!isValidInstagramUrl(instagram_url)) {
      return res.status(400).json({
        error: 'Нужна ссылка на Instagram Reel или пост',
      });
    }

    const db = getDb();
    const dup = db
      .prepare(
        `SELECT id FROM videos WHERE user_id = ? AND instagram_url = ?`
      )
      .get(req.session.userId, instagram_url);
    if (dup) {
      return res.status(409).json({ error: 'Это видео уже в ленте' });
    }

    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO videos (id, user_id, instagram_url, status)
       VALUES (?, ?, ?, 'processing')`
    ).run(id, req.session.userId, instagram_url);

    const video = db.prepare('SELECT * FROM videos WHERE id = ?').get(id);
    res.status(201).json({ video: mapVideo(video) });

    setImmediate(() => processVideo(id, instagram_url));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось добавить видео' });
  }
});

router.post('/:id/refresh', (req, res) => {
  try {
    const db = getDb();
    const video = db
      .prepare('SELECT * FROM videos WHERE id = ? AND user_id = ?')
      .get(req.params.id, req.session.userId);
    if (!video) {
      return res.status(404).json({ error: 'Видео не найдено' });
    }

    db.prepare(
      `UPDATE videos
       SET status = 'processing', error_message = NULL,
           updated_at = datetime('now')
       WHERE id = ?`
    ).run(video.id);

    const updated = db.prepare('SELECT * FROM videos WHERE id = ?').get(video.id);
    res.json({ video: mapVideo(updated) });
    setImmediate(() => processVideo(video.id, video.instagram_url));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось обновить видео' });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const result = getDb()
      .prepare('DELETE FROM videos WHERE id = ? AND user_id = ?')
      .run(req.params.id, req.session.userId);
    if (!result.changes) {
      return res.status(404).json({ error: 'Видео не найдено' });
    }
    removeCover(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось удалить' });
  }
});

export default router;
