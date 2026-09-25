// Contracts for the data layer: request/response shapes and the ApiClient and RealtimeClient interfaces.
// Both the local store (local/client.ts) and the backend client (remote/client.ts) implement these, so
// screens work the same against either.
import type {
  AppConfig,
  ChecklistItem,
  Earnings,
  FuelType,
  Job,
  LocalPhoto,
  MechanicStats,
  PartsQuote,
  RealtimeEvent,
  RealtimePayload,
  Review,
  Role,
  Transmission,
  User,
  Vehicle,
} from '@/models';

/** The signed-in user and their tokens (tokens are null in local mode). */
export interface Session {
  user: User;
  accessToken: string | null;
  refreshToken: string | null;
}

/** Sign-up form data. Garage fields are only sent for mechanics. */
export interface RegisterInput {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  role: Exclude<Role, 'admin'>;
  garageName?: string;
  garageLocation?: string;
  expertise?: string;
}

/** Sign-in form data; `role` must match the account's role. */
export interface LoginInput {
  identifier: string; // email or phone
  password: string;
  role: Exclude<Role, 'admin'>;
}

/** Fields a user can change on their own profile; omitted fields are left as they are. */
export interface ProfilePatch {
  fullName?: string;
  phone?: string;
  garageName?: string | null;
  garageLocation?: string | null;
  expertise?: string | null;
}

/** Vehicle details from the add/edit vehicle form. */
export interface VehicleInput {
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
}

/** A new vehicle plus the photos to upload with it. */
export interface VehicleCreate extends VehicleInput {
  photos: LocalPhoto[];
}

/** Changes to an existing vehicle. */
export interface VehicleUpdate extends Partial<VehicleInput> {
  /** Existing photo URLs to keep (in order). */
  keepPhotos?: string[];
  /** New photos to upload. */
  newPhotos?: LocalPhoto[];
}

/** An owner booking a service for a future date. */
export interface BookingInput {
  vehicleId: number;
  serviceType: string;
  scheduledDate: string; // YYYY-MM-DD
  notes?: string;
}

/** An owner asking for a diagnosis from a list of symptoms, with an optional photo. */
export interface DiagnosticInput {
  vehicleId: number;
  symptoms: string[];
  notes?: string;
  photo?: LocalPhoto | null;
}

/** An emergency roadside request, sent with the owner's current GPS position. */
export interface SosInput {
  vehicleId: number;
  issue: string;
  lat: number;
  lng: number;
}

/** What the server replies after an SOS: the new job and how many mechanics were alerted. */
export interface SosResult {
  jobId: number;
  status: 'pending';
  nearbyCount: number;
  eta: string;
}

/** Which of the owner's jobs to list: in progress, or finished/cancelled. */
export type JobScope = 'active' | 'history';
/** Which list the mechanic's job board shows. */
export type MechanicTab = 'sos' | 'bookings' | 'active' | 'history';
/** Period shown on the mechanic's earnings screen. */
export type EarningsRange = 'day' | 'week' | 'month';

/** An owner's review of a finished job. */
export interface ReviewInput {
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string | null;
  tags?: string[];
}

/** A mechanic's parts quote, with photo evidence of the part. */
export interface QuoteInput {
  partName: string;
  price: number;
  photos: LocalPhoto[];
}

/** A review as shown on the mechanic's reviews screen, with who left it and for what job. */
export interface MechanicReview extends Review {
  ownerName: string;
  serviceType: string;
}

/** How the user must prove who they are before resetting their password. */
export interface ForgotPasswordResult {
  /** 'otp' — a one-time code; 'phone' — confirm the registered phone number (local mode). */
  verification: 'otp' | 'phone';
  /** Where the code comes from: 'sms' (sent to destination) or 'support' (read out by support after an ID check). */
  channel?: 'sms' | 'support';
  destination?: string;
}

/** The mobile API client — one method per §7 endpoint. */
export interface ApiClient {
  readonly mode: 'local' | 'remote';

  /** Sets the bearer tokens used for every request (null when signed out). */
  setAuth(tokens: Pick<Session, 'accessToken' | 'refreshToken'> | null): void;
  /** Called when tokens are refreshed (store them) or rejected (sign out). */
  onTokensChanged(cb: (tokens: Pick<Session, 'accessToken' | 'refreshToken'> | null) => void): void;

  // Auth & account
  register(input: RegisterInput): Promise<Session>;
  login(input: LoginInput): Promise<Session>;
  logout(pushToken?: string | null): Promise<void>;
  forgotPassword(identifier: string): Promise<ForgotPasswordResult>;
  resetPassword(input: { identifier: string; code: string; password: string }): Promise<void>;
  me(): Promise<User>;
  updateMe(patch: ProfilePatch): Promise<User>;
  updateLocation(input: { lat: number; lng: number; accuracy?: number | null }): Promise<void>;
  registerPushToken(token: string, platform: string): Promise<void>;
  getConfig(): Promise<AppConfig>;

  // Vehicles (owner)
  listVehicles(): Promise<Vehicle[]>;
  getVehicle(id: number): Promise<{ vehicle: Vehicle; recentJobs: Job[] }>;
  createVehicle(input: VehicleCreate): Promise<Vehicle>;
  updateVehicle(id: number, patch: VehicleUpdate): Promise<Vehicle>;
  deleteVehicle(id: number): Promise<void>;

  // Jobs (owner)
  createBooking(input: BookingInput): Promise<Job>;
  createDiagnostic(input: DiagnosticInput): Promise<Job>;
  sendSos(input: SosInput): Promise<SosResult>;
  cancelSos(jobId: number): Promise<void>;
  listJobs(scope: JobScope): Promise<Job[]>;
  getJob(id: number): Promise<Job>;
  decideQuote(quoteId: number, decision: 'approve' | 'reject'): Promise<PartsQuote>;
  getReceipt(jobId: number): Promise<{ url: string }>;
  submitReview(jobId: number, input: ReviewInput): Promise<Review>;

  // Mechanic
  setOnline(isOnline: boolean): Promise<User>;
  listMechanicJobs(tab: MechanicTab, coords?: { lat: number; lng: number } | null): Promise<Job[]>;
  mechanicStats(): Promise<MechanicStats>;
  acceptJob(jobId: number): Promise<Job>;
  declineJob(jobId: number): Promise<void>;
  markArrived(jobId: number): Promise<Job>;
  updateTask(taskId: number, input: { isCompleted: boolean; photo?: LocalPhoto | null }): Promise<ChecklistItem>;
  createQuote(jobId: number, input: QuoteInput): Promise<PartsQuote>;
  completeJob(jobId: number): Promise<Job>;
  earnings(range: EarningsRange): Promise<Earnings>;
  myReviews(): Promise<{ reviews: MechanicReview[]; average: number; count: number }>;
}

/** Callback for one realtime event. */
export type RealtimeHandler = (payload: RealtimePayload) => void;

/** Live event connection for the signed-in user. */
export interface RealtimeClient {
  /** Starts receiving the given user's events (replaces any previous connection). */
  connect(session: Session): void;
  /** Stops receiving events, e.g. on sign-out. */
  disconnect(): void;
  /** Subscribes to one event; returns an unsubscribe function. */
  on(event: RealtimeEvent, handler: RealtimeHandler): () => void;
  /** Subscribes to every event; returns an unsubscribe function. */
  onAny(handler: (event: RealtimeEvent, payload: RealtimePayload) => void): () => void;
}
