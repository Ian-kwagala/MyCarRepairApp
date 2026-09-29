// The shop cart, saved on the phone per account so it survives restarts. Lines keep the name, price and photo seen
// when added, for display only: checkout sends just product ids and quantities, and the server prices the order.
import { create } from 'zustand';

import { MAX_ORDER_QUANTITY } from '@/constants/config';
import type { Product } from '@/models';
import { Keys, kv } from '@/services/storage';

/** One cart line. */
export interface CartLine {
  productId: number;
  name: string;
  price: number;
  photo: string | null;
  quantity: number;
  /** Stock when added or last refreshed, to cap the quantity stepper. */
  stock: number;
}

interface CartState {
  userId: number | null;
  lines: CartLine[];
  /** Loads the saved cart for this account (call when the shop opens; cheap if already loaded). */
  load: (userId: number) => Promise<void>;
  /** Adds `quantity` of a product (merging with an existing line, capped by stock and the per-order limit). */
  add: (product: Product, quantity: number) => void;
  /** Sets a line's quantity; 0 removes it. */
  setQuantity: (productId: number, quantity: number) => void;
  /** Updates prices, names and stock from fresh product data (sold-out lines stay, so the owner sees why). */
  refresh: (products: Product[]) => void;
  /** Empties the cart (after a successful order). */
  clear: () => void;
}

const cap = (quantity: number, stock: number) => Math.max(0, Math.min(quantity, stock, MAX_ORDER_QUANTITY));

/** The shop cart for the signed-in owner. */
export const useCart = create<CartState>((set, get) => {
  // The account whose cart is being read from storage right now, if any.
  let loadingFor: number | null = null;
  const save = (lines: CartLine[]) => {
    const { userId } = get();
    set({ lines });
    if (userId != null) void kv.set(Keys.cart(userId), lines);
  };
  return {
    userId: null,
    lines: [],
    load: async (userId) => {
      if (get().userId === userId || loadingFor === userId) return;
      loadingFor = userId;
      // userId stays null until the saved cart is read, so nothing done meanwhile (e.g. a price refresh) can
      // overwrite the saved cart with an empty one.
      set({ userId: null, lines: [] });
      const saved = await kv.get<CartLine[]>(Keys.cart(userId), []);
      // Another account may have signed in while this was loading.
      if (loadingFor !== userId) return;
      loadingFor = null;
      set({ userId, lines: Array.isArray(saved) ? saved : [] });
    },
    add: (product, quantity) => {
      const lines = get().lines;
      const existing = lines.find((l) => l.productId === product.id);
      const nextQty = cap((existing?.quantity ?? 0) + quantity, product.stock);
      if (nextQty <= 0) return;
      const line: CartLine = { productId: product.id, name: product.name, price: product.price, photo: product.photos[0] ?? null, quantity: nextQty, stock: product.stock };
      save(existing ? lines.map((l) => (l.productId === product.id ? line : l)) : [...lines, line]);
    },
    setQuantity: (productId, quantity) => {
      const lines = get().lines;
      save(quantity <= 0 ? lines.filter((l) => l.productId !== productId) : lines.map((l) => (l.productId === productId ? { ...l, quantity: cap(quantity, l.stock) || 1 } : l)));
    },
    refresh: (products) => {
      if (!get().lines.length) return;
      const byId = new Map(products.map((p) => [p.id, p]));
      save(
        get().lines.map((l) => {
          const p = byId.get(l.productId);
          return p ? { ...l, name: p.name, price: p.price, photo: p.photos[0] ?? l.photo, stock: p.stock } : l;
        }),
      );
    },
    clear: () => save([]),
  };
});

/** Number of items in the cart (for the tab badge). */
export const useCartCount = () => useCart((s) => s.lines.reduce((n, l) => n + l.quantity, 0));
