// The product form shared by the /admin console (MyCarRepair's own products and checking seller listings) and the
// /seller portal (a seller's own listings): the HTML form, its validation, and which existing photos to keep.
import type { Request } from 'express';
import { z } from 'zod';

import { MAX_PHOTOS, PRODUCT_CATEGORIES } from '@/constants/config';

import { mediaSrc, str } from './admin/common';
import { esc } from './admin/ui';
import type { ProductRow } from './types';

const CATEGORY_KEYS = PRODUCT_CATEGORIES.map((c) => c.key) as string[];

/** A CSV photo column as a list of "media/<key>" paths. */
export const splitCsv = (csv: string | null) =>
  (csv ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

/** The product form's fields, as the strings the browser posts. */
export type ProductForm = Record<'name' | 'category' | 'brand' | 'part_number' | 'price' | 'stock' | 'warranty_months' | 'compatible_with' | 'description', string>;

/** Form values for a product (empty for a new one). */
export const productToForm = (r?: ProductRow): ProductForm => ({
  name: r?.name ?? '',
  category: r?.category ?? 'parts',
  brand: r?.brand ?? '',
  part_number: r?.part_number ?? '',
  price: r ? String(Math.round(Number(r.price))) : '',
  stock: r ? String(r.stock) : '',
  warranty_months: r?.warranty_months != null ? String(r.warranty_months) : '',
  compatible_with: r?.compatible_with ?? '',
  description: r?.description ?? '',
});

/**
 * The product form (add or edit), posting to `action`. `photos` are the product's current photo paths (each with a
 * Keep box); `error` is shown above the form; `note` is a line under the Save button (e.g. that edits are checked).
 */
export function productForm(action: string, f: ProductForm, photos: string[], error?: string, note?: string) {
  const input = (name: keyof ProductForm, label: string, extra = '', hint = '') =>
    `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" value="${esc(f[name])}" ${extra}>${hint ? `<span class="hint">${hint}</span>` : ''}</div>`;
  const options = PRODUCT_CATEGORIES.map((c) => `<option value="${c.key}"${f.category === c.key ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
  const existing = photos.length
    ? `<div class="field wide"><label>Current photos</label><div class="thumbs">${photos
        .map((ph) => `<label><img src="${esc(mediaSrc(ph) ?? '')}" alt=""><span><input type="checkbox" name="keep" value="${esc(ph)}" checked> Keep</span></label>`)
        .join('')}</div><span class="hint">Untick a photo to remove it when you save.</span></div>`
    : '';
  return `${error ? `<div class="form-error" role="alert">${esc(error)}</div>` : ''}
<section class="card"><div class="card-b"><form method="post" action="${esc(action)}" enctype="multipart/form-data"><div class="form-grid">
${input('name', 'Product name', 'required maxlength="120" placeholder="Brake pads (front) – Toyota Premio"')}
<div class="field"><label for="category">Section</label><select id="category" name="category">${options}</select></div>
${input('brand', 'Brand', 'maxlength="60" placeholder="Toyota Genuine, Bosch, Denso…"')}
${input('part_number', 'Part number', 'maxlength="60" placeholder="04465-12592"')}
${input('price', 'Price (UGX)', 'required inputmode="numeric" placeholder="85000"')}
${input('stock', 'Units in stock', 'required inputmode="numeric" placeholder="10"', 'At 0 the product shows as sold out.')}
${input('warranty_months', 'Warranty (months)', 'inputmode="numeric" placeholder="6"', 'Leave empty for no warranty.')}
${input('compatible_with', 'Fits these cars', 'maxlength="300" placeholder="Toyota Premio 2007–2016, Toyota Allion"', 'Owners filter by their car’s make or model. Leave empty if it fits any car.')}
<div class="field wide"><label for="description">Description</label><textarea id="description" name="description" maxlength="2000" placeholder="What it is, what’s in the box, why it’s genuine.">${esc(f.description)}</textarea></div>
${existing}
<div class="field wide"><label for="photos">Add photos</label><input id="photos" type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple>
<span class="hint">JPEG, PNG or WebP, up to 5 MB each, ${MAX_PHOTOS} photos in total. Clear photos of the actual item sell best.</span></div>
</div><button class="btn primary">Save product</button>${note ? `<p class="hint" style="margin:10px 0 0">${esc(note)}</p>` : ''}</form></div></section>`;
}

const productSchema = z.object({
  name: z.string().trim().min(2, 'Enter the product name.').max(120),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
  brand: z.string().trim().max(60),
  part_number: z.string().trim().max(60),
  price: z
    .string()
    .transform((v) => v.replace(/[,\s]/g, ''))
    .pipe(z.string().regex(/^\d{1,9}$/, 'Enter the price in whole shillings, for example 85000.'))
    .transform(Number),
  stock: z
    .string()
    .trim()
    .regex(/^\d{1,6}$/, 'Enter how many units are in stock (0 or more).')
    .transform(Number),
  warranty_months: z
    .string()
    .trim()
    .regex(/^(\d{1,3})?$/, 'Enter the warranty in months, or leave it empty.')
    .transform((v) => (v ? Number(v) : null)),
  compatible_with: z.string().trim().max(300),
  description: z.string().trim().max(2000),
});

/** Validates the form; returns the parsed values or the first error message. */
export function parseProduct(req: Request) {
  const raw = Object.fromEntries(Object.keys(productToForm()).map((k) => [k, str(req.body?.[k])])) as ProductForm;
  const parsed = productSchema.safeParse(raw);
  return { raw, parsed: parsed.success ? parsed.data : null, error: parsed.success ? undefined : parsed.error.issues[0]?.message };
}

/** Photos to keep (only paths the product really has) plus the new uploads, capped at MAX_PHOTOS. */
export function keptPhotos(req: Request, current: string[]) {
  const keep = ([] as unknown[]).concat(req.body?.keep ?? []).map(String);
  return current.filter((p) => keep.includes(p));
}
