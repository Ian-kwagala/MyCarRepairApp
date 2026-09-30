// Admin console pages for the shop (marketplace): the product catalogue (MyCarRepair's own products and sellers'
// listings: add, edit, photos, stock, price, hide, and checking seller listings before they go live) and customer
// orders (confirm → collect sellers' items → out for delivery / ready for pickup → delivered, or cancel). Mounted at
// /admin/shop by router.ts, behind the same sign-in and CSRF checks; sellers themselves are in sellers.ts.
import { Router, type Request } from 'express';
import { z } from 'zod';

import { MAX_PHOTOS, PRODUCT_CATEGORIES } from '@/constants/config';
import type { OrderStatus } from '@/models';
import { categoryLabel, nextOrderStatuses, orderStatusLabel, orderStatusTone } from '@/utils/shop';

import { one, pool, query, tx } from '../db';
import { filesOf, storeFiles, upload } from '../media';
import { changeOrderStatus, loadOrders, shopSettings } from '../shop';
import type { OrderItemRow, OrderRow, ProductRow, SellerRow, UserRow } from '../types';
import { keptPhotos, parseProduct, productForm, productToForm, splitCsv } from '../product-form';
import { backTo, chrome, like, mediaSrc, PAGE_SIZE, pageNo, pick, str } from './common';
import { adminSellersRouter } from './sellers';
import { action, ago, chips, empty, esc, fmtDateTime, icon, mapsLink, num, page, pager, person, pill, searchBox, ugx } from './ui';

/** Routes under /admin/shop. */
export const adminShopRouter = Router();
adminShopRouter.use('/sellers', adminSellersRouter);

const CATEGORY_KEYS = PRODUCT_CATEGORIES.map((c) => c.key) as string[];
const firstPhoto = (csv: string | null) => mediaSrc((csv ?? '').split(',')[0]?.trim() || null);
const thumb = (src: string | null, alt = '') =>
  src ? `<img class="pthumb" src="${esc(src)}" alt="${esc(alt)}" loading="lazy">` : `<span class="pthumb" aria-hidden="true"></span>`;
/** Order status pill (the app's "primary" tone is the admin's orange "brand"). */
const statusPill = (s: string) => {
  const tone = orderStatusTone(s as OrderStatus);
  return pill(orderStatusLabel(s as OrderStatus), (tone === 'primary' ? 'brand' : tone) as Parameters<typeof pill>[1]);
};

// ── Products ─────────────────────────────────────────────────────────────────────────────────────────

const PRODUCT_FILTERS = ['active', 'review', 'hidden', 'out', 'all'] as const;

/** Where a product stands: checked or not, shown or hidden. */
const productPill = (r: ProductRow) =>
  r.review_status === 'pending'
    ? pill('Awaiting review', 'warning')
    : r.review_status === 'rejected'
      ? pill('Sent back to seller', 'danger')
      : r.is_active
        ? pill('In the shop', 'success')
        : pill('Hidden', 'neutral');

adminShopRouter.get('/products', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const status = pick(req.query.status, PRODUCT_FILTERS, 'active');
  const category = pick(str(req.query.category), ['all', ...CATEGORY_KEYS] as const, 'all');
  const q = str(req.query.q).trim().slice(0, 80);
  const p = pageNo(req);
  const params: unknown[] = [];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (status === 'active') where.push(`p.is_active AND p.review_status = 'approved'`);
  if (status === 'review') where.push(`p.review_status = 'pending' AND p.is_active`);
  if (status === 'hidden') where.push('NOT p.is_active');
  if (status === 'out') where.push('p.is_active AND p.stock = 0');
  if (category !== 'all') where.push(`p.category = ${arg(category)}`);
  if (q) {
    const t = arg(like(q));
    where.push(`(p.name ILIKE ${t} OR p.brand ILIKE ${t} OR p.part_number ILIKE ${t} OR p.compatible_with ILIKE ${t} OR s.shop_name ILIKE ${t})`);
  }
  const rows = await query<ProductRow & { sold: number }>(
    `SELECT p.*, s.shop_name AS seller_shop,
            COALESCE((SELECT SUM(i.quantity) FROM order_items i JOIN orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.status <> 'cancelled'), 0)::int AS sold
     FROM products p LEFT JOIN sellers s ON s.id = p.seller_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (p.review_status = 'pending') DESC, p.updated_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    params,
  );
  const keep = { status: status === 'active' ? '' : status, category: category === 'all' ? '' : category, q };
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Product</th><th>Sold by</th><th>Section</th><th class="num">Price</th><th class="num">In stock</th><th class="num">Sold</th><th>Status</th></tr></thead><tbody>${rows
        .slice(0, PAGE_SIZE)
        .map(
          (r) => `<tr><td><div class="person">${thumb(firstPhoto(r.photos), r.name)}<div><a class="strong" href="/admin/shop/products/${r.id}">${esc(r.name)}</a>
<span class="muted small">${esc([r.brand, r.part_number].filter(Boolean).join(' · ') || '—')}</span></div></div></td>
<td>${r.seller_id ? `<a href="/admin/shop/sellers/${r.seller_id}">${esc(r.seller_shop ?? 'Seller')}</a>` : '<span class="muted">MyCarRepair</span>'}</td><td>${esc(categoryLabel(r.category))}</td>
<td class="num">${esc(ugx(r.price))}</td><td class="num">${r.stock ? num(r.stock) : '<span class="pill danger">Sold out</span>'}</td><td class="num">${num(r.sold)}</td>
<td>${productPill(r)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(q ? 'No products match your search' : 'No products here yet', q ? '' : 'Add the first product: owners see it in the Shop straight away.');
  const body = `<section class="card"><div class="toolbar">${chips('/admin/shop/products', 'status', status, [['active', 'In the shop'], ['review', 'Awaiting review'], ['out', 'Sold out'], ['hidden', 'Hidden'], ['all', 'All']], keep)}
${searchBox('/admin/shop/products', q, 'Search name, brand, part number, car or seller', { status: keep.status, category: keep.category })}</div>
<div class="toolbar">${chips('/admin/shop/products', 'category', category, [['all', 'All sections'], ...PRODUCT_CATEGORIES.map((c) => [c.key, c.label] as [string, string])], keep)}</div>
${table}${pager('/admin/shop/products', p, rows.length > PAGE_SIZE, keep)}</section>`;
  res.send(
    page({
      title: 'Shop products',
      active: '/admin/shop/products',
      counts,
      maintenance,
      notice: str(req.query.notice),
      body,
      subtitle: 'Genuine parts and accessories owners can buy in the app: MyCarRepair’s own stock and checked seller listings.',
      actions: `<a class="btn primary" href="/admin/shop/products/new">${icon('package', 16)} Add product</a>`,
    }),
  );
});

adminShopRouter.get('/products/new', async (req, res) => {
  const { counts, maintenance } = await chrome();
  res.send(
    page({
      title: 'Add product',
      active: '/admin/shop/products',
      counts,
      maintenance,
      back: { href: '/admin/shop/products', label: 'Shop products' },
      body: productForm('/admin/shop/products', productToForm(), []),
    }),
  );
});

adminShopRouter.post('/products', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const { raw, parsed, error } = parseProduct(req);
  const files = filesOf(req, 'photos');
  const problem = error ?? (files.length ? undefined : 'Add at least one photo of the product.');
  if (!parsed || problem) {
    const { counts, maintenance } = await chrome();
    res.status(400).send(
      page({ title: 'Add product', active: '/admin/shop/products', counts, maintenance, back: { href: '/admin/shop/products', label: 'Shop products' }, body: productForm('/admin/shop/products', raw, [], problem) }),
    );
    return;
  }
  const id = await tx(async (db) => {
    const photos = await storeFiles(db, null, files);
    const r = await db.query<{ id: number }>(
      `INSERT INTO products (name, category, brand, part_number, price, stock, warranty_months, compatible_with, description, photos)
       VALUES ($1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, NULLIF($8, ''), NULLIF($9, ''), $10) RETURNING id`,
      [parsed.name, parsed.category, parsed.brand, parsed.part_number, parsed.price, parsed.stock, parsed.warranty_months, parsed.compatible_with, parsed.description, photos.join(',')],
    );
    return r.rows[0]!.id;
  });
  res.redirect(303, `/admin/shop/products/${id}?notice=product-created`);
});

adminShopRouter.get('/products/:id', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const r = await one<ProductRow>(`SELECT * FROM products WHERE id = $1`, [Number(req.params.id)]);
  if (!r) {
    res.status(404).send(page({ title: 'Product not found', active: '/admin/shop/products', counts, maintenance, back: { href: '/admin/shop/products', label: 'Shop products' }, body: empty('This product does not exist') }));
    return;
  }
  const photos = splitCsv(r.photos);
  const back = `/admin/shop/products/${r.id}`;
  const visibility = r.is_active
    ? action(`/admin/shop/products/${r.id}/visibility`, 'Hide from the shop', back, 'danger', `Hide ${r.name}? Owners can no longer buy it; past orders keep it.`)
    : action(`/admin/shop/products/${r.id}/visibility`, 'Show in the shop', back, 'success');
  // Seller listings: who sells it, and the check before it goes live (approve, or send back with a note).
  const seller = r.seller_id ? await one<SellerRow>(`SELECT * FROM sellers WHERE id = $1`, [r.seller_id]) : null;
  const review = seller
    ? `<section class="card"><div class="card-h"><h2>Seller listing</h2>${productPill(r)}</div><div class="card-b">
<dl class="kv"><dt>Seller</dt><dd><a href="/admin/shop/sellers/${seller.id}">${esc(seller.shop_name)}</a> ${seller.status === 'active' ? '' : pill(seller.status === 'pending' ? 'Shop awaiting approval' : 'Shop suspended', 'warning')}</dd>
<dt>Contact</dt><dd>${esc(seller.contact_name)} · <a href="tel:${esc(seller.phone)}">${esc(seller.phone)}</a></dd><dt>Location</dt><dd>${esc(seller.location ?? '—')}</dd>
${r.review_note ? `<dt>Last note</dt><dd>${esc(r.review_note)}</dd>` : ''}</dl>
<div class="actions" style="justify-content:flex-start;margin-top:14px">
${r.review_status !== 'approved' ? action(`${back}/review`, 'Approve listing', back, 'success') : ''}
<form method="post" action="${back}/review" class="inline" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><input type="hidden" name="back" value="${esc(back)}"><input type="hidden" name="decision" value="reject">
<input name="note" maxlength="300" placeholder="What should the seller fix?" aria-label="Note to the seller" required style="border:1px solid var(--line);border-radius:8px;padding:7px 10px;font:inherit;min-width:240px">
<button class="btn danger">Send back</button></form></div>
<p class="hint" style="margin:10px 0 0">Check the photos show the real item, the part number and brand are right, and the price is fair. Approved listings go live while the seller's shop is active.</p></div></section>`
    : '';
  res.send(
    page({
      title: r.name,
      active: '/admin/shop/products',
      counts,
      maintenance,
      notice: str(req.query.notice),
      back: { href: '/admin/shop/products', label: 'Shop products' },
      subtitle: `${productPill(r)} ${r.stock ? pill(`${num(r.stock)} in stock`, 'info') : pill('Sold out', 'danger')}${seller ? ` · sold by ${esc(seller.shop_name)}` : ''}`,
      actions: `<div class="actions">${visibility}</div>`,
      body: review + productForm(`/admin/shop/products/${r.id}`, productToForm(r), photos),
    }),
  );
});

adminShopRouter.post('/products/:id', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const current = await one<ProductRow>(`SELECT * FROM products WHERE id = $1`, [Number(req.params.id)]);
  if (!current) {
    res.redirect(303, '/admin/shop/products');
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
    const { counts, maintenance } = await chrome();
    res.status(400).send(
      page({ title: current.name, active: '/admin/shop/products', counts, maintenance, back: { href: '/admin/shop/products', label: 'Shop products' }, body: productForm(`/admin/shop/products/${current.id}`, raw, currentPhotos, problem) }),
    );
    return;
  }
  await tx(async (db) => {
    const added = await storeFiles(db, null, files);
    await db.query(
      `UPDATE products SET name = $2, category = $3, brand = NULLIF($4, ''), part_number = NULLIF($5, ''), price = $6, stock = $7, warranty_months = $8,
              compatible_with = NULLIF($9, ''), description = NULLIF($10, ''), photos = $11, updated_at = now() WHERE id = $1`,
      [current.id, parsed.name, parsed.category, parsed.brand, parsed.part_number, parsed.price, parsed.stock, parsed.warranty_months, parsed.compatible_with, parsed.description, [...kept, ...added].join(',')],
    );
  });
  res.redirect(303, `/admin/shop/products/${current.id}?notice=product-saved`);
});

/** POST /admin/shop/products/:id/review {decision: approve|reject, note?} — the check on a seller listing. */
adminShopRouter.post('/products/:id/review', async (req, res) => {
  const approve = str(req.body?.decision) !== 'reject';
  const note = str(req.body?.note).trim().slice(0, 300);
  await query(`UPDATE products SET review_status = $2, review_note = $3, updated_at = now() WHERE id = $1 AND seller_id IS NOT NULL`, [
    Number(req.params.id),
    approve ? 'approved' : 'rejected',
    approve ? null : note || 'Please check the photos, name and part number.',
  ]);
  res.redirect(303, backTo(req, approve ? 'listing-approved' : 'listing-rejected'));
});

adminShopRouter.post('/products/:id/visibility', async (req, res) => {
  const r = await one<{ is_active: boolean }>(`UPDATE products SET is_active = NOT is_active, updated_at = now() WHERE id = $1 RETURNING is_active`, [Number(req.params.id)]);
  res.redirect(303, backTo(req, r?.is_active ? 'product-shown' : 'product-hidden'));
});

// ── Orders ───────────────────────────────────────────────────────────────────────────────────────────

const ORDER_FILTERS = ['open', 'placed', 'active', 'delivered', 'cancelled', 'all'] as const;

interface OrderListRow extends OrderRow {
  owner_name: string;
  owner_phone: string | null;
  item_count: number;
  first_item: string | null;
}

adminShopRouter.get('/orders', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const status = pick(req.query.status, ORDER_FILTERS, 'open');
  const q = str(req.query.q).trim().slice(0, 80);
  const p = pageNo(req);
  const params: unknown[] = [];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (status === 'open') where.push(`o.status NOT IN ('delivered', 'cancelled')`);
  if (status === 'placed') where.push(`o.status = 'placed'`);
  if (status === 'active') where.push(`o.status IN ('confirmed', 'out_for_delivery', 'ready_for_pickup')`);
  if (status === 'delivered' || status === 'cancelled') where.push(`o.status = ${arg(status)}`);
  if (q) {
    const t = arg(like(q));
    where.push(`(u.full_name ILIKE ${t} OR u.phone ILIKE ${t} OR o.contact_phone ILIKE ${t} OR o.id::text = ${arg(q.replace(/^#/, ''))})`);
  }
  const rows = await query<OrderListRow>(
    `SELECT o.*, u.full_name AS owner_name, u.phone AS owner_phone,
            (SELECT COALESCE(SUM(quantity), 0) FROM order_items WHERE order_id = o.id)::int AS item_count,
            (SELECT name FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS first_item
     FROM orders o JOIN users u ON u.id = o.owner_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY (o.status = 'placed') DESC, o.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    params,
  );
  const keep = { status: status === 'open' ? '' : status, q };
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Order</th><th>Customer</th><th>Status</th><th>How</th><th class="num">Total</th><th>Placed</th></tr></thead><tbody>${rows
        .slice(0, PAGE_SIZE)
        .map(
          (o) => `<tr><td><a class="strong" href="/admin/shop/orders/${o.id}">#${o.id}</a><br><span class="muted small">${esc(o.first_item ?? '')}${o.item_count > 1 ? ` + ${o.item_count - 1} more` : ''}</span></td>
<td>${person(o.owner_name, o.contact_phone, `/admin/users/${o.owner_id}`)}</td><td>${statusPill(o.status)}</td>
<td>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}<br><span class="muted small">${o.payment_method === 'cash' ? 'Cash' : 'Mobile money'}</span></td>
<td class="num">${esc(ugx(o.total))}</td><td><span title="${esc(fmtDateTime(o.created_at))}">${esc(ago(o.created_at))}</span></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(q ? 'No orders match your search' : 'No orders here', q ? '' : 'Orders appear here as soon as owners check out in the app.');
  const body = `<section class="card"><div class="toolbar">${chips('/admin/shop/orders', 'status', status, [['open', 'Open'], ['placed', 'New'], ['active', 'In progress'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All']], keep)}
${searchBox('/admin/shop/orders', q, 'Search customer, phone or order #', { status: keep.status })}</div>${table}${pager('/admin/shop/orders', p, rows.length > PAGE_SIZE, keep)}</section>`;
  res.send(
    page({
      title: 'Shop orders',
      active: '/admin/shop/orders',
      counts,
      maintenance,
      notice: str(req.query.notice),
      body,
      refreshSeconds: 30,
      subtitle: 'Confirm new orders, then mark them on the way (or ready for pickup) and delivered.',
    }),
  );
});

const ACTION_TEXT: Partial<Record<OrderStatus, [string, 'primary' | 'success' | 'danger']>> = {
  confirmed: ['Confirm order', 'primary'],
  out_for_delivery: ['Mark on the way', 'primary'],
  ready_for_pickup: ['Mark ready for pickup', 'primary'],
  delivered: ['Mark delivered', 'success'],
  cancelled: ['Cancel order', 'danger'],
};

adminShopRouter.get('/orders/:id', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const [found] = await loadOrders(pool, 'o.id = $1', [Number(req.params.id)]);
  if (!found) {
    res.status(404).send(page({ title: 'Order not found', active: '/admin/shop/orders', counts, maintenance, back: { href: '/admin/shop/orders', label: 'Shop orders' }, body: empty('This order does not exist') }));
    return;
  }
  const o = found.order;
  const owner = await one<UserRow>(`SELECT * FROM users WHERE id = $1`, [o.owner_id]);
  const { pickupLocation } = await shopSettings();
  const back = `/admin/shop/orders/${o.id}`;
  const actions = nextOrderStatuses(o.status as OrderStatus, o.fulfilment as 'delivery' | 'pickup')
    .map((next) => {
      const [label, style] = ACTION_TEXT[next] ?? [orderStatusLabel(next), 'primary'];
      const confirmText =
        next === 'cancelled' ? `Cancel order #${o.id}? The items go back into stock and the owner is told.` : next === 'delivered' ? `Mark order #${o.id} delivered${o.payment_method ? ' and paid' : ''}?` : undefined;
      return `<form method="post" action="/admin/shop/orders/${o.id}/status" class="inline"${confirmText ? ` data-confirm="${esc(confirmText)}"` : ''}><input type="hidden" name="back" value="${esc(back)}"><input type="hidden" name="next" value="${next}"><button class="btn ${style}">${esc(label)}</button></form>`;
    })
    .join(' ');
  const items = found.items as OrderItemRow[];
  // Marketplace sellers in this order: where to collect their items, and whether they have them ready.
  const sellerIds = [...new Set(items.map((i) => i.seller_id).filter((x): x is number => x != null))];
  const sellers = sellerIds.length ? await query<SellerRow>(`SELECT * FROM sellers WHERE id = ANY($1::int[])`, [sellerIds]) : [];
  const sellerOf = (id: number | null) => sellers.find((x) => x.id === id);
  const collectPill = (i: OrderItemRow) =>
    i.seller_id == null
      ? '<span class="muted small">MyCarRepair stock</span>'
      : i.seller_status === 'collected'
        ? pill('Collected', 'success')
        : i.seller_status === 'ready'
          ? pill('Ready at seller', 'info')
          : pill(o.status === 'placed' ? 'Seller sees it once confirmed' : 'Seller getting it ready', 'warning');
  const open = o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'placed';
  const collect = sellers
    .map((sl) => {
      const waiting = items.some((i) => i.seller_id === sl.id && i.seller_status !== 'collected');
      return `<div class="approval"><div><a class="strong" href="/admin/shop/sellers/${sl.id}">${esc(sl.shop_name)}</a><div class="meta"><span>${icon('map-pin', 15)} ${esc(sl.location ?? '—')}</span><span>${icon('phone', 15)} <a href="tel:${esc(sl.phone)}">${esc(sl.phone)}</a></span></div></div>
<div class="actions">${waiting && open ? action(`/admin/shop/orders/${o.id}/collected`, 'Mark collected', back, 'success', undefined, { seller: String(sl.id) }) : waiting ? '' : pill('All collected', 'success')}</div></div>`;
    })
    .join('');
  const body = `<div class="grid2"><div>
<section class="card"><div class="card-h"><h2>Items</h2><span class="muted small">${num(items.reduce((a, i) => a + i.quantity, 0))} item(s)</span></div>
<table class="t"><thead><tr><th>Product</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Line total</th></tr></thead><tbody>${items
    .map(
      (i) => `<tr><td><div class="person">${thumb(firstPhoto(i.photos ?? null), i.name)}<div>${i.product_id ? `<a class="strong" href="/admin/shop/products/${i.product_id}">${esc(i.name)}</a>` : `<span class="strong">${esc(i.name)}</span>`}
<span class="muted small">${i.seller_id ? esc(sellerOf(i.seller_id)?.shop_name ?? 'Seller') : 'MyCarRepair'}</span> ${collectPill(i)}</div></div></td>
<td class="num">${num(i.quantity)}</td><td class="num">${esc(ugx(i.unit_price))}</td><td class="num">${esc(ugx(Number(i.unit_price) * i.quantity))}</td></tr>`,
    )
    .join('')}</tbody></table>
<div class="card-b"><dl class="kv"><dt>Subtotal</dt><dd>${esc(ugx(o.subtotal))}</dd><dt>Delivery</dt><dd>${Number(o.delivery_fee) ? esc(ugx(o.delivery_fee)) : 'Free'}</dd><dt><b>Total to collect</b></dt><dd><b>${esc(ugx(o.total))}</b></dd></dl></div></section>
${collect ? `<section class="card"><div class="card-h"><h2>Collect from sellers</h2><span class="muted small">Pick these up before delivery</span></div>${collect}</section>` : ''}
${o.note ? `<section class="card"><div class="card-h"><h2>Note from the owner</h2></div><div class="card-b"><p style="margin:0">${esc(o.note)}</p></div></section>` : ''}
</div><div>
<section class="card"><div class="card-h"><h2>Status</h2>${statusPill(o.status)}</div><div class="card-b"><dl class="kv"><dt>Placed</dt><dd>${esc(fmtDateTime(o.created_at))}</dd><dt>Last change</dt><dd>${esc(fmtDateTime(o.updated_at))}</dd></dl>
${actions ? `<div class="actions" style="justify-content:flex-start;margin-top:14px">${actions}</div>` : '<p class="muted" style="margin:12px 0 0">This order is closed.</p>'}</div></section>
<section class="card"><div class="card-h"><h2>Customer</h2></div><div class="card-b"><dl class="kv"><dt>Name</dt><dd>${owner ? `<a href="/admin/users/${owner.id}">${esc(owner.full_name)}</a>` : '—'}</dd>
<dt>Phone for this order</dt><dd><a href="tel:${esc(o.contact_phone)}">${esc(o.contact_phone)}</a></dd>${owner ? `<dt>Email</dt><dd>${esc(owner.email)}</dd>` : ''}</dl></div></section>
<section class="card"><div class="card-h"><h2>${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}</h2>${pill(o.payment_method === 'cash' ? 'Cash' : 'Mobile money', 'brand')}</div><div class="card-b"><dl class="kv">${
    o.fulfilment === 'delivery'
      ? `<dt>Address</dt><dd>${esc(o.delivery_address ?? '—')}</dd><dt>Map</dt><dd>${mapsLink(o.delivery_lat, o.delivery_lng)}</dd>`
      : `<dt>Collect at</dt><dd>${esc(pickupLocation)}</dd>`
  }<dt>Payment</dt><dd>${o.payment_method === 'cash' ? 'Cash' : 'Mobile money (MTN MoMo / Airtel Money)'} ${o.fulfilment === 'delivery' ? 'on delivery' : 'at pickup'}</dd></dl></div></section>
</div></div>`;
  res.send(
    page({
      title: `Order #${o.id}`,
      active: '/admin/shop/orders',
      counts,
      maintenance,
      notice: str(req.query.notice),
      back: { href: '/admin/shop/orders', label: 'Shop orders' },
      subtitle: `${statusPill(o.status)} ${esc(ugx(o.total))} · ${o.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'}`,
      body,
      refreshSeconds: o.status === 'delivered' || o.status === 'cancelled' ? undefined : 30,
    }),
  );
});

/** POST /admin/shop/orders/:id/collected {seller} — staff picked up this seller's items for the order. */
adminShopRouter.post('/orders/:id/collected', async (req, res) => {
  await query(`UPDATE order_items SET seller_status = 'collected' WHERE order_id = $1 AND seller_id = $2`, [Number(req.params.id), Number(req.body?.seller)]);
  res.redirect(303, backTo(req, 'items-collected'));
});

adminShopRouter.post('/orders/:id/status', async (req, res) => {
  const next = str(req.body?.next) as OrderStatus;
  try {
    await changeOrderStatus(Number(req.params.id), next, 'staff');
  } catch {
    // The order moved on in another tab: show it as it is now.
    res.redirect(303, `/admin/shop/orders/${Number(req.params.id)}`);
    return;
  }
  res.redirect(303, backTo(req, 'order-updated'));
});
