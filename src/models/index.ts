// Blueprint Appendix A.1 — mirrors the existing PostgreSQL tables 1:1 (camelCase over the wire).
export type Role = 'owner' | 'mechanic' | 'admin';
export type UserStatus = 'active' | 'pending' | 'suspended';
export type JobStatus =
  | 'pending'
  | 'accepted'
  | 'diagnosing'
  | 'fixing'
  | 'ready'
  | 'completed'
  | 'cancelled';
export type FuelType = 'Petrol' | 'Diesel' | 'Hybrid' | 'Electric';
export type Transmission = 'Automatic' | 'Manual';

export interface User {
  // users
  id: number;
  fullName: string;
  email: string;
  phone: string | null;
  role: Role;
  status: UserStatus;
  isOnline: boolean;
  locationLat: number | null;
  locationLng: number | null;
  garageName?: string | null;
  garageLocation?: string | null;
  expertise?: string | null;
  createdAt: string;
}

export interface Vehicle {
  // vehicles
  id: number;
  ownerId: number;
  make: string;
  model: string;
  year: number;
  plateNumber: string;
  fuelType: FuelType;
  transmission: Transmission;
  tyreSize: string | null;
  color: string | null;
  mileage: number | null;
  lastServiceDate: string | null;
  photos: string[]; // API splits the comma-separated "photos" column
  createdAt: string;
}

export type JobMechanic = Pick<User, 'id' | 'fullName' | 'phone' | 'garageName'> & {
  rating: number;
  // Revealed only to the counter-party of an accepted job (§13.1), for the live map.
  locationLat?: number | null;
  locationLng?: number | null;
};

export type JobOwner = Pick<User, 'id' | 'fullName' | 'phone'> & {
  locationLat?: number | null;
  locationLng?: number | null;
};

export interface Job {
  // jobs
  id: number;
  ownerId: number;
  mechanicId: number | null;
  vehicleId: number;
  serviceType: string;
  status: JobStatus;
  totalPrice: number;
  sosActive: boolean;
  createdAt: string;
  updatedAt: string;
  // expanded on GET /jobs/:id
  vehicle?: Vehicle;
  mechanic?: JobMechanic;
  checklist?: ChecklistItem[];
  quotes?: PartsQuote[];
  totals?: { serviceFee: number; approvedParts: number; total: number };
  // expanded on mechanic lists / job card
  owner?: JobOwner;
  distanceKm?: number | null;
  // expanded on owner lists
  review?: Review | null;
  // Request-only booking fields (POST /jobs/bookings). The jobs table has no column for these —
  // see README "Open questions".
  scheduledDate?: string | null;
  notes?: string | null;
}

export interface ChecklistItem {
  // job_checklists
  id: number;
  jobId: number;
  taskDescription: string;
  isCompleted: boolean;
  photoUrl: string | null;
  completedAt: string | null;
}

export interface PartsQuote {
  // parts_quotes
  id: number;
  jobId: number;
  partName: string;
  price: number;
  photos: string[]; // from photo_evidence
  isApproved: boolean | null; // null = awaiting owner
  createdAt: string;
}

export interface Review {
  // reviews
  id: number;
  jobId: number;
  mechanicId: number;
  ownerId: number;
  rating: 1 | 2 | 3 | 4 | 5;
  feedback: string | null;
  createdAt: string;
}

export interface AppConfig {
  serviceFee: number;
  sosIssues: string[];
  bookingServices: string[];
  diagnosticSymptoms: string[];
  maintenance: boolean;
  minAppVersion: string;
  supportPhone: string;
}

export interface MechanicStats {
  totalJobs: number;
  activeJobs: number;
  rating: number;
}

export interface Earnings {
  total: number;
  today: number;
  jobs: number;
  series: { label: string; date: string; amount: number }[];
  payouts: { jobId: number; serviceType: string; vehicle: string; amount: number; date: string }[];
}

/** A locally picked photo, before upload. */
export interface LocalPhoto {
  uri: string;
  name: string;
  type: string;
}

export type RealtimeEvent =
  | 'new_job_pushed'
  | 'job_unavailable'
  | 'job_taken'
  | 'mechanic_location'
  | 'job_progress_update'
  | 'task_update'
  | 'new_quote_alert'
  | 'quote_updated'
  | 'appointment_update'
  | 'job_finished'
  | 'mechanic_approved';

export interface RealtimePayload {
  jobId?: number;
  quoteId?: number;
  lat?: number;
  lng?: number;
  [key: string]: unknown;
}

export interface AppNotification {
  id: string;
  userId: number;
  event: RealtimeEvent;
  title: string;
  body: string;
  jobId?: number;
  quoteId?: number;
  createdAt: string;
  read: boolean;
}
