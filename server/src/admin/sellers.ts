// Admin console pages for marketplace sellers (mounted at /admin/shop/sellers): the list of shops, approving new
// sellers after a call to verify them, suspending (hides their products and signs them out), and each seller's
// money: what MyCarRepair owes them for delivered items and the payouts sent.
import { Router } from 'express';

import { categoryLabel } from '@/utils/shop';

import { pool, query, tx, one } from '../db';
import { splitCsv } from '../product-form';
import { sellerBalances, type SellerLine } from '../sellers';
import { sellerNet } from '../shop';
import type { ProductRow, SellerPayoutRow, SellerRow } from '../types';
import { backTo, chrome, like, mediaSrc, PAGE_SIZE, pageNo, pick, str } from './common';
import { action, ago, chips, empty, esc, fmtDate, fmtDateTime, icon, num, page, pager, person, pill, searchBox, ugx } from './ui';

/** Routes under /admin/shop/sellers. */
export const adminSellersRouter = Router();

const FILTERS = ['pending', 'active', 'suspended', 'all'] as const;

/** Account status of a shop. */
const statusPill = (s: string) => (s === 'active' ? pill('Active', 'success') : s === 'pending' ? pill('Awaiting approval', 'warning') : pill('Suspended', 'danger'));

adminSellersRouter.get('/', async (req, res) => {
  const { counts, maintenance } = await chrome();
  // New shops first when there are any; otherwise the active ones.
  const status = pick(req.query.status, FILTERS, counts.sellers ? 'pending' : 'active');
  const q = str(req.query.q).trim().slice(0, 80);
  const p = pageNo(req);
  const params: unknown[] = [];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const where: string[] = [];
  if (status !== 'all') where.push(`s.status = ${arg(status)}`);
  if (q) {
    const t = arg(like(q));
    where.push(`(s.shop_name ILIKE ${t} OR s.contact_name ILIKE ${t} OR s.phone ILIKE ${t} OR s.email ILIKE ${t} OR s.location ILIKE ${t})`);
  }
  const rows = await query<SellerRow & { live: number; waiting: number }>(
    `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.is_active AND p.review_status = 'approved')::int AS live,
            (SELECT COUNT(*) FROM products p WHERE p.seller_id = s.id AND p.is_active AND p.review_status = 'pending')::int AS waiting
     FROM sellers s ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY s.created_at DESC LIMIT ${PAGE_SIZE + 1} OFFSET ${(p - 1) * PAGE_SIZE}`,
    params,
  );
  const owed = new Map<number, number>();
  for (const r of rows.slice(0, PAGE_SIZE)) owed.set(r.id, (await sellerBalances(pool, r.id)).owed);
  const keep = { status, q };
  const table = rows.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Shop</th><th>Location</th><th class="num">Live products</th><th class="num">Owed to seller</th><th>Status</th><th>Joined</th></tr></thead><tbody>${rows
        .slice(0, PAGE_SIZE)
        .map(
          (r) => `<tr><td>${person(r.shop_name, `${r.contact_name} · ${r.phone}`, `/admin/shop/sellers/${r.id}`)}</td><td>${esc(r.location ?? '—')}</td>
<td class="num">${num(r.live)}${r.waiting ? `<br><span class="muted small">${num(r.waiting)} awaiting review</span>` : ''}</td><td class="num">${esc(ugx(owed.get(r.id) ?? 0))}</td>
<td>${statusPill(r.status)}</td><td><span title="${esc(fmtDateTime(r.created_at))}">${esc(ago(r.created_at))}</span></td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : empty(q ? 'No sellers match your search' : 'No sellers here', status === 'pending' ? 'New shops appear here when they sign up on the seller portal.' : '');
  const body = `<section class="card"><div class="toolbar">${chips('/admin/shop/sellers', 'status', status, [['pending', 'Awaiting approval'], ['active', 'Active'], ['suspended', 'Suspended'], ['all', 'All']], keep)}
${searchBox('/admin/shop/sellers', q, 'Search shop, name, phone or location', { status })}</div>${table}${pager('/admin/shop/sellers', p, rows.length > PAGE_SIZE, keep)}</section>
<p class="muted small">Sellers sign up at <b>/seller/signup</b> on this server. Share that link with shops you want to bring on.</p>`;
  res.send(
    page({
      title: 'Sellers',
      active: '/admin/shop/sellers',
      counts,
      maintenance,
      notice: str(req.query.notice),
      body,
      subtitle: 'Shops that sell through the MyCarRepair Shop. Call new sellers to verify them before approving.',
    }),
  );
});

adminSellersRouter.get('/:id', async (req, res) => {
  const { counts, maintenance } = await chrome();
  const s = await one<SellerRow>(`SELECT * FROM sellers WHERE id = $1`, [Number(req.params.id)]);
  if (!s) {
    res.status(404).send(page({ title: 'Seller not found', active: '/admin/shop/sellers', counts, maintenance, back: { href: '/admin/shop/sellers', label: 'Sellers' }, body: empty('This seller does not exist') }));
    return;
  }
  const back = `/admin/shop/sellers/${s.id}`;
  const [money, products, lines, payouts] = await Promise.all([
    sellerBalances(pool, s.id),
    query<ProductRow>(`SELECT * FROM products WHERE seller_id = $1 ORDER BY (review_status = 'pending') DESC, updated_at DESC LIMIT 100`, [s.id]),
    query<SellerLine>(
      `SELECT i.*, o.status AS order_status, o.created_at AS order_created_at FROM order_items i JOIN orders o ON o.id = i.order_id
       WHERE i.seller_id = $1 AND o.status <> 'cancelled' ORDER BY o.created_at DESC LIMIT 50`,
      [s.id],
    ),
    query<SellerPayoutRow>(`SELECT * FROM seller_payouts WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50`, [s.id]),
  ]);
  const actions =
    s.status === 'pending'
      ? `${action(`${back}/approve`, 'Approve seller', back, 'success')} ${action(`${back}/suspend`, 'Reject', back, 'danger', `Reject ${s.shop_name}? They can't sell or sign in.`)}`
      : s.status === 'active'
        ? action(`${back}/suspend`, 'Suspend seller', back, 'danger', `Suspend ${s.shop_name}? Their products leave the Shop and they are signed out.`)
        : action(`${back}/reactivate`, 'Reactivate seller', back, 'success');
  const productRows = products.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Product</th><th class="num">Price</th><th class="num">Stock</th><th>Status</th></tr></thead><tbody>${products
        .map((p) => {
          const src = mediaSrc(splitCsv(p.photos)[0] ?? null);
          const st = p.review_status === 'pending' ? pill('Awaiting review', 'warning') : p.review_status === 'rejected' ? pill('Sent back', 'danger') : p.is_active ? pill('In the shop', 'success') : pill('Hidden', 'neutral');
          return `<tr><td><div class="person">${src ? `<img class="pthumb" src="${esc(src)}" alt="" loading="lazy">` : '<span class="pthumb"></span>'}<div><a class="strong" href="/admin/shop/products/${p.id}">${esc(p.name)}</a><span class="muted small">${esc(categoryLabel(p.category))}</span></div></div></td>
<td class="num">${esc(ugx(p.price))}</td><td class="num">${num(p.stock)}</td><td>${st}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : empty('No products yet', '');
  const lineRows = lines.length
    ? `<div class="scroll"><table class="t"><thead><tr><th>Order</th><th>Item</th><th class="num">Seller's share</th><th>Status</th></tr></thead><tbody>${lines
        .map((l) => {
          const m = sellerNet(l);
          const st = l.order_status === 'delivered' ? (l.payout_id ? pill('Paid', 'success') : pill('Owed', 'warning')) : pill(l.seller_status === 'collected' ? 'Collected' : l.seller_status === 'ready' ? 'Ready' : 'Open', 'info');
          return `<tr><td><a href="/admin/shop/orders/${l.order_id}">#${l.order_id}</a><br><span class="muted small">${esc(fmtDate(l.order_created_at))}</span></td><td>${esc(l.name)} × ${num(l.quantity)}</td>
<td class="num">${esc(ugx(m.net))}<br><span class="muted small">of ${esc(ugx(m.gross))}</span></td><td>${st}</td></tr>`;
        })
        .join('')}</tbody></table></div>`
    : empty('No sales yet', '');
  const payoutForm = money.owed
    ? `<form method="post" action="${back}/payout" data-confirm="Record a payout of ${esc(ugx(money.owed))} to ${esc(s.shop_name)}? Only do this after sending the money.">
<input type="hidden" name="back" value="${esc(back)}"><div class="field"><label for="method">Paid by</label><select id="method" name="method"><option value="mobile_money">Mobile money</option><option value="bank">Bank transfer</option><option value="cash">Cash</option></select></div>
<div class="field"><label for="reference">Transaction reference</label><input id="reference" name="reference" maxlength="100" placeholder="MoMo transaction ID"></div>
<button class="btn success">${icon('banknote', 16)} Record payout of ${esc(ugx(money.owed))}</button></form>`
    : '<p class="muted" style="margin:0">Nothing is owed right now. Items count once their order is delivered.</p>';
  const body = `<div class="tiles compact"><div class="tile${money.owed ? ' alert' : ''}"><div class="label">Owed to seller</div><div class="value">${esc(ugx(money.owed))}</div><div class="note">delivered, not yet paid</div></div>
<div class="tile"><div class="label">On the way</div><div class="value">${esc(ugx(money.coming))}</div><div class="note">in open orders</div></div>
<div class="tile"><div class="label">Paid to date</div><div class="value">${esc(ugx(money.paid))}</div><div class="note">${num(payouts.length)} payout(s)</div></div></div>
<div class="grid2"><div>
<section class="card"><div class="card-h"><h2>Products</h2><span class="muted small">${num(products.length)}</span></div>${productRows}</section>
<section class="card"><div class="card-h"><h2>Recent sales</h2></div>${lineRows}</section>
</div><div>
<section class="card"><div class="card-h"><h2>Shop</h2>${statusPill(s.status)}</div><div class="card-b"><dl class="kv">
<dt>Contact</dt><dd>${esc(s.contact_name)}</dd><dt>Phone</dt><dd><a href="tel:${esc(s.phone)}">${esc(s.phone)}</a></dd><dt>Email</dt><dd>${esc(s.email)}</dd>
<dt>Location</dt><dd>${esc(s.location ?? '—')}</dd><dt>Sells</dt><dd>${esc(s.about ?? '—')}</dd><dt>Payout number</dt><dd>${esc(s.payout_number ?? 'Not given yet')}</dd>
<dt>Joined</dt><dd>${esc(fmtDateTime(s.created_at))}</dd></dl><div class="actions" style="justify-content:flex-start;margin-top:14px">${actions}</div></div></section>
<section class="card"><div class="card-h"><h2>Pay the seller</h2></div><div class="card-b">${payoutForm}</div></section>
<section class="card"><div class="card-h"><h2>Payouts</h2></div>${
    payouts.length
      ? `<table class="t"><tbody>${payouts.map((p) => `<tr><td>${esc(fmtDate(p.created_at))}<br><span class="muted small">${esc(p.method === 'mobile_money' ? 'Mobile money' : p.method === 'bank' ? 'Bank' : 'Cash')}${p.reference ? ` · ${esc(p.reference)}` : ''}</span></td><td class="num">${esc(ugx(p.amount))}</td></tr>`).join('')}</tbody></table>`
      : empty('No payouts yet', '')
  }</section>
</div></div>`;
  res.send(
    page({
      title: s.shop_name,
      active: '/admin/shop/sellers',
      counts,
      maintenance,
      notice: str(req.query.notice),
      back: { href: '/admin/shop/sellers', label: 'Sellers' },
      subtitle: `${statusPill(s.status)} ${esc(s.location ?? '')}`,
      body,
    }),
  );
});

adminSellersRouter.post('/:id/approve', async (req, res) => {
  await query(`UPDATE sellers SET status = 'active' WHERE id = $1`, [Number(req.params.id)]);
  res.redirect(303, backTo(req, 'seller-approved'));
});

adminSellersRouter.post('/:id/reactivate', async (req, res) => {
  await query(`UPDATE sellers SET status = 'active' WHERE id = $1`, [Number(req.params.id)]);
  res.redirect(303, backTo(req, 'seller-reactivated'));
});

// Suspending bumps the session version, which signs the seller out of the portal everywhere; their products
// leave the Shop straight away (the Shop only sells from active sellers).
adminSellersRouter.post('/:id/suspend', async (req, res) => {
  await query(`UPDATE sellers SET status = 'suspended', session_version = session_version + 1 WHERE id = $1`, [Number(req.params.id)]);
  res.redirect(303, backTo(req, 'seller-suspended'));
});

/**
 * POST /admin/shop/sellers/:id/payout {method, reference} — records that staff paid the seller everything owed:
 * the amount is worked out here from the delivered, unpaid lines (never typed in), and those lines are marked paid.
 */
adminSellersRouter.post('/:id/payout', async (req, res) => {
  const sellerId = Number(req.params.id);
  const method = pick(req.body?.method, ['mobile_money', 'bank', 'cash'] as const, 'mobile_money');
  const reference = str(req.body?.reference).trim().slice(0, 100);
  const paid = await tx(async (db) => {
    const lines = (
      await db.query<SellerLine>(
        `SELECT i.* FROM order_items i JOIN orders o ON o.id = i.order_id
         WHERE i.seller_id = $1 AND o.status = 'delivered' AND i.payout_id IS NULL FOR UPDATE OF i`,
        [sellerId],
      )
    ).rows;
    const amount = lines.reduce((sum, l) => sum + sellerNet(l).net, 0);
    if (!lines.length || amount <= 0) return false;
    const payout = (
      await db.query<{ id: number }>(`INSERT INTO seller_payouts (seller_id, amount, method, reference) VALUES ($1, $2, $3, NULLIF($4, '')) RETURNING id`, [sellerId, amount, method, reference])
    ).rows[0]!;
    await db.query(`UPDATE order_items SET payout_id = $1 WHERE id = ANY($2::int[])`, [payout.id, lines.map((l) => l.id)]);
    return true;
  });
  res.redirect(303, backTo(req, paid ? 'payout-recorded' : 'payout-none'));
});
