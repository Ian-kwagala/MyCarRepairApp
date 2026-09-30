// Helpers for the server-rendered web pages (the /admin console and the /seller portal): the same-origin check that
// blocks cross-site form posts, cookie reading, and the response headers every private page sends.
import type { Request, Response } from 'express';

/** True when a POST was made by a page of this site (CSRF protection for cookie- and Basic-auth pages). */
export function sameOrigin(req: Request) {
  // Sec-Fetch-Site is set by the browser itself and can't be forged by another site's page.
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin';
  for (const value of [req.get('origin'), req.get('referer')]) {
    if (!value || value === 'null') continue;
    try {
      return new URL(value).host === req.get('host');
    } catch {
      return false;
    }
  }
  return false;
}

/** One cookie's value from the request, or null (no cookie-parser dependency needed for one cookie). */
export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Headers for signed-in pages: never cached or indexed, and the real origin kept on our own form posts. */
export function privatePageHeaders(res: Response) {
  // helmet's default "no-referrer" makes browsers send "Origin: null" on form posts, which would make every
  // button look cross-site. "same-origin" keeps the real origin on our own posts and nothing leaves the site.
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
}
