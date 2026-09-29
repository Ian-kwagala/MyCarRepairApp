// Data model types shared by the whole app: users, vehicles, jobs, quotes, reviews, shop products and orders,
// config, notifications.
// Blueprint Appendix A.1 — mirrors the existing PostgreSQL tables 1:1 (camelCase over the wire).

/** Who a user is. Admins use the web dashboard, not this app. */
export type Role = 'owner' | 'mechanic' | 'admin';
/** New mechanics stay "pending" until an admin approves them. */
export type UserStatus = 'active' | 'pending' | 'suspended';
/**
 * Lifecycle of a job, in order: pending (waiting for a mechanic) → accepted → diagnosing → fixing →
 * ready → completed. A job can be cancelled instead of completing.
 */
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

/** A car owner or mechanic account. The garage/expertise fields are only set for mechanics. */
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

/** A car in an owner's garage. */
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

/** The mechanic's public details as attached to a job the owner can see. */
export type JobMechanic = Pick<User, 'id' | 'fullName' | 'phone' | 'garageName'> & {
  rating: number;
  // Revealed only to the counter-party of an accepted job (§13.1), for the live map.
  locationLat?: number | null;
  locationLng?: number | null;
};

/** The owner's details as attached to a job the mechanic can see. */
export type JobOwner = Pick<User, 'id' | 'fullName' | 'phone'> & {
  locationLat?: number | null;
  locationLng?: number | null;
};

/**
 * A repair job: either an SOS roadside request (`sosActive`) or a booked service. Optional fields are only
 * filled in by the endpoints noted beside them.
 */
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

/** One task on a job's checklist, ticked off by the mechanic (optionally with a photo). */
export interface ChecklistItem {
  // job_checklists
  id: number;
  jobId: number;
  taskDescription: string;
  isCompleted: boolean;
  photoUrl: string | null;
  completedAt: string | null;
}

/** A part the mechanic wants to fit, with a price the owner must approve or reject. */
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

/** An owner's 1–5 star rating of the mechanic after a completed job. */
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

/** Server-controlled settings (GET /config): fee, picker lists, maintenance mode, minimum app version. */
export interface AppConfig {
  serviceFee: number;
  sosIssues: string[];
  bookingServices: string[];
  diagnosticSymptoms: string[];
  maintenance: boolean;
  minAppVersion: string;
  supportPhone: string;
  /** Shop delivery fee in UGX, added to orders delivered to an address (pickup is free). */
  deliveryFee: number;
  /** Where shop orders are collected when the owner chooses pickup. */
  pickupLocation: string;
}

// ── Shop (marketplace): genuine spare parts and accessories sold by MyCarRepair ─────────────────────────────

/** Shop sections. */
export type ProductCategory = 'parts' | 'accessories' | 'tyres' | 'batteries' | 'fluids' | 'electronics';

/** A product in the shop. Prices are UGX; `stock` 0 means sold out. */
export interface Product {
  id: number;
  name: string;
  category: ProductCategory;
  brand: string | null;
  partNumber: string | null;
  description: string | null;
  /** Cars it fits, as free text, e.g. "Toyota Premio 2007–2016, Toyota Allion". Empty means universal. */
  compatibleWith: string | null;
  price: number;
  stock: number;
  warrantyMonths: number | null;
  photos: string[];
  createdAt: string;
}

/**
 * Order lifecycle: placed → confirmed → out_for_delivery (delivery) or ready_for_pickup (pickup) → delivered.
 * Placed orders can be cancelled by the owner; MyCarRepair can cancel any order that isn't delivered yet.
 */
export type OrderStatus = 'placed' | 'confirmed' | 'out_for_delivery' | 'ready_for_pickup' | 'delivered' | 'cancelled';
/** How an order reaches the owner. */
export type Fulfilment = 'delivery' | 'pickup';
/** Paid on delivery or at pickup: cash, or mobile money (MTN MoMo / Airtel Money). */
export type PaymentMethod = 'cash' | 'mobile_money';

/** One line of an order, with the name and price as they were when ordered. */
export interface OrderItem {
  productId: number | null;
  name: string;
  unitPrice: number;
  quantity: number;
  photo: string | null;
}

/** A shop order. Totals are computed by the server from its own prices. */
export interface Order {
  id: number;
  status: OrderStatus;
  fulfilment: Fulfilment;
  paymentMethod: PaymentMethod;
  deliveryAddress: string | null;
  contactPhone: string;
  note: string | null;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  createdAt: string;
  updatedAt: string;
}

/** Summary numbers on the mechanic's dashboard. */
export interface MechanicStats {
  totalJobs: number;
  activeJobs: number;
  rating: number;
}

/** A mechanic's earnings: totals, a per-day series for the chart, and the list of paid jobs. */
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

/** Names of the live events the server pushes to the app (over sockets, or the local event bus). */
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
  | 'mechanic_approved'
  | 'order_update';

/** Data that comes with a realtime event; which fields are set depends on the event. */
export interface RealtimePayload {
  jobId?: number;
  quoteId?: number;
  orderId?: number;
  lat?: number;
  lng?: number;
  [key: string]: unknown;
}

/** An entry in the in-app notification list, stored on the device per user. */
export interface AppNotification {
  id: string;
  userId: number;
  event: RealtimeEvent;
  title: string;
  body: string;
  jobId?: number;
  quoteId?: number;
  orderId?: number;
  createdAt: string;
  read: boolean;
}
