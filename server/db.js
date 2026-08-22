import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

const dbPath = process.env.DATABASE_PATH
  ? path.resolve(rootDir, process.env.DATABASE_PATH)
  : path.join(rootDir, 'data', 'app.db');

let db;

export function getDb() {
  if (!db) initDb();
  return db;
}

export function initDb() {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  db.exec(schema);

  try {
    db.exec('ALTER TABLE videos ADD COLUMN error_message TEXT');
  } catch {
    /* already exists */
  }

  return db;
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isDirectRun) {
  initDb();
  console.log(`Database initialized at ${dbPath}`);
}
