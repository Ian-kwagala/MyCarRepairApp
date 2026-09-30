// The seller portal (/seller): where marketplace sellers sign up, list their spare parts and accessories, see which
// ordered items to get ready for MyCarRepair to collect, and follow their earnings and payouts. Server-rendered with
// the admin console's page kit; phone-friendly. Buyers' names, phones and addresses are never shown to sellers:
// MyCarRepair handles the customer, the delivery and the money (Jumia-style marketplace).
import { readFileSync } from 'node:fs';

import { Router, type Request, type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { MAX_PHOTOS } from '@/constants/config';
import type { OrderStatus } from '@/models';
import { normalizePhone } from '@/utils/format';
import { categoryLabel, orderStatusLabel } from '@/utils/shop';

import { chips, empty, esc, fmtDate, fmtDateTime, frame, icon, num, pill, plainPage, ugx, type PageOptions } from '../admin/ui';
import { mediaSrc, pick, str } from '../admin/common';
import { hashPassword, verifyPassword } from '../auth';
import { config } from '../config';
import { one, pool, query, tx } from '../db';
import { filesOf, storeFiles, upload } from '../media';
import { keptPhotos, parseProduct, productForm, productToForm, splitCsv } from '../product-form';
import { clearSellerCookie, linesToPrepare, requireSeller, sellerBalances, setSellerCookie, type SellerLine } from '../sellers';
import { commissionPercent, reviewListings, sellerNet } from '../shop';
import type { ProductRow, SellerPayoutRow, SellerRow } from '../types';
import { privatePageHeaders, sameOrigin } from '../web';

/** Routes under /seller. */
export const sellerRouter = Router();

const SITE = 'MyCarRepair Sellers';
const SCRIPT_PATH = '/seller/assets/portal.js';
// The admin console's small script (confirm dialogs, live refresh) works unchanged here.
const SCRIPT = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');

sellerRouter.get('/assets/portal.js', (_req, res) => {
  res.type('application/javascript').send(SCRIPT);
});

// ── Signing up and in ────────────────────────────────────────────────────────────────────────────────

// Failed attempts only, per IP: slows password guessing and sign-up spam.
const authLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Math.max(10, config.loginRateLimit * 3), skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false });

/** Public form posts (sign in, sign up, sign out) must also come from our own pages. */
const sameSite: RequestHandler = (req, res, next) => {
  privatePageHeaders(res);
  if (req.method === 'POST' && !sameOrigin(req)) {
    res.status(403).send('Cross-site request blocked.');
    return;
  }
  next();
};

const field = (name: string, label: string, value: string, extra = '', hint = '') =>
  `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${esc(value)}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;

function loginPage(email = '', error?: string, notice?: string) {
  return plainPage({
    title: 'Sign in to your shop',
    site: 'Seller portal',
    script: SCRIPT_PATH,
    error,
    notice,
    body: `<form method="post" action="/seller/login">${field('email', 'Email', email, 'type="email" required autocomplete="email"')}
${field('password', 'Password', '', 'type="password" required autocomplete="current-password"')}
<button class="btn primary">Sign in</button></form>
<p class="switch">New seller? <a href="/seller/signup">Open a shop on MyCarRepair</a></p>`,
  });
}

sellerRouter.get('/login', sameSite, (req, res) => {
  res.send(loginPage('', undefined, str(req.query.notice)));
});

sellerRouter.post('/login', sameSite, authLimiter, async (req, res) => {
  const email = str(req.body?.email).trim().toLowerCase().slice(0, 255);
  const password = str(req.body?.password);
  const seller = email ? await one<SellerRow>(`SELECT * FROM sellers WHERE email = $1`, [email]) : null;
  if (!seller || !(await verifyPassword(password, seller.password))) {
    res.status(401).send(loginPage(email, 'Wrong email or password.'));
    return;
  }
  if (seller.status === 'suspended') {
    res.status(403).send(loginPage(email, 'This shop is suspended. Call MyCarRepair support.'));
    return;
  }
  setSellerCookie(res, seller);
  res.redirect(303, '/seller');
});

type SignupForm = Record<'shop_name' | 'contact_name' | 'phone' | 'email' | 'location' | 'about' | 'payout_number', string>;

function signupPage(f: Partial<SignupForm> = {}, error?: string) {
  const v = (k: keyof SignupForm) => f[k] ?? '';
  return plainPage({
    title: 'Open a shop on MyCarRepair',
    site: 'Seller portal',
    script: SCRIPT_PATH,
    error,
    body: `<p class="muted" style="margin-top:0">List your genuine spare parts and accessories. We check every listing, take the orders and the payment,
collect from you and deliver to car owners, then send your money by mobile money after delivery.</p>
<form method="post" action="/seller/signup">${field('shop_name', 'Shop name', v('shop_name'), 'required maxlength="100" placeholder="Kampala Auto Spares"')}
${field('contact_name', 'Your name', v('contact_name'), 'required maxlength="100" autocomplete="name"')}
${field('phone', 'Phone', v('phone'), 'required inputmode="tel" autocomplete="tel" placeholder="0772 123456"')}
${field('email', 'Email', v('email'), 'type="email" required autocomplete="email"')}
${field('password', 'Password', '', 'type="password" required minlength="8" autocomplete="new-password"', 'At least 8 characters.')}
${field('location', 'Shop location', v('location'), 'required maxlength="150" placeholder="Kisekka Market, Kampala"', 'Where we collect sold items from.')}
${field('payout_number', 'Mobile money number for payouts', v('payout_number'), 'inputmode="tel" placeholder="0772 123456"', 'MTN MoMo or Airtel Money. You can add it later.')}
<div class="field"><label for="about">What do you sell?</label><textarea id="about" name="about" maxlength="500" placeholder="Genuine Toyota parts, tyres, batteries…">${esc(v('about'))}</textarea></div>
<button class="btn primary">Create my shop</button></form>
<p class="switch">Already selling? <a href="/seller/login">Sign in</a></p>`,
  });
}

const phoneSchema = z
  .string()
  .trim()
  .transform((p) => normalizePhone(p))
  .pipe(z.string().regex(/^\+?\d{9,15}$/, 'Enter a valid phone number, e.g. 0772 123456.'));

const signupSchema = z.object({
  shop_name: z.string().trim().min(2, 'Enter your shop name.').max(100),
  contact_name: z.string().trim().min(2, 'Enter your name.').max(100),
  phone: phoneSchema,
  email: z.string().trim().toLowerCase().email('Enter a valid email address.').max(255),
  password: z.string().min(8, 'Use a password of at least 8 characters.').max(200),
  location: z.string().trim().min(3, 'Enter where your shop is.').max(150),
  about: z.string().trim().max(500),
  payout_number: z.union([z.literal(''), phoneSchema]),
});

sellerRouter.get('/signup', sameSite, (_req, res) => {
  res.send(signupPage());
});

sellerRouter.post('/signup', sameSite, authLimiter, async (req, res) => {
  const raw = Object.fromEntries(['shop_name', 'contact_name', 'phone', 'email', 'password', 'location', 'about', 'payout_number'].map((k) => [k, str(req.body?.[k])]));
  const parsed = signupSchema.safeParse(raw);
  if (!parsed.success) {
    res.status(400).send(signupPage(raw, parsed.error.issues[0]?.message));
    return;
  }
  const b = parsed.data;
  if (await one(`SELECT 1 FROM sellers WHERE email = $1`, [b.email])) {
    res.status(409).send(signupPage(raw, 'A shop with this email already exists. Sign in instead.'));
    return;
  }
  const seller = (await query<SellerRow>(
    `INSERT INTO sellers (shop_name, contact_name, email, phone, password, location, about, payout_number)
     VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NULLIF($8, '')) RETURNING *`,
    [b.shop_name, b.contact_name, b.email, b.phone, await hashPassword(b.password), b.location, b.about, b.payout_number],
  ))[0]!;
  setSellerCookie(res, seller);
  res.redirect(303, '/seller?notice=seller-welcome');
});

sellerRouter.post('/logout', sameSite, (_req, res) => {
  clearSellerCookie(res);
  res.redirect(303, '/seller/login?notice=signed-out');
});

// ── Signed-in pages ──────────────────────────────────────────────────────────────────────────────────

sellerRouter.use(requireSeller);

const me = (req: Request) => req.seller!;

/** A signed-in portal page: the seller's menu, and a banner while the shop is waiting for approval. */
async function sellerPage(req: Request, opts: PageOptions & { active: string }) {
  const s = me(req);
  const prepare = await linesToPrepare(s.id);
  const banner =
    s.status === 'pending'
      ? `<div class="banner" role="status">${icon('store')}<span>Your shop is under review. MyCarRepair will call you on ${esc(s.phone)} to verify it. You can add products now: they go live once your shop is approved.</span></div>`
      : '';
  return frame({
    ...opts,
    site: SITE,
    siteSub: 'Seller portal',
    home: '/seller',
    nav: [
      { href: '/seller', label: 'Dashboard', icon: 'layout-dashboard' },
      { href: '/seller/products', label: 'Products', icon: 'package' },
      { href: '/seller/orders', label: 'Orders', icon: 'shopping-bag', badge: prepare, urgent: true },
      { href: '/seller/earnings', label: 'Earnings', icon: 'banknote' },
      { href: '/seller/account', label: 'Account', icon: 'user-round' },
    ],
    banner,
    script: SCRIPT_PATH,
    foot: esc(s.shop_name),
    // Sign-out stays visible on phones too (where the rest of the sidebar footer is hidden).
    sideAction: `<form method="post" action="/seller/logout"><button class="btn ghost">${icon('log-out', 15)} Sign out</button></form>`,
  });
}

/** Where a listing stands, in the seller's words. */
function listingPill(p: ProductRow) {
  if (p.review_status === 'pending') return pill('Waiting for review', 'warning');
  if (p.review_status === 'rejected') return pill('Needs changes', 'danger');
  if (!p.is_active) return pill('Hidden', 'neutral');
  if (!p.stock) return pill('Sold out', 'danger');
  return pill('Live in the Shop', 'success');
}

const thumb = (csv: string | null, alt = '') => {
  const src = mediaSrc(splitCsv(csv)[0] ?? null);
  return src ? `<img class="pthumb" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : `<span class="pthumb" aria-hidden="true"></span>`;
};

sellerRouter.get('/', async (req, res) => {
  const s = me(req);
  const [counts, money, pct, toPrepare] = await Promise.all([
    one<{ live: number; review: number; changes: number }>(
      `SELECT COUNT(*) FILTER (WHERE is_active AND review_status = 'approved' AND stock > 0)::int AS live,
              COUNT(*) FILTER (WHERE review_status = 'pending')::int AS review,
              COUNT(*) FILTER (WHERE review_status = 'rejected')::int AS changes
       FROM products WHERE seller_id = $1`,
      [s.id],
    ),
    sellerBalances(pool, s.id),
    commissionPercent(),
    linesToPrepare(s.id),
  ]);
  const tile = (label: string, value: string, note: string, href: string, alert = false) =>
    `<a class="tile${alert ? ' alert' : ''}" href="${href}"><div class="label">${label}</div><div class="value">${value}</div><div class="note">${note}</div></a>`;
  const body = `<div class="tiles">
${tile('To get ready', num(toPrepare), 'items in confirmed orders', '/seller/orders', toPrepare > 0)}
${tile('Live products', num(counts!.live), counts!.review ? `${counts!.review} waiting for review` : 'in the Shop now', '/seller/products')}
${tile('Owed to you', ugx(money.owed), 'delivered, not yet paid', '/seller/earnings')}
${tile('Paid to date', ugx(money.paid), money.coming ? `${ugx(money.coming)} more on the way` : 'by mobile money', '/seller/earnings')}
</div>
${counts!.changes ? `<div class="notice warn" role="status">${icon('triangle-alert')}${counts!.changes} listing(s) need changes before they can go live. <a href="/seller/products?status=changes">See what to fix</a></div>` : ''}
<section class="card"><div class="card-h"><h2>How selling works</h2></div><div class="card-b"><ol style="margin:0;padding-left:18px;line-height:1.8">
<li>Add your products with clear photos, the right price and how many you have.</li>
<li>MyCarRepair checks each listing, then car owners can buy it in the app.</li>
<li>When an order is confirmed, it shows under <a href="/seller/orders">Orders</a>: get the items ready and mark them ready.</li>
<li>We collect from ${esc(s.location ?? 'your shop')}, deliver to the customer and collect the payment.</li>
<li>After delivery we send your money (price minus ${num(pct)}% commission) to ${s.payout_number ? esc(s.payout_number) : 'your mobile money number (<a href="/seller/account">add it</a>)'}.</li>
</ol></div></section>`;
  res.send(await sellerPage(req, { title: `Hello, ${s.contact_name.split(' ')[0]}`, active: '/seller', body, notice: str(req.query.notice), subtitle: esc(s.shop_name) }));
});

// ── Products ─────────────────────────────────────────────────────────────────────────────────────────

const LISTING_FILTERS = ['all', 'live', 'review', 'changes', 'hidden'] as const;

sellerRouter.get('/products', async (req, res) => {
  const s = me(req);
  const status = pick(req.query.status, LISTING_FILTERS, 'all');
  const where = ['seller_id = $1'];
  if (status === 'live') where.push(`is_active AND review_status = 'approved'`);
  if (status === 'review') where.push(`review_status = 'pending'`);
  if (status === 'changes') where.push(`review_status = 'rejected'`);
  if (status === 'hidden') where.push(`NOT is_active`);
  const rows = await query<ProductRow & { sold: number }>(
    `SELECT p.*, COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.status <> 'cancelled'), 0)::int AS sold
     FROM products p WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 300`,
    [s.id],
  );
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Product</th><th class="num">Price</th><th class="num">In stock</th><th class="num">Sold</th><th>Status</th></tr></thead><tbody>${rows
        .map(
          (r) => `<tr><td><div class="person">${thumb(r.photos, r.name)}<div><a class="strong" href="/seller/products/${r.id}">${esc(r.name)}</a>
<span class="muted small">${esc(categoryLabel(r.category))}${r.part_number ? ` · ${esc(r.part_number)}` : ''}</span>${r.review_status === 'rejected' && r.review_note ? `<span class="small" style="color:var(--red)">${esc(r.review_note)}</span>` : ''}</div></div></td>
<td class="num">${esc(ugx(r.price))}</td><td class="num">${num(r.stock)}</td><td class="num">${num(r.sold)}</td><td>${listingPill(r)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(status === 'all' ? 'No products yet' : 'Nothing here', status === 'all' ? 'Add your first product: clear photos and the right price sell best.' : '');
  const body = `<section class="card"><div class="toolbar">${chips('/seller/products', 'status', status, [['all', 'All'], ['live', 'Live'], ['review', 'Waiting for review'], ['changes', 'Needs changes'], ['hidden', 'Hidden']], {})}</div>${table}</section>`;
  res.send(
    await sellerPage(req, {
      title: 'Products',
      active: '/seller/products',
      body,
      notice: str(req.query.notice),
      subtitle: 'Everything you list. MyCarRepair checks new listings before owners can buy them.',
      actions: `<a class="btn primary" href="/seller/products/new">${icon('package', 16)} Add product</a>`,
    }),
  );
});

const REVIEW_NOTE = 'New listings and changes to the name, section, brand, part number, description or photos are checked by MyCarRepair before they show. Price and stock changes apply straight away.';

sellerRouter.get('/products/new', async (req, res) => {
  res.send(
    await sellerPage(req, {
      title: 'Add product',
      active: '/seller/products',
      back: { href: '/seller/products', label: 'Products' },
      body: productForm('/seller/products', productToForm(), [], undefined, REVIEW_NOTE),
    }),
  );
});

sellerRouter.post('/products', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const s = me(req);
  const { raw, parsed, error } = parseProduct(req);
  const files = filesOf(req, 'photos');
  const problem = error ?? (files.length ? undefined : 'Add at least one photo of the product.');
  if (!parsed || problem) {
    res.status(400).send(
      await sellerPage(req, { title: 'Add product', active: '/seller/products', back: { href: '/seller/products', label: 'Products' }, body: productForm('/seller/products', raw, [], problem, REVIEW_NOTE) }),
    );
    return;
  }
  const review = await reviewListings();
  const id = await tx(async (db) => {
    const photos = await storeFiles(db, null, files);
    const r = await db.query<{ id: number }>(
      `INSERT INTO products (name, category, brand, part_number, price, stock, warranty_months, compatible_with, description, photos, seller_id, review_status)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), $10, $11, $12) RETURNING id`,
      [parsed.name, parsed.category, parsed.brand, parsed.part_number, parsed.price, parsed.stock, parsed.warranty_months, parsed.compatible_with, parsed.description, photos.join(','), s.id, review ? 'pending' : 'approved'],
    );
    return r.rows[0]!.id;
  });
  res.redirect(303, `/seller/products/${id}?notice=${review ? 'seller-product-created' : 'seller-product-live'}`);
});

/** One of the signed-in seller's own products (never another seller's). */
const ownProduct = (req: Request) => one<ProductRow>(`SELECT * FROM products WHERE id = $1 AND seller_id = $2`, [Number(req.params.id), me(req).id]);

sellerRouter.get('/products/:id', async (req, res) => {
  const r = await ownProduct(req);
  if (!r) {
    res.status(404).send(await sellerPage(req, { title: 'Product not found', active: '/seller/products', back: { href: '/seller/products', label: 'Products' }, body: empty('This product does not exist') }));
    return;
  }
  const back = `/seller/products/${r.id}`;
  const visibility = `<form method="post" action="${back}/visibility" class="inline"${r.is_active ? ' data-confirm="Hide this product? Owners can no longer buy it."' : ''}><button class="btn ${r.is_active ? 'danger' : 'success'}">${r.is_active ? 'Hide from the Shop' : 'Show in the Shop'}</button></form>`;
  const note =
    r.review_status === 'rejected'
      ? `<div class="form-error" role="alert">MyCarRepair asked for changes${r.review_note ? `: ${esc(r.review_note)}` : '.'} Save the product to send it for review again.</div>`
      : '';
  res.send(
    await sellerPage(req, {
      title: r.name,
      active: '/seller/products',
      notice: str(req.query.notice),
      back: { href: '/seller/products', label: 'Products' },
      subtitle: `${listingPill(r)} ${r.stock ? pill(`${num(r.stock)} in stock`, 'info') : ''}`,
      actions: `<div class="actions">${visibility}</div>`,
      body: note + productForm(back, productToForm(r), splitCsv(r.photos), undefined, REVIEW_NOTE),
    }),
  );
});

sellerRouter.post('/products/:id', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const current = await ownProduct(req);
  if (!current) {
    res.redirect(303, '/seller/products');
    return;
  }
  const currentPhotos = splitCsv(current.photos);
  const kept = keptPhotos(req, currentPhotos);
  const files = filesOf(req, 'photos');
  const { raw, parsed, error } = parseProduct(req);
  const problem =
    error ??
    (kept.length + files.length === 0 ? 'Keep or add at least one photo.' : kept.length + files.length > MAX_PHOTOS ? `Use at most ${MAX_PHOTOS} photos: untick some to add new ones.` : undefined);
  if (!parsed || problem) {
    res.status(400).send(
      await sellerPage(req, { title: current.name, active: '/seller/products', back: { href: '/seller/products', label: 'Products' }, body: productForm(`/seller/products/${current.id}`, raw, currentPhotos, problem, REVIEW_NOTE) }),
    );
    return;
  }
  // What buyers rely on to know it's genuine (name, section, brand, part number, description, photos) is checked
  // again after a change; price, stock, warranty and "fits" apply at once. A listing that needed changes goes back
  // for review on any save.
  const orEmpty = (v: string | null) => v ?? '';
  const contentChanged =
    parsed.name !== current.name ||
    parsed.category !== current.category ||
    parsed.brand !== orEmpty(current.brand) ||
    parsed.part_number !== orEmpty(current.part_number) ||
    parsed.description !== orEmpty(current.description) ||
    files.length > 0 ||
    kept.length !== currentPhotos.length;
  const review = (await reviewListings()) && (contentChanged || current.review_status !== 'approved');
  await tx(async (db) => {
    const added = await storeFiles(db, null, files);
    await db.query(
      `UPDATE products SET name = $2, category = $3, brand = NULLIF($4, ''), part_number = NULLIF($5, ''), price = $6, stock = $7, warranty_months = $8,
              compatible_with = NULLIF($9, ''), description = NULLIF($10, ''), photos = $11,
              review_status = CASE WHEN $12 THEN 'pending' ELSE review_status END, review_note = CASE WHEN $12 THEN NULL ELSE review_note END,
              updated_at = now()
       WHERE id = $1`,
      [current.id, parsed.name, parsed.category, parsed.brand, parsed.part_number, parsed.price, parsed.stock, parsed.warranty_months, parsed.compatible_with, parsed.description, [...kept, ...added].join(','), review],
    );
  });
  res.redirect(303, `/seller/products/${current.id}?notice=${review ? 'seller-product-review' : 'seller-product-saved'}`);
});

sellerRouter.post('/products/:id/visibility', async (req, res) => {
  const r = await one<{ is_active: boolean }>(`UPDATE products SET is_active = NOT is_active, updated_at = now() WHERE id = $1 AND seller_id = $2 RETURNING is_active`, [
    Number(req.params.id),
    me(req).id,
  ]);
  res.redirect(303, `/seller/products/${Number(req.params.id)}?notice=${r?.is_active ? 'seller-product-shown' : 'seller-product-hidden'}`);
});

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────────

const ORDER_FILTERS = ['todo', 'waiting', 'ready', 'done', 'all'] as const;

/** Where a line stands for the seller. */
function linePill(l: SellerLine) {
  if (l.order_status === 'cancelled') return pill('Cancelled: keep the item', 'neutral');
  if (l.order_status === 'placed') return pill('Awaiting confirmation', 'neutral');
  if (l.seller_status === 'new') return pill('Get it ready', 'warning');
  if (l.seller_status === 'ready') return pill('Ready for collection', 'info');
  return l.order_status === 'delivered' ? pill('Delivered', 'success') : pill('Collected', 'success');
}

sellerRouter.get('/orders', async (req, res) => {
  const s = me(req);
  const status = pick(req.query.status, ORDER_FILTERS, 'todo');
  const where = ['i.seller_id = $1'];
  // Orders the owner cancelled before anyone acted on them never concern the seller.
  where.push(`NOT (o.status = 'cancelled' AND i.seller_status = 'new')`);
  if (status === 'todo') where.push(`o.status = 'confirmed' AND i.seller_status = 'new'`);
  if (status === 'waiting') where.push(`o.status = 'placed'`);
  if (status === 'ready') where.push(`i.seller_status = 'ready' AND o.status <> 'cancelled'`);
  if (status === 'done') where.push(`i.seller_status = 'collected'`);
  const lines = await query<SellerLine & { photos: string | null }>(
    `SELECT i.*, o.status AS order_status, o.created_at AS order_created_at, p.photos FROM order_items i
     JOIN orders o ON o.id = i.order_id LEFT JOIN products p ON p.id = i.product_id
     WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC, i.id LIMIT 300`,
    [s.id],
  );
  // One card per order: its lines for this seller and, while it's confirmed, the "ready" button.
  const orders = new Map<number, typeof lines>();
  for (const l of lines) orders.set(l.order_id, [...(orders.get(l.order_id) ?? []), l]);
  const cards = [...orders.entries()]
    .map(([orderId, ls]) => {
      const first = ls[0]!;
      const canReady = first.order_status === 'confirmed' && ls.some((l) => l.seller_status === 'new');
      const rows = ls
        .map((l) => {
          const m = sellerNet(l);
          // Two columns (item with its status, and the seller's share) so a line fits a phone screen.
          return `<tr><td><div class="person">${thumb(l.photos, l.name)}<div><span class="strong">${esc(l.name)}</span><span class="muted small">${num(l.quantity)} × ${esc(ugx(l.unit_price))}</span><span>${linePill(l)}</span></div></div></td>
<td class="num">${esc(ugx(m.net))}<br><span class="muted small">after ${num(Number(l.commission_percent))}%<br>commission</span></td></tr>`;
        })
        .join('');
      const button = canReady
        ? `<form method="post" action="/seller/orders/${orderId}/ready" class="inline"><button class="btn success">${icon('circle-check', 16)} Mark ready for collection</button></form>`
        : '';
      return `<section class="card"><div class="card-h"><h2>Order #${orderId} <span class="muted small">· ${esc(fmtDateTime(first.order_created_at))} · ${esc(orderStatusLabel(first.order_status as OrderStatus))}</span></h2>${button}</div>
<div class="scroll"><table class="t"><tbody>${rows}</tbody></table></div></section>`;
    })
    .join('');
  const body = `<section class="card"><div class="toolbar">${chips('/seller/orders', 'status', status, [['todo', 'Get ready'], ['waiting', 'Awaiting confirmation'], ['ready', 'Ready'], ['done', 'Collected'], ['all', 'All']], {})}</div></section>
${cards || `<section class="card">${empty(status === 'todo' ? 'Nothing to get ready' : 'No orders here', status === 'todo' ? 'Confirmed orders for your products appear here.' : '')}</section>`}`;
  res.send(
    await sellerPage(req, {
      title: 'Orders',
      active: '/seller/orders',
      body,
      notice: str(req.query.notice),
      refreshSeconds: 60,
      subtitle: `MyCarRepair confirms each order with the customer, then collects the items from ${esc(s.location ?? 'your shop')}.`,
    }),
  );
});

sellerRouter.post('/orders/:orderId/ready', async (req, res) => {
  await query(
    `UPDATE order_items i SET seller_status = 'ready' FROM orders o
     WHERE i.order_id = o.id AND i.order_id = $1 AND i.seller_id = $2 AND i.seller_status = 'new' AND o.status = 'confirmed'`,
    [Number(req.params.orderId), me(req).id],
  );
  res.redirect(303, '/seller/orders?status=ready&notice=seller-ready');
});

// ── Earnings ─────────────────────────────────────────────────────────────────────────────────────────

sellerRouter.get('/earnings', async (req, res) => {
  const s = me(req);
  const [money, lines, payouts] = await Promise.all([
    sellerBalances(pool, s.id),
    query<SellerLine>(
      `SELECT i.*, o.status AS order_status, o.updated_at AS order_created_at FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.seller_id = $1 AND o.status = 'delivered' ORDER BY o.updated_at DESC LIMIT 200`,
      [s.id],
    ),
    query<SellerPayoutRow>(`SELECT * FROM seller_payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 100`, [s.id]),
  ]);
  const sales = lines.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Delivered</th><th>Item</th><th class="num">Sale</th><th class="num">Commission</th><th class="num">Your share</th><th>Paid</th></tr></thead><tbody>${lines
        .map((l) => {
          const m = sellerNet(l);
          return `<tr><td>${esc(fmtDate(l.order_created_at))}<br><span class="muted small">Order #${l.order_id}</span></td><td>${esc(l.name)} <span class="muted">× ${num(l.quantity)}</span></td>
<td class="num">${esc(ugx(m.gross))}</td><td class="num">${esc(ugx(m.commission))}</td><td class="num"><b>${esc(ugx(m.net))}</b></td><td>${l.payout_id ? pill('Paid', 'success') : pill('Owed', 'warning')}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : empty('No delivered sales yet', 'Once MyCarRepair delivers your items, your share shows here.');
  const paid = payouts.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Date</th><th>How</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${payouts
        .map((p) => `<tr><td>${esc(fmtDate(p.created_at))}</td><td>${esc(p.method === 'mobile_money' ? 'Mobile money' : p.method === 'bank' ? 'Bank transfer' : 'Cash')}</td><td>${esc(p.reference ?? '—')}</td><td class="num">${esc(ugx(p.amount))}</td></tr>`)
        .join('')}</tbody></table></div>`
    : empty('No payouts yet', '');
  const body = `<div class="tiles compact"><div class="tile"><div class="label">Owed to you</div><div class="value">${esc(ugx(money.owed))}</div><div class="note">delivered, not yet paid</div></div>
<div class="tile"><div class="label">On the way</div><div class="value">${esc(ugx(money.coming))}</div><div class="note">confirmed, not yet delivered</div></div>
<div class="tile"><div class="label">Paid to date</div><div class="value">${esc(ugx(money.paid))}</div><div class="note">${s.payout_number ? `to ${esc(s.payout_number)}` : '<a href="/seller/account">add your mobile money number</a>'}</div></div></div>
<section class="card"><div class="card-h"><h2>Delivered sales</h2></div>${sales}</section>
<section class="card"><div class="card-h"><h2>Payouts</h2></div>${paid}</section>`;
  res.send(await sellerPage(req, { title: 'Earnings', active: '/seller/earnings', body, subtitle: 'Your share of every delivered sale, and the money MyCarRepair has sent you.' }));
});

// ── Account ──────────────────────────────────────────────────────────────────────────────────────────

function accountBody(s: SellerRow, error?: string, pwError?: string) {
  return `${error ? `<div class="form-error" role="alert">${esc(error)}</div>` : ''}
<section class="card"><div class="card-h"><h2>Shop details</h2></div><div class="card-b"><form method="post" action="/seller/account"><div class="form-grid">
${field('shop_name', 'Shop name', s.shop_name, 'required maxlength="100"')}
${field('contact_name', 'Your name', s.contact_name, 'required maxlength="100"')}
${field('phone', 'Phone', s.phone, 'required inputmode="tel"')}
${field('location', 'Shop location', s.location ?? '', 'required maxlength="150"', 'Where we collect sold items from.')}
${field('payout_number', 'Mobile money number for payouts', s.payout_number ?? '', 'inputmode="tel"', 'MTN MoMo or Airtel Money.')}
<div class="field wide"><label for="about">What do you sell?</label><textarea id="about" name="about" maxlength="500">${esc(s.about ?? '')}</textarea></div>
</div><button class="btn primary">Save details</button></form></div></section>
${pwError ? `<div class="form-error" role="alert">${esc(pwError)}</div>` : ''}
<section class="card"><div class="card-h"><h2>Change password</h2></div><div class="card-b"><form method="post" action="/seller/account/password">
${field('current', 'Current password', '', 'type="password" required autocomplete="current-password"')}
${field('password', 'New password', '', 'type="password" required minlength="8" autocomplete="new-password"', 'At least 8 characters. Other devices are signed out.')}
<button class="btn primary">Change password</button></form></div></section>
<p class="muted small">Signed in as ${esc(s.email)}. To change your email, call MyCarRepair support.</p>`;
}

sellerRouter.get('/account', async (req, res) => {
  res.send(await sellerPage(req, { title: 'Account', active: '/seller/account', body: accountBody(me(req)), notice: str(req.query.notice) }));
});

const accountSchema = signupSchema.pick({ shop_name: true, contact_name: true, phone: true, location: true, about: true, payout_number: true });

sellerRouter.post('/account', async (req, res) => {
  const s = me(req);
  const parsed = accountSchema.safeParse(Object.fromEntries(['shop_name', 'contact_name', 'phone', 'location', 'about', 'payout_number'].map((k) => [k, str(req.body?.[k])])));
  if (!parsed.success) {
    res.status(400).send(await sellerPage(req, { title: 'Account', active: '/seller/account', body: accountBody(s, parsed.error.issues[0]?.message) }));
    return;
  }
  const b = parsed.data;
  await query(
    `UPDATE sellers SET shop_name = $2, contact_name = $3, phone = $4, location = $5, about = NULLIF($6, ''), payout_number = NULLIF($7, '') WHERE id = $1`,
    [s.id, b.shop_name, b.contact_name, b.phone, b.location, b.about, b.payout_number],
  );
  res.redirect(303, '/seller/account?notice=seller-account');
});

sellerRouter.post('/account/password', async (req, res) => {
  const s = me(req);
  const next = str(req.body?.password);
  if (!(await verifyPassword(str(req.body?.current), s.password))) {
    res.status(400).send(await sellerPage(req, { title: 'Account', active: '/seller/account', body: accountBody(s, undefined, 'Your current password is not right.') }));
    return;
  }
  if (next.length < 8 || next.length > 200) {
    res.status(400).send(await sellerPage(req, { title: 'Account', active: '/seller/account', body: accountBody(s, undefined, 'Use a new password of at least 8 characters.') }));
    return;
  }
  // A new session version signs out every other device; this browser gets a fresh cookie.
  const updated = (await query<SellerRow>(`UPDATE sellers SET password = $2, session_version = session_version + 1 WHERE id = $1 RETURNING *`, [s.id, await hashPassword(next)]))[0]!;
  setSellerCookie(res, updated);
  res.redirect(303, '/seller/account?notice=seller-password');
});
