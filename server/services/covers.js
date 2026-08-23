import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coversDir = path.join(__dirname, '..', '..', 'public', 'covers');

export async function cacheCover(videoId, sourceUrl) {
  if (!sourceUrl) return null;

  fs.mkdirSync(coversDir, { recursive: true });
  const filePath = path.join(coversDir, `${videoId}.jpg`);

  try {
    const res = await fetch(sourceUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Referer: 'https://www.instagram.com/',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const buffer = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(filePath, buffer);
    return `/covers/${videoId}.jpg`;
  } catch (err) {
    console.warn('Cover cache failed:', err.message);
    return sourceUrl;
  }
}

export function removeCover(videoId) {
  const filePath = path.join(coversDir, `${videoId}.jpg`);
  try {
    fs.unlinkSync(filePath);
  } catch {
    /* missing file */
  }
}
