// Shop (marketplace) helpers shared by the app and the server: order totals, status wording and the steps an
// order goes through. The server computes the totals that are actually charged with these same functions.
import { PRODUCT_CATEGORIES } from '@/constants/config';
import type { Fulfilment, OrderStatus, ProductCategory } from '@/models';

import type { Tone } from './jobs';

/** Subtotal, delivery fee and total for some lines; pickup orders pay no delivery fee. */
export function orderTotals(lines: readonly { unitPrice: number; quantity: number }[], fulfilment: Fulfilment, deliveryFee: number) {
  const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0);
  const fee = fulfilment === 'delivery' && lines.length ? deliveryFee : 0;
  return { subtotal, deliveryFee: fee, total: subtotal + fee };
}

/** Label for a shop section key ("parts" → "Spare parts"). */
export function categoryLabel(key: ProductCategory | string): string {
  return PRODUCT_CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

const STATUS: Record<OrderStatus, [string, Tone]> = {
  placed: ['Order placed', 'warning'],
  confirmed: ['Confirmed', 'info'],
  out_for_delivery: ['On the way', 'info'],
  ready_for_pickup: ['Ready for pickup', 'info'],
  delivered: ['Delivered', 'success'],
  cancelled: ['Cancelled', 'neutral'],
};

/** Plain-language status for an order. */
export function orderStatusLabel(s: OrderStatus): string {
  return STATUS[s]?.[0] ?? s;
}

/** Colour tone for an order status pill. */
export function orderStatusTone(s: OrderStatus): Tone {
  return STATUS[s]?.[1] ?? 'neutral';
}

/** The steps an order goes through, for its progress timeline (the middle step depends on delivery or pickup). */
export function orderSteps(fulfilment: Fulfilment): OrderStatus[] {
  return ['placed', 'confirmed', fulfilment === 'delivery' ? 'out_for_delivery' : 'ready_for_pickup', 'delivered'];
}

/**
 * Which status changes MyCarRepair staff may make next (the admin console offers exactly these). Owners can only
 * cancel while an order is still "placed".
 */
export function nextOrderStatuses(status: OrderStatus, fulfilment: Fulfilment): OrderStatus[] {
  switch (status) {
    case 'placed':
      return ['confirmed', 'cancelled'];
    case 'confirmed':
      return [fulfilment === 'delivery' ? 'out_for_delivery' : 'ready_for_pickup', 'cancelled'];
    case 'out_for_delivery':
    case 'ready_for_pickup':
      return ['delivered', 'cancelled'];
    default:
      return [];
  }
}
