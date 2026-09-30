// Photo and video uploads: multer limits, storing uploads in the database (checked by their content, not the name
// the phone sends), serving them (videos in ranges so players can seek), and building their public URLs.
import { randomBytes } from 'node:crypto';

import type { Request, RequestHandler } from 'express';
import multer from 'multer';

import { config } from './config';
import { one, type Db } from './db';
import { E } from './errors';

/** multer → memory; ≤ 5 photos of ≤ 5 MB each (§6 task 6). */
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 5 } });

/** Job-step proof: one photo or one short video. Photos are still held to the 5 MB photo limit by storeProof(). */
export const uploadProof = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxVideoBytes, files: 1 } });

/** Recognises MP4/MOV/3GP (an "ftyp" box at byte 4) and WebM (the browser recorder) from the first bytes. */
function sniffVideo(buf: Buffer): { mime: string; ext: string } | null {
  if (buf.length > 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (brand === 'qt  ') return { mime: 'video/quicktime', ext: 'mov' };
    if (brand.startsWith('3g')) return { mime: 'video/3gpp', ext: '3gp' };
    // Everything else with an ftyp box (isom, mp41, mp42, avc1, heic-free video brands…) plays as MP4.
    return { mime: 'video/mp4', ext: 'mp4' };
  }
  if (buf.length > 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return { mime: 'video/webm', ext: 'webm' };
  return null;
}

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

/**
 * Stores uploaded photos and returns their "media/<key>" paths (what the photo columns hold). `ownerId` is the
 * uploading user, or null for photos added by staff in /admin (shop products).
 */
export async function storeFiles(db: Db, ownerId: number | null, files: Express.Multer.File[] | undefined): Promise<string[]> {
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

/**
 * Stores the proof for a job step: a photo (JPEG/PNG/WebP, ≤ 5 MB) or a video (MP4/MOV/3GP/WebM, ≤ the video
 * limit). Returns its "media/<key>" path, or null when nothing was sent.
 */
export async function storeProof(db: Db, ownerId: number, file: Express.Multer.File | undefined): Promise<string | null> {
  if (!file) return null;
  const photo = sniff(file.buffer);
  if (photo) {
    if (file.size > config.maxUploadBytes) throw E.validation('Photos can be at most 5 MB.');
    const [path] = await storeFiles(db, ownerId, [file]);
    return path ?? null;
  }
  const video = sniffVideo(file.buffer);
  if (!video) throw E.validation('Send a photo (JPEG, PNG) or a video (MP4).');
  const key = `${randomBytes(16).toString('hex')}.${video.ext}`;
  await db.query(`INSERT INTO media (key, owner_id, mime, bytes) VALUES ($1, $2, $3, $4)`, [key, ownerId, video.mime, file.buffer]);
  return `media/${key}`;
}

/** The uploaded files in `field`, whether multer ran with .array() or .fields(). */
export function filesOf(req: Request, field: string): Express.Multer.File[] {
  const files = req.files;
  if (!files) return [];
  if (Array.isArray(files)) return files.filter((f) => f.fieldname === field);
  return files[field] ?? [];
}

// Most of a video sent per range response. Players ask for "bytes=0-" and then follow up, so a cap keeps each
// response (and the server's memory) small while playback and seeking still work.
const MAX_RANGE_BYTES = 2 * 1024 * 1024;

/**
 * GET /media/:key — keys are 128-bit random, unguessable; cached immutably. Videos support HTTP range requests
 * (read straight from the database in slices), which Android's player and browsers need to seek.
 */
export const serveMedia: RequestHandler = async (req, res) => {
  const key = String(req.params.key);
  const m = /^[a-f0-9]{32}\.(jpg|png|webp|mp4|mov|3gp|webm)$/.exec(key);
  if (!m) throw E.notFound('Photo');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (['jpg', 'png', 'webp'].includes(m[1]!)) {
    const row = await one<{ mime: string; bytes: Buffer }>(`SELECT mime, bytes FROM media WHERE key = $1`, [key]);
    if (!row) throw E.notFound('Photo');
    res.setHeader('Content-Type', row.mime);
    res.end(row.bytes);
    return;
  }
  const info = await one<{ mime: string; size: number }>(`SELECT mime, octet_length(bytes) AS size FROM media WHERE key = $1`, [key]);
  if (!info) throw E.notFound('Video');
  const size = Number(info.size);
  res.setHeader('Content-Type', info.mime);
  res.setHeader('Accept-Ranges', 'bytes');
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') ?? '');
  if (!range || (!range[1] && !range[2])) {
    // No (usable) range: the whole file, for downloads and simple players.
    const row = await one<{ bytes: Buffer }>(`SELECT bytes FROM media WHERE key = $1`, [key]);
    res.setHeader('Content-Length', String(size));
    res.end(row!.bytes);
    return;
  }
  // "bytes=a-b", "bytes=a-" or the last n bytes ("bytes=-n").
  let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
  let end = range[1] ? (range[2] ? Math.min(Number(range[2]), size - 1) : size - 1) : size - 1;
  if (start >= size || start > end) {
    res.status(416).setHeader('Content-Range', `bytes */${size}`).end();
    return;
  }
  end = Math.min(end, start + MAX_RANGE_BYTES - 1);
  start = Math.max(0, start);
  // SQL substring is 1-based.
  const part = await one<{ chunk: Buffer }>(`SELECT substring(bytes FROM $2 FOR $3) AS chunk FROM media WHERE key = $1`, [key, start + 1, end - start + 1]);
  res.status(206);
  res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
  res.setHeader('Content-Length', String(end - start + 1));
  res.end(part!.chunk);
};

/** Public base URL for links (PUBLIC_URL, or the request's scheme + host behind the proxy). */
export function baseUrl(req: Request): string {
  return config.publicUrl ?? `${req.protocol}://${req.get('host')}`;
}
