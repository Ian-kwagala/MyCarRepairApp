import { randomBytes } from 'node:crypto';

import type { Request, RequestHandler } from 'express';
import multer from 'multer';

import { config } from './config';
import { one, type Db } from './db';
import { E } from './errors';

/** multer → memory; ≤ 5 photos of ≤ 5 MB each (§6 task 6). */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 5 } });

/** Content sniffing instead of trusting the client's MIME type (§13.1). */
function sniff(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', ext: 'png' };
  }
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
}

/** Stores uploaded photos and returns their "media/<key>" paths (what the photo columns hold). */
export async function storeFiles(db: Db, ownerId: number, files: Express.Multer.File[] | undefined): Promise<string[]> {
  const paths: string[] = [];
  for (const f of files ?? []) {
    const type = sniff(f.buffer);
    if (!type) throw E.validation('Photos must be JPEG, PNG or WebP images.');
    const key = `${randomBytes(16).toString('hex')}.${type.ext}`;
    await db.query(`INSERT INTO media (key, owner_id, mime, bytes) VALUES ($1, $2, $3, $4)`, [key, ownerId, type.mime, f.buffer]);
    paths.push(`media/${key}`);
  }
  return paths;
}

export function filesOf(req: Request, field: string): Express.Multer.File[] {
  const files = req.files;
  if (!files) return [];
  if (Array.isArray(files)) return files.filter((f) => f.fieldname === field);
  return files[field] ?? [];
}

/** GET /media/:key — keys are 128-bit random, unguessable; cached immutably. */
export const serveMedia: RequestHandler = async (req, res) => {
  const key = String(req.params.key);
  if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(key)) throw E.notFound('Photo');
  const row = await one<{ mime: string; bytes: Buffer }>(`SELECT mime, bytes FROM media WHERE key = $1`, [key]);
  if (!row) throw E.notFound('Photo');
  res.setHeader('Content-Type', row.mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(row.bytes);
};

/** Public base URL for links (PUBLIC_URL, or the request's scheme + host behind the proxy). */
export function baseUrl(req: Request): string {
  return config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
}
