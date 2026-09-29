// Shop (marketplace) rules shared by the app's API (routes/shop.ts) and the admin console: settings, loading
// orders with their lines, status changes (with stock returned on cancellation) and the owner's live update.
import type { OrderStatus } from '@/models';
import { DEFAULT_CONFIG } from '@/constants/config';
import { nextOrderStatuses, orderStatusLabel } from '@/utils/shop';

import { type Db, query, tx } from './db';
import { E } from './errors';
import { emitTo } from './realtime';
import type { OrderItemRow, OrderRow } from './types';

/** Delivery fee (UGX) and pickup location, from system_config with the app's defaults. */
export async function shopSettings(db?: Db) {
  const sql = `SELECT key, value FROM system_config WHERE key IN ('delivery_fee', 'pickup_location')`;
  const rows = db ? (await db.query<{ key: string; value: string }>(sql)).rows : await query<{ key: string; value: string }>(sql);
  const get = (k: string) => rows.find((r) => r.key === k)?.value;
  const fee = Number(get('delivery_fee'));
  return {
    deliveryFee: Number.isFinite(fee) && fee >= 0 && get('delivery_fee') !== undefined ? fee : DEFAULT_CONFIG.deliveryFee,
    pickupLocation: get('pickup_location') || DEFAULT_CONFIG.pickupLocation,
  };
}

/** Orders matching `where` (a SQL condition on alias o) with their lines, newest first. */
export async function loadOrders(db: Db, where: string, params: unknown[], limit = 100) {
  const orders = (await db.query<OrderRow>(`SELECT o.* FROM orders o WHERE ${where} ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit}`, params)).rows;
  if (!orders.length) return [];
  const items = (
    await db.query<OrderItemRow>(
      `SELECT i.*, p.photos FROM order_items i LEFT JOIN products p ON p.id = i.product_id WHERE i.order_id = ANY($1::int[]) ORDER BY i.id`,
      [orders.map((o) => o.id)],
    )
  ).rows;
  return orders.map((o) => ({ order: o, items: items.filter((i) => i.order_id === o.id) }));
}

/** Puts an order's quantities back on the shelf (cancelled orders). */
async function restoreStock(db: Db, orderId: number) {
  await db.query(
    `UPDATE products p SET stock = p.stock + i.quantity, updated_at = now() FROM order_items i WHERE i.order_id = $1 AND i.product_id = p.id`,
    [orderId],
  );
}

/**
 * Moves an order to `next`, if that step is allowed from where it is. `by` decides the rules: the owner may only
 * cancel a "placed" order; staff follow nextOrderStatuses(). Cancelling returns the stock. The owner gets a live
 * update (or a push when the app is closed).
 */
export async function changeOrderStatus(orderId: number, next: OrderStatus, by: { owner: number } | 'staff') {
  const order = await tx(async (db) => {
    const o = (await db.query<OrderRow>(`SELECT * FROM orders WHERE id = $1 FOR UPDATE`, [orderId])).rows[0];
    if (!o || (by !== 'staff' && o.owner_id !== by.owner)) throw E.notFound('Order');
    const status = o.status as OrderStatus;
    const allowed = by === 'staff' ? nextOrderStatuses(status, o.fulfilment as 'delivery' | 'pickup') : status === 'placed' ? ['cancelled'] : [];
    if (!allowed.includes(next)) {
      throw E.conflict(
        'ORDER_STATE',
        by === 'staff' ? `An order that is "${orderStatusLabel(status)}" can't become "${orderStatusLabel(next)}".` : 'This order is already being prepared. Call MyCarRepair support to change it.',
      );
    }
    if (next === 'cancelled') await restoreStock(db, o.id);
    return (await db.query<OrderRow>(`UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [o.id, next])).rows[0]!;
  });
  if (by === 'staff') {
    const text: Partial<Record<OrderStatus, string>> = {
      confirmed: 'Your order is confirmed and being prepared.',
      out_for_delivery: 'Your order is on its way.',
      ready_for_pickup: 'Your order is ready for pickup.',
      delivered: 'Your order has been delivered. Thank you for shopping with MyCarRepair.',
      cancelled: 'Your order was cancelled. Call MyCarRepair support if you have questions.',
    };
    emitTo([order.owner_id], 'order_update', { orderId: order.id, status: next, summary: text[next] ?? orderStatusLabel(next) });
  }
  return order;
}
