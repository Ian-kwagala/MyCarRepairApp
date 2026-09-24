// Column → API field mapping rules (§5.1): snake_case → camelCase, CSV photo columns → absolute URL arrays,
// DECIMAL → number, TIMESTAMP → ISO-8601, password never returned, tri-state is_approved kept.
import type { ChecklistItem, Job, PartsQuote, Review, User, Vehicle } from '@/models';

import type { ChecklistRow, JobRow, QuoteRow, ReviewRow, UserRow, VehicleRow } from './types';

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Media paths are stored as "media/<key>"; the API returns absolute URLs. */
export function mediaUrl(base: string, path: string | null): string | null {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${base}/${path.replace(/^\/+/, '')}`;
}

export function splitPhotos(base: string, csv: string | null): string[] {
  return (csv ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => mediaUrl(base, p)!);
}

/** Converts absolute media URLs the client sends back ("keep these photos") into stored paths. */
export function toMediaPath(url: string): string | null {
  const m = url.match(/(?:^|\/)(media\/[A-Za-z0-9._-]+)$/);
  return m ? m[1] : null;
}

export function toUser(r: UserRow): User {
  const u: User = {
    id: r.id,
    fullName: r.full_name,
    email: r.email,
    phone: r.phone,
    role: r.role,
    status: r.status,
    isOnline: r.is_online,
    locationLat: r.location_lat,
    locationLng: r.location_lng,
    createdAt: r.created_at.toISOString(),
  };
  if (r.role === 'mechanic') {
    u.garageName = r.garage_name;
    u.garageLocation = r.garage_location;
    u.expertise = r.expertise;
  }
  return u;
}

export function toVehicle(base: string, r: VehicleRow): Vehicle {
  return {
    id: r.id,
    ownerId: r.owner_id,
    make: r.make,
    model: r.model,
    year: r.year,
    plateNumber: r.plate_number,
    fuelType: (r.fuel_type ?? 'Petrol') as Vehicle['fuelType'],
    transmission: (r.transmission ?? 'Automatic') as Vehicle['transmission'],
    tyreSize: r.tyre_size,
    color: r.color,
    mileage: r.mileage,
    lastServiceDate: r.last_service_date,
    photos: splitPhotos(base, r.photos),
    createdAt: r.created_at.toISOString(),
  };
}

export function toJob(r: JobRow): Job {
  return {
    id: r.id,
    ownerId: r.owner_id,
    mechanicId: r.mechanic_id,
    vehicleId: r.vehicle_id ?? 0,
    serviceType: r.service_type,
    status: r.status,
    totalPrice: Number(r.total_price),
    sosActive: r.sos_active,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export function toChecklistItem(base: string, r: ChecklistRow): ChecklistItem {
  return {
    id: r.id,
    jobId: r.job_id,
    taskDescription: r.task_description,
    isCompleted: r.is_completed,
    photoUrl: mediaUrl(base, r.photo_url),
    completedAt: iso(r.completed_at),
  };
}

export function toQuote(base: string, r: QuoteRow): PartsQuote {
  return {
    id: r.id,
    jobId: r.job_id,
    partName: r.part_name,
    price: Number(r.price),
    photos: splitPhotos(base, r.photo_evidence),
    isApproved: r.is_approved,
    createdAt: r.created_at.toISOString(),
  };
}

export function toReview(r: ReviewRow): Review {
  return {
    id: r.id,
    jobId: r.job_id,
    mechanicId: r.mechanic_id,
    ownerId: r.owner_id,
    rating: Math.min(5, Math.max(1, r.rating)) as Review['rating'],
    feedback: r.feedback,
    createdAt: r.created_at.toISOString(),
  };
}
