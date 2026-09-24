// Column → API field mapping rules (§5.1): snake_case → camelCase, CSV → string[], password never returned.
import type { ChecklistItem, FuelType, Job, PartsQuote, Review, Transmission, User, Vehicle } from '@/models';

import { splitPaths, type ChecklistRow, type JobRow, type QuoteRow, type ReviewRow, type UserRow, type VehicleRow } from './db';

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
    createdAt: r.created_at,
  };
  if (r.role === 'mechanic') {
    u.garageName = r.garage_name;
    u.garageLocation = r.garage_location;
    u.expertise = r.expertise;
  }
  return u;
}

export function toVehicle(r: VehicleRow): Vehicle {
  return {
    id: r.id,
    ownerId: r.owner_id,
    make: r.make,
    model: r.model,
    year: r.year,
    plateNumber: r.plate_number,
    fuelType: r.fuel_type as FuelType,
    transmission: r.transmission as Transmission,
    tyreSize: r.tyre_size,
    color: r.color,
    mileage: r.mileage,
    lastServiceDate: r.last_service_date,
    photos: splitPaths(r.photos),
    createdAt: r.created_at,
  };
}

export function toJob(r: JobRow): Job {
  return {
    id: r.id,
    ownerId: r.owner_id,
    mechanicId: r.mechanic_id,
    vehicleId: r.vehicle_id,
    serviceType: r.service_type,
    status: r.status,
    totalPrice: Number(r.total_price),
    sosActive: r.sos_active,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function toChecklistItem(r: ChecklistRow): ChecklistItem {
  return {
    id: r.id,
    jobId: r.job_id,
    taskDescription: r.task_description,
    isCompleted: r.is_completed,
    photoUrl: r.photo_url,
    completedAt: r.completed_at,
  };
}

export function toQuote(r: QuoteRow): PartsQuote {
  return {
    id: r.id,
    jobId: r.job_id,
    partName: r.part_name,
    price: Number(r.price),
    photos: splitPaths(r.photo_evidence),
    isApproved: r.is_approved,
    createdAt: r.created_at,
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
    createdAt: r.created_at,
  };
}
