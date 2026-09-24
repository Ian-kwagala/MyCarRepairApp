import { Router } from 'express';
import { z } from 'zod';

import { MAX_PHOTOS } from '@/constants/config';

import { me, requireAuth, requireRole } from '../auth';
import { pool, query, tx } from '../db';
import { E } from '../errors';
import { expandAll } from '../jobs';
import { toMediaPath, toVehicle } from '../mappers';
import { baseUrl, filesOf, storeFiles, upload } from '../media';
import type { JobRow, VehicleRow } from '../types';

export const vehiclesRouter = Router();
vehiclesRouter.use(requireAuth, requireRole('owner'));

const year = new Date().getFullYear();
// Multipart fields arrive as strings; '' means "clear" for optional fields.
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => (v === undefined ? undefined : v || null));
const vehicleFields = z.object({
  make: z.string().trim().min(1, 'Enter the make.').max(50),
  model: z.string().trim().min(1, 'Enter the model.').max(50),
  year: z.coerce.number().int().min(1950, 'Enter a valid year.').max(year + 1, 'Enter a valid year.'),
  plateNumber: z.string().trim().min(2, 'Enter the plate number.').max(20).transform((s) => s.toUpperCase()),
  fuelType: z.enum(['Petrol', 'Diesel', 'Hybrid', 'Electric']),
  transmission: z.enum(['Automatic', 'Manual']),
  tyreSize: opt(20),
  color: opt(30),
  mileage: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v === '' ? null : Number(v)))
    .refine((v) => v === undefined || v === null || (Number.isInteger(v) && v >= 0), 'Mileage must be a whole number.'),
  lastServiceDate: z
    .string()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null))
    .refine((v) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use YYYY-MM-DD for the last service date.'),
});

vehiclesRouter.get('/', async (req, res) => {
  const rows = await query<VehicleRow>(`SELECT * FROM vehicles WHERE owner_id = $1 ORDER BY id`, [me(req).id]);
  res.json(rows.map((r) => toVehicle(baseUrl(req), r)));
});

vehiclesRouter.get('/:id', async (req, res) => {
  const u = me(req);
  const v = (await query<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2`, [Number(req.params.id), u.id]))[0];
  if (!v) throw E.notFound('Vehicle');
  const jobs = await query<JobRow>(`SELECT * FROM jobs WHERE vehicle_id = $1 ORDER BY created_at DESC LIMIT 5`, [v.id]);
  res.json({ vehicle: toVehicle(baseUrl(req), v), recentJobs: await expandAll(pool, baseUrl(req), jobs, u) });
});

vehiclesRouter.post('/', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const u = me(req);
  const b = vehicleFields.parse(req.body);
  const row = await tx(async (db) => {
    const photos = await storeFiles(db, u.id, filesOf(req, 'photos'));
    return (
      await db.query<VehicleRow>(
        `INSERT INTO vehicles (owner_id, make, model, year, plate_number, fuel_type, transmission, tyre_size, color, mileage, last_service_date, photos)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
        [u.id, b.make, b.model, b.year, b.plateNumber, b.fuelType, b.transmission, b.tyreSize ?? null, b.color ?? null, b.mileage ?? null, b.lastServiceDate ?? null, photos.join(',') || null],
      )
    ).rows[0];
  });
  res.status(201).json(toVehicle(baseUrl(req), row));
});

vehiclesRouter.patch('/:id', upload.array('photos', MAX_PHOTOS), async (req, res) => {
  const u = me(req);
  const b = vehicleFields.partial().parse(req.body);
  const keep = req.body?.keepPhotos !== undefined ? z.array(z.string()).parse(JSON.parse(String(req.body.keepPhotos))) : undefined;
  const row = await tx(async (db) => {
    const v = (await db.query<VehicleRow>(`SELECT * FROM vehicles WHERE id = $1 AND owner_id = $2 FOR UPDATE`, [Number(req.params.id), u.id])).rows[0];
    if (!v) throw E.notFound('Vehicle');
    const added = await storeFiles(db, u.id, filesOf(req, 'photos'));
    let photos = v.photos;
    if (keep !== undefined || added.length) {
      const current = (v.photos ?? '').split(',').filter(Boolean);
      // Only photos that already belong to this vehicle can be kept.
      const kept = keep === undefined ? current : keep.map(toMediaPath).filter((p): p is string => !!p && current.includes(p));
      const all = [...kept, ...added];
      if (all.length > MAX_PHOTOS) throw E.validation(`Up to ${MAX_PHOTOS} photos.`);
      photos = all.join(',') || null;
    }
    return (
      await db.query<VehicleRow>(
        `UPDATE vehicles SET make = COALESCE($2, make), model = COALESCE($3, model), year = COALESCE($4, year),
           plate_number = COALESCE($5, plate_number), fuel_type = COALESCE($6, fuel_type), transmission = COALESCE($7, transmission),
           tyre_size = CASE WHEN $8 THEN $9 ELSE tyre_size END, color = CASE WHEN $10 THEN $11 ELSE color END,
           mileage = CASE WHEN $12 THEN $13::int ELSE mileage END, last_service_date = CASE WHEN $14 THEN $15::date ELSE last_service_date END,
           photos = $16
         WHERE id = $1 RETURNING *`,
        [
          v.id,
          b.make ?? null,
          b.model ?? null,
          b.year ?? null,
          b.plateNumber ?? null,
          b.fuelType ?? null,
          b.transmission ?? null,
          b.tyreSize !== undefined,
          b.tyreSize ?? null,
          b.color !== undefined,
          b.color ?? null,
          b.mileage !== undefined,
          b.mileage ?? null,
          b.lastServiceDate !== undefined,
          b.lastServiceDate ?? null,
          photos,
        ],
      )
    ).rows[0];
  });
  res.json(toVehicle(baseUrl(req), row));
});

vehiclesRouter.delete('/:id', async (req, res) => {
  const u = me(req);
  await tx(async (db) => {
    const v = (await db.query(`SELECT id FROM vehicles WHERE id = $1 AND owner_id = $2`, [Number(req.params.id), u.id])).rows[0];
    if (!v) throw E.notFound('Vehicle');
    const active = await db.query(`SELECT 1 FROM jobs WHERE vehicle_id = $1 AND status NOT IN ('completed', 'cancelled') LIMIT 1`, [v.id]);
    if (active.rowCount) throw E.conflict('VEHICLE_IN_USE', 'This car has an active job. Finish or cancel it first.');
    await db.query(`DELETE FROM vehicles WHERE id = $1`, [v.id]);
  });
  res.status(204).end();
});
