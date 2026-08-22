import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { getDb } from '../db.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function publicUser(row) {
  return {
    id: row.id,
    username: row.username,
    instagram_handle: row.instagram_handle,
    created_at: row.created_at,
  };
}

router.post('/register', async (req, res) => {
  try {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase();
    const password = String(req.body.password || '');
    const handle = String(req.body.instagram_handle || '')
      .trim()
      .replace(/^@/, '');

    if (!/^[a-z0-9_]{3,24}$/.test(username)) {
      return res.status(400).json({
        error: 'Логин: 3–24 символа, латиница, цифры и _',
      });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    }

    const db = getDb();
    const exists = db
      .prepare('SELECT id FROM users WHERE username = ?')
      .get(username);
    if (exists) {
      return res.status(409).json({ error: 'Такой логин уже занят' });
    }

    const id = crypto.randomUUID();
    const password_hash = await bcrypt.hash(password, 10);
    db.prepare(
      `INSERT INTO users (id, username, instagram_handle, password_hash)
       VALUES (?, ?, ?, ?)`
    ).run(id, username, handle || null, password_hash);

    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
    req.session.userId = user.id;
    res.status(201).json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось зарегистрироваться' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const username = String(req.body.username || '')
      .trim()
      .toLowerCase();
    const password = String(req.body.password || '');

    const db = getDb();
    const user = db
      .prepare('SELECT * FROM users WHERE username = ?')
      .get(username);
    if (!user) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.userId = user.id;
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Не удалось войти' });
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Не удалось выйти' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  try {
    const user = getDb()
      .prepare('SELECT * FROM users WHERE id = ?')
      .get(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ error: 'Сессия устарела' });
    }
    res.json({ user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка профиля' });
  }
});

export default router;
