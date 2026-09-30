// Shop (marketplace) API for car owners: browse genuine parts and accessories (from MyCarRepair and checked
// marketplace sellers), place orders (cash or mobile money on delivery or at pickup), follow and cancel them. Prices
// and totals always come from the database, never the app, and stock is taken atomically so two owners can't buy
// the last item twice.
import { Router } from 'express';
import { z } from 'zod';

import { MAX_ORDER_QUANTITY, PRODUCT_CATEGORIES } from '@/constants/config';
import { orderTotals } from '@/utils/shop';

import { me, requireAuth, requireRole } from '../auth';
import { one, pool, query, tx } from '../db';
import { E } from '../errors';
import { toOrder, toProduct } from '../mappers';
import { baseUrl } from '../media';
import { changeOrderStatus, commissionPercent, loadOrders, PRODUCT_SELECT, SELLABLE, shopSettings } from '../shop';
import type { OrderRow, ProductRow, VehicleRow } from '../types';

export const shopRouter = Router();
shopRouter.use(requireAuth, requireRole('owner'));

const CATEGORY_KEYS = PRODUCT_CATEGORIES.map((c) => c.key) as [string, ...string[]];
const like = (q: string) => `%${q.replace(/[\\%_]/g, '\\$&')}%`;

/**
 * GET /shop/products?category=&q=&vehicleId= — active products, in-stock first. `vehicleId` (one of the owner's
 * cars) keeps products that name its make or model, plus universal ones (nothing in "fits").
 */
shopRouter.get('/products', async (req, res) => {
  const q = z
    .object({
      category: z.enum(CATEGORY_KEYS).optional(),
      q: z.string().trim().max(80).optional(),
      vehicleId: z.coerce.number().int().positive().optional(),
    })
    .parse(req.query);
  const params: unknown[] = [];
  const arg = (v: unknown) => `$${params.push(v)}`;
  const where = [SELLABLE];
  if (q.category) where.push(`p.category = ${arg(q.category)}`);
  if (q.q) {
    const t = arg(like(q.q));
    where.push(`(p.name ILIKE ${t} OR p.brand ILIKE ${t} OR p.part_number ILIKE ${t} OR p.compatible_with ILIKE ${t} OR p.description ILIKE ${t} OR s.shop_name ILIKE ${t})`);
  }
  if (q.vehicleId) {
    const v = await one<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2`, [q.vehicleId, me(req).id]);
    if (!v) throw E.notFound('Vehicle');
    where.push(`(COALESCE(p.compatible_with, '') = '' OR p.compatible_with ILIKE ${arg(like(v.make))} OR p.compatible_with ILIKE ${arg(like(v.model))})`);
  }
  const rows = await query<ProductRow>(`${PRODUCT_SELECT} WHERE ${where.join(' AND ')} ORDER BY (p.stock > 0) DESC, p.created_at DESC LIMIT 200`, params);
  const base = baseUrl(req);
  res.json(rows.map((r) => toProduct(base, r)));
});

/** GET /shop/products/:id — one product that is on sale. */
shopRouter.get('/products/:id', async (req, res) => {
  const row = await one<ProductRow>(`${PRODUCT_SELECT} WHERE p.id = $1 AND ${SELLABLE}`, [Number(req.params.id)]);
  if (!row) throw E.notFound('Product');
  res.json(toProduct(baseUrl(req), row));
});

const orderSchema = z
  .object({
    items: z
      .array(z.object({ productId: z.number().int().positive(), quantity: z.number().int().min(1).max(MAX_ORDER_QUANTITY) }))
      .min(1, 'Your cart is empty.')
      .max(30),
    fulfilment: z.enum(['delivery', 'pickup']),
    paymentMethod: z.enum(['cash', 'mobile_money']),
    deliveryAddress: z.string().trim().max(300).optional().nullable(),
    lat: z.number().min(-90).max(90).optional().nullable(),
    lng: z.number().min(-180).max(180).optional().nullable(),
    contactPhone: z.string().trim().min(7, 'Enter a phone number we can call.').max(20),
    note: z.string().trim().max(300).optional().nullable(),
  })
  .refine((b) => b.fulfilment === 'pickup' || (b.deliveryAddress?.length ?? 0) >= 5, {
    message: 'Enter the delivery address (area, street, landmark).',
    path: ['deliveryAddress'],
  });

/** POST /shop/orders — places an order at the database's prices, taking the stock in the same transaction. */
shopRouter.post('/orders', async (req, res) => {
  const b = orderSchema.parse(req.body);
  const u = me(req);
  // The same product twice in one request counts as one line.
  const wanted = new Map<number, number>();
  for (const i of b.items) wanted.set(i.productId, Math.min(MAX_ORDER_QUANTITY, (wanted.get(i.productId) ?? 0) + i.quantity));

  const orderId = await tx(async (db) => {
    // Lock in id order so concurrent orders for the same products can't deadlock. "sellable" applies the same
    // rules as the shop listing (active, checked, and the seller's shop open).
    const products = (
      await db.query<ProductRow & { sellable: boolean }>(
        `SELECT p.*, ${SELLABLE} AS sellable FROM products p LEFT JOIN sellers s ON s.id = p.seller_id
         WHERE p.id = ANY($1::int[]) ORDER BY p.id FOR UPDATE OF p`,
        [[...wanted.keys()]],
      )
    ).rows;
    const lines = [...wanted].map(([productId, quantity]) => {
      const p = products.find((x) => x.id === productId);
      if (!p || !p.sellable) throw E.conflict('PRODUCT_UNAVAILABLE', 'An item in your cart is no longer sold. Remove it and try again.');
      if (p.stock < quantity) {
        throw E.conflict('OUT_OF_STOCK', p.stock ? `Only ${p.stock} × ${p.name} left in stock.` : `${p.name} is sold out.`);
      }
      return { product: p, quantity, unitPrice: Number(p.price) };
    });
    const settings = await shopSettings(db);
    // MyCarRepair's cut of seller items, fixed on each line at ordering time (its own products: 0).
    const commission = await commissionPercent(db);
    const totals = orderTotals(lines, b.fulfilment, settings.deliveryFee);
    for (const l of lines) await db.query(`UPDATE products SET stock = stock - $2, updated_at = now() WHERE id = $1`, [l.product.id, l.quantity]);
    const o = (
      await db.query<OrderRow>(
        `INSERT INTO orders (owner_id, fulfilment, payment_method, delivery_address, delivery_lat, delivery_lng, contact_phone, note, subtotal, delivery_fee, total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
        [
          u.id,
          b.fulfilment,
          b.paymentMethod,
          b.fulfilment === 'delivery' ? b.deliveryAddress : null,
          b.fulfilment === 'delivery' ? (b.lat ?? null) : null,
          b.fulfilment === 'delivery' ? (b.lng ?? null) : null,
          b.contactPhone,
          b.note || null,
          totals.subtotal,
          totals.deliveryFee,
          totals.total,
        ],
      )
    ).rows[0]!;
    for (const l of lines) {
      await db.query(
        `INSERT INTO order_items (order_id, product_id, name, unit_price, quantity, seller_id, commission_percent) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [o.id, l.product.id, l.product.name, l.unitPrice, l.quantity, l.product.seller_id, l.product.seller_id ? commission : 0],
      );
    }
    return o.id;
  });
  const [found] = await loadOrders(pool, 'o.id = $1', [orderId]);
  res.status(201).json(toOrder(baseUrl(req), found!.order, found!.items));
});

/** GET /shop/orders — the owner's orders, newest first. */
shopRouter.get('/orders', async (req, res) => {
  const base = baseUrl(req);
  const list = await loadOrders(pool, 'o.owner_id = $1', [me(req).id]);
  res.json(list.map((x) => toOrder(base, x.order, x.items)));
});

/** GET /shop/orders/:id — one of the owner's orders. */
shopRouter.get('/orders/:id', async (req, res) => {
  const [found] = await loadOrders(pool, 'o.id = $1 AND o.owner_id = $2', [Number(req.params.id), me(req).id]);
  if (!found) throw E.notFound('Order');
  res.json(toOrder(baseUrl(req), found.order, found.items));
});

/** POST /shop/orders/:id/cancel — the owner cancels while it's still "placed"; the stock goes back. */
shopRouter.post('/orders/:id/cancel', async (req, res) => {
  await changeOrderStatus(Number(req.params.id), 'cancelled', { owner: me(req).id });
  const [found] = await loadOrders(pool, 'o.id = $1', [Number(req.params.id)]);
  res.json(toOrder(baseUrl(req), found!.order, found!.items));
});
