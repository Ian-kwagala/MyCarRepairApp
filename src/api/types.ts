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

export interface Session {
  user: User;
  accessToken: string | null;
  refreshToken: string | null;
}

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

export interface LoginInput {
  identifier: string; // email or phone
  password: string;
  role: Exclude<Role, 'admin'>;
}

export interface ProfilePatch {
  fullName?: string;
  phone?: string;
  garageName?: string | null;
  garageLocation?: string | null;
  expertise?: string | null;
}

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

export interface VehicleCreate extends VehicleInput {
  photos: LocalPhoto[];
}

export interface VehicleUpdate extends Partial<VehicleInput> {
  /** Existing photo URLs to keep (in order). */
  keepPhotos?: string[];
  /** New photos to upload. */
  newPhotos?: LocalPhoto[];
}

export interface BookingInput {
  vehicleId: number;
  serviceType: string;
  scheduledDate: string; // YYYY-MM-DD
  notes?: string;
}

export interface DiagnosticInput {
  vehicleId: number;
  symptoms: string[];
  notes?: string;
  photo?: LocalPhoto | null;
}

export interface SosInput {
  vehicleId: number;
  issue: string;
  lat: number;
  lng: number;
}

export interface SosResult {
  jobId: number;
  status: 'pending';
  nearbyCount: number;
  eta: string;
}

export type JobScope = 'active' | 'history';
export type MechanicTab = 'sos' | 'bookings' | 'active' | 'history';
export type EarningsRange = 'day' | 'week' | 'month';

export interface ReviewInput {
  rating: 1 | 2 | 3 | 4 | 5;
  feedback?: string | null;
  tags?: string[];
}

export interface QuoteInput {
  partName: string;
  price: number;
  photos: LocalPhoto[];
}

export interface MechanicReview extends Review {
  ownerName: string;
  serviceType: string;
}

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

export type RealtimeHandler = (payload: RealtimePayload) => void;

export interface RealtimeClient {
  connect(session: Session): void;
  disconnect(): void;
  on(event: RealtimeEvent, handler: RealtimeHandler): () => void;
  onAny(handler: (event: RealtimeEvent, payload: RealtimePayload) => void): () => void;
}
