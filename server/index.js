import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import session from 'express-session';
import cookieParser from 'cookie-parser';
import { initDb } from './db.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

initDb();

app.set('trust proxy', 1);
app.use(
  cors({
    origin: true,
    credentials: true,
  })
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(
  session({
    name: 'pifpaf.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: isProd,
      maxAge: 1000 * 60 * 60 * 24 * 14,
    },
  })
);

app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.use(express.static(path.join(rootDir, 'public')));

app.get('*', (_req, res) => {
  res.sendFile(path.join(rootDir, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
