/**
 * LocalApiClient — implements the §7 API contract against the on-device store in ./db.
 *
 * It enforces the same business rules the server does (role + ownership guards, first-come claim,
 * UGX 50,000 fee, parts approved before billing, 1 review per job, finish locked while tasks/quotes
 * are open, SOS cancel → cancelled, FR-03 nearest-mechanic dispatch), so the app is fully usable
 * before the real backend is connected. Swap to RemoteApiClient by setting EXPO_PUBLIC_API_URL.
 */
import * as Crypto from 'expo-crypto';
import * as Print from 'expo-print';
import { Platform } from 'react-native';

import {
  ARRIVAL_CHECKLIST,
  BOOKING_CHECKLIST,
  DEFAULT_CONFIG,
  DISPATCH,
  MAX_PHOTOS,
  SERVICE_TYPE_MAX,
} from '@/constants/config';
import type {
  AppConfig,
  ChecklistItem,
  Earnings,
  Job,
  LocalPhoto,
  MechanicStats,
  PartsQuote,
  RealtimePayload,
  Review,
  User,
  Vehicle,
} from '@/models';
import { persistPhoto } from '@/services/media';
import { firstName, formatUGX, normalizePhone, startOfDay, toISODate } from '@/utils/format';
import { distanceKm, etaMinutes, etaRange } from '@/utils/geo';
import { ACTIVE_STATUSES, composeFeedback, computeTotals, progress } from '@/utils/jobs';
import { receiptHtml } from '@/utils/receipt';

import { ApiError, Errors } from '../errors';
import type {
  ApiClient,
  BookingInput,
  DiagnosticInput,
  EarningsRange,
  ForgotPasswordResult,
  JobScope,
  LoginInput,
  MechanicReview,
  MechanicTab,
  ProfilePatch,
  QuoteInput,
  RegisterInput,
  ReviewInput,
  Session,
  SosInput,
  SosResult,
  VehicleCreate,
  VehicleUpdate,
} from '../types';
import { emitTo } from './bus';
import { joinPaths, nextId, now, read, splitPaths, tx, type JobRow, type LocalDb, type UserRow } from './db';
import { toChecklistItem, toJob, toQuote, toReview, toUser, toVehicle } from './mappers';

type Tokens = Pick<Session, 'accessToken' | 'refreshToken'>;

/**
 * Local-mode password verifier: per-user random salt + iterated SHA-256 (expo-crypto has no PBKDF2),
 * stored as `sha256i$<iterations>$<salt>$<hash>`. The server keeps bcrypt; this never leaves the device.
 */
const HASH_ITERATIONS = 2000;

/** Bytes → lowercase hex string. */
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/** Hashes password + salt repeatedly; the iterations make brute-forcing a stolen store slower. */
async function derive(password: string, salt: string, iterations: number): Promise<string> {
  let h = `${salt}:${password}`;
  for (let i = 0; i < iterations; i++) {
    h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${h}:${salt}`);
  }
  return h;
}

/** Hashes a new password with a fresh random salt, in the stored `sha256i$…` format. */
async function hashPassword(password: string): Promise<string> {
  const salt = toHex(Crypto.getRandomBytes(16));
  return `sha256i$${HASH_ITERATIONS}$${salt}$${await derive(password, salt, HASH_ITERATIONS)}`;
}

/** Checks a typed password against a stored hash; unknown formats never match. */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, expected] = stored.split('$');
  if (scheme !== 'sha256i' || !salt || !expected) return false;
  return (await derive(password, salt, Number(iter))) === expected;
}

/** A random, hard-to-guess session token (two UUIDs without dashes). */
const token = () => `${Crypto.randomUUID()}${Crypto.randomUUID()}`.replace(/-/g, '');

/** Loose email check: something@something.something with no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A mechanic's average review rating, rounded to one decimal (0 when unrated). */
function mechanicRating(db: LocalDb, mechanicId: number): number {
  const rs = db.reviews.filter((r) => r.mechanic_id === mechanicId);
  if (!rs.length) return 0;
  return Math.round((rs.reduce((s, r) => s + r.rating, 0) / rs.length) * 10) / 10;
}

/** Approved mechanics who have switched themselves online. */
function onlineMechanics(db: LocalDb) {
  return db.users.filter((u) => u.role === 'mechanic' && u.status === 'active' && u.is_online);
}

/** FR-03: nearest 5 online, active mechanics within the radius (same rule as the §6.3 SQL). */
function nearestMechanics(db: LocalDb, lat: number, lng: number, radiusKm: number) {
  return onlineMechanics(db)
    .filter((m) => m.location_lat != null && m.location_lng != null)
    .map((m) => ({ m, km: distanceKm(lat, lng, m.location_lat!, m.location_lng!) }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, DISPATCH.limit);
}

/** Search radius for an SOS: the normal radius at first, widened once the SOS has waited too long. */
function sosRadius(job: JobRow) {
  return Date.now() - new Date(job.created_at).getTime() > DISPATCH.widenAfterMs
    ? DISPATCH.widenedRadiusKm
    : DISPATCH.radiusKm;
}

/** The mechanics an SOS should be offered to right now, measured from the owner's last known position. */
function sosTargets(db: LocalDb, job: JobRow) {
  const owner = db.users.find((u) => u.id === job.owner_id);
  if (owner?.location_lat == null || owner.location_lng == null) return [];
  return nearestMechanics(db, owner.location_lat, owner.location_lng, sosRadius(job));
}

/** Kilometres from `from` to the job's owner (one decimal), or null if either position is unknown. */
function jobDistance(db: LocalDb, job: JobRow, from: { lat: number; lng: number } | null) {
  const owner = db.users.find((u) => u.id === job.owner_id);
  if (!from || owner?.location_lat == null || owner.location_lng == null) return null;
  return Math.round(distanceKm(from.lat, from.lng, owner.location_lat, owner.location_lng) * 10) / 10;
}

/** The ApiClient for local mode. Every method reads or writes the on-device store through `read`/`tx`. */
export class LocalApiClient implements ApiClient {
  readonly mode = 'local' as const;
  // Token of the signed-in user; every guarded call looks it up in auth_tokens.
  private accessToken: string | null = null;
  // Told when the session becomes invalid so the app can sign the user out.
  private tokenListener: ((t: Tokens | null) => void) | null = null;

  setAuth(tokens: Tokens | null) {
    this.accessToken = tokens?.accessToken ?? null;
  }

  onTokensChanged(cb: (t: Tokens | null) => void) {
    this.tokenListener = cb;
  }

  // ─── guards ──────────────────────────────────────────────────────────────────

  /** The signed-in user. Throws (and signs the app out) if the token is unknown or the account is suspended. */
  private currentUser(db: LocalDb): UserRow {
    const t = this.accessToken && db.auth_tokens.find((x) => x.token === this.accessToken && x.kind === 'access');
    const user = t ? db.users.find((u) => u.id === t.user_id) : undefined;
    if (!user) {
      this.tokenListener?.(null);
      throw Errors.unauthorized();
    }
    if (user.status === 'suspended') {
      this.tokenListener?.(null);
      throw Errors.forbidden('Your account has been suspended. Contact support.');
    }
    return user;
  }

  /** The signed-in user, who must have `role`. Mechanics must also be approved unless `allowPending` is set. */
  private requireRole(db: LocalDb, role: 'owner' | 'mechanic', opts: { allowPending?: boolean } = {}) {
    const u = this.currentUser(db);
    if (u.role !== role) throw Errors.forbidden();
    if (role === 'mechanic' && u.status !== 'active' && !opts.allowPending) {
      throw Errors.forbidden('Your account is still under review.');
    }
    return u;
  }

  /** A job belonging to this owner. Other owners' jobs look "not found" so their existence isn't revealed. */
  private ownJob(db: LocalDb, owner: UserRow, jobId: number) {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job || job.owner_id !== owner.id) throw Errors.notFound('Job');
    return job;
  }

  /** A job that has been assigned to this mechanic. */
  private assignedJob(db: LocalDb, mech: UserRow, jobId: number) {
    const job = db.jobs.find((j) => j.id === jobId);
    if (!job) throw Errors.notFound('Job');
    if (job.mechanic_id !== mech.id) throw Errors.forbidden('This job is assigned to another mechanic.');
    return job;
  }

  /** Marks a job as just modified. */
  private touch(job: JobRow) {
    job.updated_at = now();
  }

  /** Creates new access/refresh tokens for a user and returns the session. */
  private issueSession(db: LocalDb, user: UserRow): Session {
    const access = token();
    const refresh = token();
    // Drop this user's tokens older than 30 days so the table doesn't grow forever.
    db.auth_tokens =db.auth_tokens.filter((t) => t.user_id !== user.id || Date.now() - new Date(t.created_at).getTime() < 30 * 864e5);
    db.auth_tokens.push({ token: access, user_id: user.id, kind: 'access', created_at: now() });
    db.auth_tokens.push({ token: refresh, user_id: user.id, kind: 'refresh', created_at: now() });
    return { user: toUser(user), accessToken: access, refreshToken: refresh };
  }

  // ─── expansion ───────────────────────────────────────────────────────────────

  /**
   * Builds the full Job the screens need from a jobs row: vehicle, mechanic, owner, checklist, quotes,
   * totals, review and booking extras. Contact details and exact locations are hidden from anyone who
   * isn't a party to the job. Pass `from` to also get the distance to the owner.
   */
  private expand(db: LocalDb, row: JobRow, viewer: UserRow, opts: { from?: { lat: number; lng: number } | null } = {}): Job {
    const job = toJob(row);
    const vehicle = db.vehicles.find((v) => v.id === row.vehicle_id);
    if (vehicle) job.vehicle = toVehicle(vehicle);
    const assigned = row.mechanic_id != null && !['completed', 'cancelled'].includes(row.status);
    const isCounterparty = viewer.id === row.owner_id || viewer.id === row.mechanic_id;

    const mech = row.mechanic_id != null ? db.users.find((u) => u.id === row.mechanic_id) : undefined;
    if (mech) {
      job.mechanic = {
        id: mech.id,
        fullName: mech.full_name,
        phone: isCounterparty ? mech.phone : null,
        garageName: mech.garage_name,
        rating: mechanicRating(db, mech.id),
        // location only while the job is live (§13.1: sharing stops when the job completes)
        locationLat: assigned && isCounterparty ? mech.location_lat : null,
        locationLng: assigned && isCounterparty ? mech.location_lng : null,
      };
    }
    const owner = db.users.find((u) => u.id === row.owner_id);
    if (owner) {
      const reveal = viewer.id === row.owner_id || (viewer.id === row.mechanic_id && assigned);
      job.owner = {
        id: owner.id,
        fullName: owner.full_name,
        phone: reveal ? owner.phone : null,
        // Exact location only for the counter-party of an accepted job (§13.1); open jobs expose distance only.
        locationLat: reveal ? owner.location_lat : null,
        locationLng: reveal ? owner.location_lng : null,
      };
    }
    job.checklist = db.job_checklists.filter((c) => c.job_id === row.id).sort((a, b) => a.id - b.id).map(toChecklistItem);
    job.quotes = db.parts_quotes.filter((q) => q.job_id === row.id).sort((a, b) => a.id - b.id).map(toQuote);
    job.totals = computeTotals(job.quotes, this.fee(db));
    // A completed job keeps the total it was billed at, even if the fee changes later.
    if (row.status === 'completed') job.totals.total = Number(row.total_price) || job.totals.total;
    const review = db.reviews.find((r) => r.job_id === row.id);
    job.review = review ? toReview(review) : null;
    const extra = db.job_extras.find((e) => e.job_id === row.id);
    job.scheduledDate = extra?.scheduled_date ?? null;
    job.notes = extra?.notes ?? null;
    if (opts.from !== undefined) job.distanceKm = jobDistance(db, row, opts.from);
    return job;
  }

  /** The current service fee (admin-set value if present, otherwise the default). */
  private fee(db: LocalDb) {
    const row = db.system_config.find((c) => c.key === 'service_fee');
    return row ? Number(row.value) : DEFAULT_CONFIG.serviceFee;
  }

  // ─── Auth & account ──────────────────────────────────────────────────────────

  /** Validates the sign-up form, creates the account and signs the new user in. */
  async register(input: RegisterInput): Promise<Session> {
    const email = input.email.trim().toLowerCase();
    if (!input.fullName.trim()) throw Errors.validation('Enter your full name.');
    if (!EMAIL_RE.test(email)) throw Errors.validation('Enter a valid email address.');
    if (input.password.length < 6) throw Errors.validation('Password must be at least 6 characters.');
    const phone = normalizePhone(input.phone);
    if (phone.replace(/\D/g, '').length < 9) throw Errors.validation('Enter a valid phone number.');
    // Hash outside the transaction: it is slow and doesn't need the database lock.
    const pw = await hashPassword(input.password);
    const session = await tx((db) => {
      if (db.users.some((u) => u.email === email)) throw Errors.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
      const row: UserRow = {
        id: nextId(db, 'users'),
        full_name: input.fullName.trim(),
        email,
        password: pw,
        phone,
        role: input.role,
        // Owner → active; mechanic → pending (admin approval).
        status: input.role === 'mechanic' ? 'pending' : 'active',
        location_lat: null,
        location_lng: null,
        is_online: false,
        garage_name: input.role === 'mechanic' ? input.garageName?.trim() || null : null,
        garage_location: input.role === 'mechanic' ? input.garageLocation?.trim() || null : null,
        expertise: input.role === 'mechanic' ? input.expertise?.trim() || null : null,
        created_at: now(),
      };
      db.users.push(row);
      return this.issueSession(db, row);
    });
    this.setAuth(session);
    return session;
  }

  /** Signs in with email or phone plus password, for the chosen role. */
  async login(input: LoginInput): Promise<Session> {
    const id = input.identifier.trim().toLowerCase();
    const phone = normalizePhone(id);
    const user = await read((db) =>
      db.users.find((u) => u.role === input.role && (u.email === id || (u.phone && u.phone === phone))),
    );
    // Same error for "no such user" and "wrong password", so the form doesn't reveal which accounts exist.
    const invalid = new ApiError('INVALID_CREDENTIALS', 'Incorrect email/phone or password.', 401);
    if (!user) throw invalid;
    if (!(await verifyPassword(input.password, user.password))) throw invalid;
    if (user.status === 'suspended') throw Errors.forbidden('Your account has been suspended. Contact support.');
    const session = await tx((db) => this.issueSession(db, db.users.find((u) => u.id === user.id)!));
    this.setAuth(session);
    return session;
  }

  /** Signs out: revokes all of the user's tokens and takes a mechanic offline. */
  async logout(): Promise<void> {
    const t = this.accessToken;
    if (t) {
      await tx((db) => {
        const row = db.auth_tokens.find((x) => x.token === t);
        if (row) {
          // Revoke every token for this user, and stop offering a signed-out mechanic new jobs.
          db.auth_tokens = db.auth_tokens.filter((x) => x.user_id !== row.user_id);
          const u = db.users.find((x) => x.id === row.user_id);
          if (u?.role === 'mechanic') u.is_online = false;
        }
      });
    }
    this.setAuth(null);
  }

  /**
   * Starts a password reset. Local mode can't send SMS, so the user proves ownership by retyping the
   * account's phone number; the reply shows a masked hint of that number.
   */
  async forgotPassword(identifier: string): Promise<ForgotPasswordResult> {
    const id = identifier.trim().toLowerCase();
    const phone = normalizePhone(id);
    const user = await read((db) => db.users.find((u) => u.email === id || u.phone === phone));
    if (!user) throw Errors.notFound('Account');
    const p = user.phone ?? '';
    return { verification: 'phone', destination: p ? `${p.slice(0, 4)} ••• ${p.slice(-3)}` : undefined };
  }

  /** Sets a new password once the phone number (`code`) matches, and signs out all existing sessions. */
  async resetPassword(input: { identifier: string; code: string; password: string }): Promise<void> {
    if (input.password.length < 6) throw Errors.validation('Password must be at least 6 characters.');
    const id = input.identifier.trim().toLowerCase();
    const phone = normalizePhone(id);
    const code = normalizePhone(input.code);
    const user = await read((db) => db.users.find((u) => u.email === id || u.phone === phone));
    if (!user) throw Errors.notFound('Account');
    if (user.phone !== code) throw Errors.validation('That phone number does not match this account.');
    const pw = await hashPassword(input.password);
    await tx((db) => {
      const u = db.users.find((x) => x.id === user.id)!;
      u.password = pw;
      db.auth_tokens = db.auth_tokens.filter((x) => x.user_id !== u.id);
    });
  }

  /** The signed-in user's profile. */
  async me(): Promise<User> {
    return read((db) => toUser(this.currentUser(db)));
  }

  /** Updates the signed-in user's profile; garage fields are ignored for owners. */
  async updateMe(patch: ProfilePatch): Promise<User> {
    return tx((db) => {
      const u = this.currentUser(db);
      if (patch.fullName !== undefined) {
        if (!patch.fullName.trim()) throw Errors.validation('Enter your full name.');
        u.full_name = patch.fullName.trim();
      }
      if (patch.phone !== undefined) u.phone = normalizePhone(patch.phone);
      if (u.role === 'mechanic') {
        if (patch.garageName !== undefined) u.garage_name = patch.garageName?.trim() || null;
        if (patch.garageLocation !== undefined) u.garage_location = patch.garageLocation?.trim() || null;
        if (patch.expertise !== undefined) u.expertise = patch.expertise?.trim() || null;
      }
      return toUser(u);
    });
  }

  /** Saves the user's GPS position; for a mechanic on a job, also streams it live to that job's owner. */
  async updateLocation(input: { lat: number; lng: number }): Promise<void> {
    const relay = await tx((db) => {
      const u = this.currentUser(db);
      // Stored to 6 decimals (~10 cm), matching the database column precision.
      u.location_lat = Math.round(input.lat * 1e6) / 1e6;
      u.location_lng = Math.round(input.lng * 1e6) / 1e6;
      if (u.role !== 'mechanic') return [];
      // Relay to the active job room while en route / on the job.
      return db.jobs
        .filter((j) => j.mechanic_id === u.id && ['accepted', 'diagnosing', 'fixing', 'ready'].includes(j.status))
        .map((j) => ({ ownerId: j.owner_id, jobId: j.id }));
    });
    for (const r of relay) {
      await emitTo([r.ownerId], 'mechanic_location', { jobId: r.jobId, lat: input.lat, lng: input.lng }, { notify: false });
    }
  }

  async registerPushToken(): Promise<void> {
    // Push delivery needs the backend (device_tokens table, §5.3). Nothing to store locally.
  }

  /** App settings: defaults overlaid with any admin-set values in system_config. */
  async getConfig(): Promise<AppConfig> {
    return read((db) => {
      const get = (k: string) => db.system_config.find((c) => c.key === k)?.value;
      return {
        ...DEFAULT_CONFIG,
        serviceFee: this.fee(db),
        maintenance: get('maintenance_mode') === 'true',
        minAppVersion: get('min_app_version') ?? DEFAULT_CONFIG.minAppVersion,
      };
    });
  }

  // ─── Vehicles ────────────────────────────────────────────────────────────────

  /** The owner's cars, oldest first. */
  async listVehicles(): Promise<Vehicle[]> {
    return read((db) => {
      const u = this.requireRole(db, 'owner');
      return db.vehicles.filter((v) => v.owner_id === u.id).sort((a, b) => a.id - b.id).map(toVehicle);
    });
  }

  /** One of the owner's cars with its five most recent jobs. */
  async getVehicle(id: number) {
    return read((db) => {
      const u = this.requireRole(db, 'owner');
      const v = db.vehicles.find((x) => x.id === id && x.owner_id === u.id);
      if (!v) throw Errors.notFound('Vehicle');
      const recentJobs = db.jobs
        .filter((j) => j.vehicle_id === id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 5)
        .map((j) => this.expand(db, j, u));
      return { vehicle: toVehicle(v), recentJobs };
    });
  }

  /** Checks the vehicle fields that are present (so it works for both create and partial update). */
  private validateVehicle(input: Partial<VehicleCreate>) {
    if (input.make !== undefined && !input.make.trim()) throw Errors.validation('Enter the make.');
    if (input.model !== undefined && !input.model.trim()) throw Errors.validation('Enter the model.');
    const year = input.year;
    if (year !== undefined && (!Number.isInteger(year) || year < 1950 || year > new Date().getFullYear() + 1)) {
      throw Errors.validation('Enter a valid year.');
    }
    if (input.plateNumber !== undefined && !input.plateNumber.trim()) throw Errors.validation('Enter the plate number.');
  }

  /** Adds a car to the owner's garage, copying its photos into app storage. */
  async createVehicle(input: VehicleCreate): Promise<Vehicle> {
    this.validateVehicle(input);
    if (input.photos.length > MAX_PHOTOS) throw Errors.validation(`Up to ${MAX_PHOTOS} photos.`);
    // Copy picked photos into app storage so they survive the picker's temp files being cleared.
    const paths = input.photos.map(persistPhoto);
    return tx((db) => {
      const u = this.requireRole(db, 'owner');
      const row = {
        id: nextId(db, 'vehicles'),
        owner_id: u.id,
        make: input.make.trim(),
        model: input.model.trim(),
        year: input.year,
        plate_number: input.plateNumber.trim().toUpperCase(),
        fuel_type: input.fuelType,
        transmission: input.transmission,
        tyre_size: input.tyreSize?.trim() || null,
        color: input.color?.trim() || null,
        mileage: input.mileage,
        last_service_date: input.lastServiceDate,
        photos: joinPaths(paths),
        created_at: now(),
      };
      db.vehicles.push(row);
      return toVehicle(row);
    });
  }

  /** Edits one of the owner's cars. Only the fields present in `patch` change. */
  async updateVehicle(id: number, patch: VehicleUpdate): Promise<Vehicle> {
    this.validateVehicle(patch);
    const added = (patch.newPhotos ?? []).map(persistPhoto);
    return tx((db) => {
      const u = this.requireRole(db, 'owner');
      const v = db.vehicles.find((x) => x.id === id && x.owner_id === u.id);
      if (!v) throw Errors.notFound('Vehicle');
      if (patch.make !== undefined) v.make = patch.make.trim();
      if (patch.model !== undefined) v.model = patch.model.trim();
      if (patch.year !== undefined) v.year = patch.year;
      if (patch.plateNumber !== undefined) v.plate_number = patch.plateNumber.trim().toUpperCase();
      if (patch.fuelType !== undefined) v.fuel_type = patch.fuelType;
      if (patch.transmission !== undefined) v.transmission = patch.transmission;
      if (patch.tyreSize !== undefined) v.tyre_size = patch.tyreSize?.trim() || null;
      if (patch.color !== undefined) v.color = patch.color?.trim() || null;
      if (patch.mileage !== undefined) v.mileage = patch.mileage;
      if (patch.lastServiceDate !== undefined) v.last_service_date = patch.lastServiceDate;
      // Photo list = the ones the user kept (or all existing if unspecified) + newly added ones.
      if (patch.keepPhotos || added.length) {
        const keep = patch.keepPhotos ?? splitPaths(v.photos);
        const all = [...keep, ...added];
        if (all.length > MAX_PHOTOS) throw Errors.validation(`Up to ${MAX_PHOTOS} photos.`);
        v.photos = joinPaths(all);
      }
      return toVehicle(v);
    });
  }

  /** Removes a car from the garage, unless it has a job in progress. */
  async deleteVehicle(id: number): Promise<void> {
    await tx((db) => {
      const u = this.requireRole(db, 'owner');
      const v = db.vehicles.find((x) => x.id === id && x.owner_id === u.id);
      if (!v) throw Errors.notFound('Vehicle');
      if (db.jobs.some((j) => j.vehicle_id === id && ACTIVE_STATUSES.includes(j.status))) {
        throw Errors.conflict('VEHICLE_IN_USE', 'This car has an active job. Finish or cancel it first.');
      }
      db.vehicles = db.vehicles.filter((x) => x.id !== id);
    });
  }

  // ─── Jobs (owner) ────────────────────────────────────────────────────────────

  /** Creates a pending job for one of the owner's cars. */
  private insertJob(db: LocalDb, owner: UserRow, vehicleId: number, serviceType: string, sos: boolean): JobRow {
    if (!db.vehicles.some((v) => v.id === vehicleId && v.owner_id === owner.id)) throw Errors.notFound('Vehicle');
    const row: JobRow = {
      id: nextId(db, 'jobs'),
      owner_id: owner.id,
      mechanic_id: null,
      vehicle_id: vehicleId,
      service_type: serviceType.slice(0, SERVICE_TYPE_MAX),
      status: 'pending',
      total_price: 0,
      sos_active: sos,
      start_code: null,
      created_at: now(),
      updated_at: now(),
    };
    db.jobs.push(row);
    return row;
  }

  /** One-line "Owner name · Make Model" label used in mechanic notifications. */
  private jobSummary(db: LocalDb, row: JobRow) {
    const v = db.vehicles.find((x) => x.id === row.vehicle_id);
    const o = db.users.find((x) => x.id === row.owner_id);
    return `${o?.full_name ?? 'Owner'} · ${v ? `${v.make} ${v.model}` : 'Vehicle'}`;
  }

  /**
   * Books a service for today or a later date. The job gets the standard service checklist and is
   * offered to every online mechanic.
   */
  async createBooking(input: BookingInput): Promise<Job> {
    const today = toISODate(new Date());
    // YYYY-MM-DD strings compare correctly as plain text.
    if (!input.scheduledDate || input.scheduledDate < today) throw Errors.validation('Choose today or a future date.');
    const { job, targets, payload } = await tx((db) => {
      const u = this.requireRole(db, 'owner');
      const row = this.insertJob(db, u, input.vehicleId, input.serviceType, false);
      for (const t of BOOKING_CHECKLIST) {
        db.job_checklists.push({ id: nextId(db, 'job_checklists'), job_id: row.id, task_description: t, is_completed: false, photo_url: null, completed_at: null });
      }
      db.job_extras.push({ job_id: row.id, scheduled_date: input.scheduledDate, notes: input.notes?.trim() || null, photo: null });
      return {
        job: this.expand(db, row, u),
        targets: onlineMechanics(db).map((m) => m.id),
        payload: { jobId: row.id, sos: false, serviceType: row.service_type, summary: this.jobSummary(db, row) },
      };
    });
    // Notify only after the transaction has saved, so mechanics never see a job that was rolled back.
    await emitTo(targets, 'new_job_pushed', payload);
    return job;
  }

  /** Requests a diagnosis for the chosen symptoms and offers it to every online mechanic. */
  async createDiagnostic(input: DiagnosticInput): Promise<Job> {
    if (!input.symptoms.length) throw Errors.validation('Pick at least one symptom.');
    const photo = input.photo ? persistPhoto(input.photo) : null;
    const { job, targets, payload } = await tx((db) => {
      const u = this.requireRole(db, 'owner');
      // Symptoms are persisted in jobs.service_type (§5.2 / §6.4 fix).
      const row = this.insertJob(db, u, input.vehicleId, `Diagnostic: ${input.symptoms.join(', ')}`, false);
      db.job_extras.push({ job_id: row.id, scheduled_date: null, notes: input.notes?.trim() || null, photo });
      return {
        job: this.expand(db, row, u),
        targets: onlineMechanics(db).map((m) => m.id),
        payload: { jobId: row.id, sos: false, serviceType: row.service_type, summary: this.jobSummary(db, row) },
      };
    });
    await emitTo(targets, 'new_job_pushed', payload);
    return job;
  }

  /**
   * Raises an emergency SOS at the owner's position and alerts the nearest online mechanics.
   * Limited to 3 SOS per 10 minutes and one open SOS at a time.
   */
  async sendSos(input: SosInput): Promise<SosResult> {
    const { result, targets } = await tx((db) => {
      const u = this.requireRole(db, 'owner');
      // Abuse guard: rate-limit repeated SOS and block a second one while the first is still open.
      const mine = db.jobs.filter((j) => j.owner_id === u.id && j.sos_active);
      const recent = mine.filter((j) => Date.now() - new Date(j.created_at).getTime() < 10 * 60_000);
      if (recent.length >= 3) throw new ApiError('RATE_LIMITED', 'Too many SOS requests. Please call the emergency line.', 429);
      const open = mine.find((j) => ['pending', 'accepted'].includes(j.status));
      if (open) throw Errors.conflict('SOS_ALREADY_ACTIVE', 'You already have an active SOS request.');
      // Save where the owner is; dispatch and the mechanic's map use this position.
      u.location_lat = input.lat;
      u.location_lng = input.lng;
      const row = this.insertJob(db, u, input.vehicleId, input.issue, true);
      const near = nearestMechanics(db, input.lat, input.lng, DISPATCH.radiusKm);
      return {
        result: { jobId: row.id, status: 'pending' as const, nearbyCount: near.length, eta: etaRange(near[0]?.km ?? null) },
        targets: near.map((n) => ({ id: n.m.id, km: n.km, summary: this.jobSummary(db, row) })),
      };
    });
    // Each mechanic gets their own distance in the alert.
    for (const t of targets) {
      await emitTo([t.id], 'new_job_pushed', {
        jobId: result.jobId,
        sos: true,
        serviceType: input.issue,
        distanceKm: t.km,
        summary: `${t.km.toFixed(1)} km · ${t.summary}`,
      });
    }
    return result;
  }

  /** Cancels an SOS that no mechanic has accepted yet, and removes it from mechanics' boards. */
  async cancelSos(jobId: number): Promise<void> {
    const notifyIds = await tx((db) => {
      const u = this.requireRole(db, 'owner');
      const job = this.ownJob(db, u, jobId);
      if (job.status !== 'pending') {
        throw Errors.conflict('JOB_NOT_CANCELLABLE', 'A mechanic has already accepted. Call them to cancel.');
      }
      job.status = 'cancelled'; // §6.4 fix: web sets "completed"
      job.sos_active = false;
      this.touch(job);
      return onlineMechanics(db).map((m) => m.id);
    });
    await emitTo(notifyIds, 'job_unavailable', { jobId }, { notify: false });
  }

  /** The owner's jobs, newest first: in-progress ones for 'active', finished/cancelled for 'history'. */
  async listJobs(scope: JobScope): Promise<Job[]> {
    return read((db) => {
      const u = this.requireRole(db, 'owner');
      return db.jobs
        .filter((j) => j.owner_id === u.id)
        .filter((j) => (scope === 'active' ? ACTIVE_STATUSES.includes(j.status) : !ACTIVE_STATUSES.includes(j.status)))
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((j) => this.expand(db, j, u));
    });
  }

  /**
   * One job, if the caller may see it: an owner sees their own jobs; a mechanic sees jobs assigned to
   * them and open jobs they could still accept. A job taken by someone else gives JOB_ALREADY_TAKEN.
   */
  async getJob(id: number): Promise<Job> {
    return read((db) => {
      const u = this.currentUser(db);
      const row = db.jobs.find((j) => j.id === id);
      if (!row) throw Errors.notFound('Job');
      if (u.role === 'owner') {
        if (row.owner_id !== u.id) throw Errors.notFound('Job');
        return this.expand(db, row, u);
      }
      if (u.role === 'mechanic') {
        const from = u.location_lat != null && u.location_lng != null ? { lat: u.location_lat, lng: u.location_lng } : null;
        if (row.mechanic_id === u.id) return this.expand(db, row, u, { from });
        if (row.status === 'pending' && row.mechanic_id == null && u.status === 'active') {
          return this.expand(db, row, u, { from });
        }
        if (row.mechanic_id != null && row.mechanic_id !== u.id) {
          throw Errors.conflict('JOB_ALREADY_TAKEN', 'Another mechanic accepted this job.');
        }
      }
      throw Errors.notFound('Job');
    });
  }

  /** Owner approves or rejects a parts quote (once only) and the mechanic is told the outcome. */
  async decideQuote(quoteId: number, decision: 'approve' | 'reject'): Promise<PartsQuote> {
    const { quote, mechanicId, summary, jobId } = await tx((db) => {
      const u = this.requireRole(db, 'owner');
      const q = db.parts_quotes.find((x) => x.id === quoteId);
      if (!q) throw Errors.notFound('Quote');
      const job = this.ownJob(db, u, q.job_id);
      if (q.is_approved !== null) throw Errors.conflict('QUOTE_ALREADY_DECIDED', 'This quote was already decided.');
      if (!ACTIVE_STATUSES.includes(job.status)) throw Errors.unprocessable('JOB_CLOSED', 'This job is closed.');
      q.is_approved = decision === 'approve';
      this.touch(job);
      return {
        quote: toQuote(q),
        mechanicId: job.mechanic_id,
        jobId: job.id,
        summary: `Owner ${decision === 'approve' ? 'approved' : 'declined'} ${q.part_name}`,
      };
    });
    if (mechanicId) await emitTo([mechanicId], 'quote_updated', { jobId, quoteId, summary });
    return quote;
  }

  /**
   * Builds the receipt for a completed job and returns where to open it: a PDF file on phones, or an
   * HTML data URL on web.
   */
  async getReceipt(jobId: number): Promise<{ url: string }> {
    const { job, fee } = await read((db) => {
      const u = this.currentUser(db);
      const row = db.jobs.find((j) => j.id === jobId);
      if (!row || (row.owner_id !== u.id && row.mechanic_id !== u.id)) throw Errors.notFound('Job');
      if (row.status !== 'completed') throw Errors.unprocessable('JOB_NOT_COMPLETED', 'The receipt is ready once the job is complete.');
      return { job: this.expand(db, row, u), fee: this.fee(db) };
    });
    const html = receiptHtml(job, fee);
    if (Platform.OS === 'web') return { url: `data:text/html;charset=utf-8,${encodeURIComponent(html)}` };
    const { uri } = await Print.printToFileAsync({ html });
    return { url: uri };
  }

  /** Owner rates the mechanic on a completed job (one review per job). Tags are merged into the feedback text. */
  async submitReview(jobId: number, input: ReviewInput): Promise<Review> {
    if (!(input.rating >= 1 && input.rating <= 5)) throw Errors.validation('Pick a rating from 1 to 5 stars.');
    return tx((db) => {
      const u = this.requireRole(db, 'owner');
      const job = this.ownJob(db, u, jobId);
      if (job.status !== 'completed' || !job.mechanic_id) throw Errors.unprocessable('JOB_NOT_COMPLETED', 'You can rate once the job is complete.');
      if (db.reviews.some((r) => r.job_id === jobId)) throw Errors.conflict('REVIEW_EXISTS', 'You already reviewed this job.');
      const row = {
        id: nextId(db, 'reviews'),
        job_id: jobId,
        mechanic_id: job.mechanic_id,
        owner_id: u.id,
        rating: input.rating,
        feedback: composeFeedback(input.tags ?? [], input.feedback ?? ''),
        created_at: now(),
      };
      db.reviews.push(row);
      return toReview(row);
    });
  }

  // ─── Mechanic ────────────────────────────────────────────────────────────────

  /** Mechanic goes online (receives SOS alerts) or offline. */
  async setOnline(isOnline: boolean): Promise<User> {
    return tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      u.is_online = isOnline;
      return toUser(u);
    });
  }

  /**
   * The mechanic's job board for one tab:
   * - sos: open SOS requests this mechanic is among the nearest for (online only), closest first
   * - bookings: open bookings/diagnostics, oldest first
   * - active / history: the mechanic's own jobs, most recently updated first
   * Distances are measured from `coords`, or the mechanic's last saved position.
   */
  async listMechanicJobs(tab: MechanicTab, coords?: { lat: number; lng: number } | null): Promise<Job[]> {
    return read((db) => {
      const u = this.requireRole(db, 'mechanic');
      const from =
        coords ?? (u.location_lat != null && u.location_lng != null ? { lat: u.location_lat, lng: u.location_lng } : null);
      let rows: JobRow[];
      switch (tab) {
        case 'sos':
          if (!u.is_online) return [];
          rows = db.jobs.filter(
            (j) => j.sos_active && j.status === 'pending' && j.mechanic_id == null && sosTargets(db, j).some((t) => t.m.id === u.id),
          );
          break;
        case 'bookings':
          rows = db.jobs.filter((j) => !j.sos_active && j.status === 'pending' && j.mechanic_id == null);
          break;
        case 'active':
          rows = db.jobs.filter((j) => j.mechanic_id === u.id && ACTIVE_STATUSES.includes(j.status));
          break;
        case 'history':
          rows = db.jobs.filter((j) => j.mechanic_id === u.id && !ACTIVE_STATUSES.includes(j.status));
          break;
      }
      const jobs = rows.map((j) => this.expand(db, j, u, { from }));
      if (tab === 'sos') return jobs.sort((a, b) => (a.distanceKm ?? 1e9) - (b.distanceKm ?? 1e9));
      if (tab === 'bookings') return jobs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return jobs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }

  /** Dashboard numbers: completed jobs, jobs in progress, average rating. Works while pending approval. */
  async mechanicStats(): Promise<MechanicStats> {
    return read((db) => {
      const u = this.requireRole(db, 'mechanic', { allowPending: true });
      const mine = db.jobs.filter((j) => j.mechanic_id === u.id);
      return {
        totalJobs: mine.filter((j) => j.status === 'completed').length,
        activeJobs: mine.filter((j) => ACTIVE_STATUSES.includes(j.status)).length,
        rating: mechanicRating(db, u.id),
      };
    });
  }

  /**
   * Mechanic claims an open job. First to accept wins; everyone else gets JOB_ALREADY_TAKEN. The owner
   * is told who is coming, and the job disappears from other mechanics' boards.
   */
  async acceptJob(jobId: number): Promise<Job> {
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const row = db.jobs.find((j) => j.id === jobId);
      if (!row) throw Errors.notFound('Job');
      if (row.status === 'cancelled') throw Errors.conflict('JOB_CANCELLED', 'The owner cancelled this request.');
      // Atomic first-come claim: UPDATE … WHERE mechanic_id IS NULL
      if (row.mechanic_id != null || row.status !== 'pending') {
        throw Errors.conflict('JOB_ALREADY_TAKEN', 'Another mechanic accepted this job.');
      }
      row.mechanic_id = u.id;
      row.status = 'accepted';
      this.touch(row);
      const km = jobDistance(db, row, u.location_lat != null && u.location_lng != null ? { lat: u.location_lat, lng: u.location_lng } : null);
      const summary = row.sos_active
        ? `${u.full_name} is on the way${km != null ? ` · ${etaMinutes(km)} min` : ''}`
        : `Booking accepted by ${u.garage_name || u.full_name}`;
      return {
        job: this.expand(db, row, u, { from: null }),
        ownerId: row.owner_id,
        others: onlineMechanics(db).filter((m) => m.id !== u.id).map((m) => m.id),
        event: row.sos_active ? ('job_taken' as const) : ('appointment_update' as const),
        summary,
      };
    });
    await emitTo([out.ownerId], out.event, { jobId, summary: out.summary });
    await emitTo(out.others, 'job_unavailable', { jobId }, { notify: false });
    return out.job;
  }

  /** Mechanic declines a job: skipping an SOS changes nothing, declining a booking cancels it. */
  async declineJob(jobId: number): Promise<void> {
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const row = db.jobs.find((j) => j.id === jobId);
      if (!row) throw Errors.notFound('Job');
      if (row.sos_active) return null; // SOS "Skip" only hides the card for this mechanic
      if (row.status !== 'pending' || row.mechanic_id != null) {
        throw Errors.conflict('JOB_ALREADY_TAKEN', 'This booking is no longer open.');
      }
      // Web parity: declining a booking cancels it.
      row.status = 'cancelled';
      this.touch(row);
      return {
        ownerId: row.owner_id,
        others: onlineMechanics(db).filter((m) => m.id !== u.id).map((m) => m.id),
        summary: `${row.service_type} booking was declined — please book again`,
      };
    });
    if (out) {
      await emitTo([out.ownerId], 'appointment_update', { jobId, summary: out.summary });
      await emitTo(out.others, 'job_unavailable', { jobId }, { notify: false });
    }
  }

  /** Mechanic reached the car: the job moves to "fixing" and the owner is notified. */
  async markArrived(jobId: number): Promise<Job> {
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const row = this.assignedJob(db, u, jobId);
      if (row.status !== 'accepted') throw Errors.conflict('INVALID_STATE', 'You have already marked arrival.');
      row.status = 'fixing';
      this.touch(row);
      // Jobs without a checklist yet (SOS and diagnostics) get the standard arrival checklist.
      if (!db.job_checklists.some((c) => c.job_id === row.id)) {
        for (const t of ARRIVAL_CHECKLIST) {
          db.job_checklists.push({ id: nextId(db, 'job_checklists'), job_id: row.id, task_description: t, is_completed: false, photo_url: null, completed_at: null });
        }
      }
      return { job: this.expand(db, row, u, { from: null }), ownerId: row.owner_id, summary: `${firstName(u.full_name)} reached your car` };
    });
    await emitTo([out.ownerId], 'job_progress_update', { jobId, summary: out.summary });
    return out.job;
  }

  /** Ticks or unticks a checklist task (optionally with a photo) and sends the owner the new progress %. */
  async updateTask(taskId: number, input: { isCompleted: boolean; photo?: LocalPhoto | null }): Promise<ChecklistItem> {
    const photo = input.photo ? persistPhoto(input.photo) : undefined;
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const task = db.job_checklists.find((t) => t.id === taskId);
      if (!task) throw Errors.notFound('Task');
      const row = this.assignedJob(db, u, task.job_id);
      if (row.status !== 'fixing') throw Errors.unprocessable('INVALID_STATE', 'Mark "Reached car" before ticking tasks.');
      task.is_completed = input.isCompleted;
      task.completed_at = input.isCompleted ? now() : null;
      if (photo !== undefined) task.photo_url = photo; // FR15 per-task photo evidence
      this.touch(row);
      const pr = progress(db.job_checklists.filter((c) => c.job_id === row.id).map(toChecklistItem));
      return { item: toChecklistItem(task), ownerId: row.owner_id, jobId: row.id, pct: pr.pct };
    });
    // Always update the owner's screen, but only add a notification when a task is completed.
    await emitTo(
      [out.ownerId],
      'task_update',
      { jobId: out.jobId, taskId, summary: `${out.item.taskDescription} · ${out.pct}%` },
      { notify: input.isCompleted },
    );
    return out.item;
  }

  /** Mechanic proposes a part with price and photos; the owner is alerted to approve or reject it. */
  async createQuote(jobId: number, input: QuoteInput): Promise<PartsQuote> {
    if (!input.partName.trim()) throw Errors.validation('Enter the part name.');
    if (!(input.price > 0)) throw Errors.validation('Enter the price in UGX.');
    if (input.photos.length > MAX_PHOTOS) throw Errors.validation(`Up to ${MAX_PHOTOS} photos.`);
    const paths = input.photos.map(persistPhoto);
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const row = this.assignedJob(db, u, jobId);
      if (row.status !== 'fixing') throw Errors.unprocessable('INVALID_STATE', 'You can quote parts after reaching the car.');
      const q = {
        id: nextId(db, 'parts_quotes'),
        job_id: jobId,
        part_name: input.partName.trim(),
        price: Math.round(input.price),
        photo_evidence: joinPaths(paths),
        is_approved: null,
        created_at: now(),
      };
      db.parts_quotes.push(q);
      this.touch(row);
      return { quote: toQuote(q), ownerId: row.owner_id };
    });
    await emitTo([out.ownerId], 'new_quote_alert', {
      jobId,
      quoteId: out.quote.id,
      partName: out.quote.partName,
      price: out.quote.price,
    });
    return out.quote;
  }

  /**
   * Mechanic finishes the job. Refused while any task is unticked or any quote is undecided. The final
   * price (service fee + approved parts) is saved and the owner is told the receipt is ready.
   */
  async completeJob(jobId: number): Promise<Job> {
    const out = await tx((db) => {
      const u = this.requireRole(db, 'mechanic');
      const row = this.assignedJob(db, u, jobId);
      if (row.status !== 'fixing') throw Errors.unprocessable('INVALID_STATE', 'This job is not in progress.');
      const tasks = db.job_checklists.filter((c) => c.job_id === jobId);
      const quotes = db.parts_quotes.filter((q) => q.job_id === jobId);
      const openTasks = tasks.filter((t) => !t.is_completed).length;
      const openQuotes = quotes.filter((q) => q.is_approved === null).length;
      // §6.4 fix: refuse completion while tasks are open or quotes pending.
      if (openTasks || openQuotes) {
        throw Errors.unprocessable(
          'JOB_NOT_READY',
          [openTasks && `${openTasks} task${openTasks > 1 ? 's' : ''} open`, openQuotes && `${openQuotes} quote${openQuotes > 1 ? 's' : ''} awaiting the owner`]
            .filter(Boolean)
            .join(' · '),
        );
      }
      const totals = computeTotals(quotes.map(toQuote), this.fee(db));
      row.total_price = totals.total;
      row.status = 'completed';
      row.sos_active = false;
      this.touch(row);
      return { job: this.expand(db, row, u, { from: null }), ownerId: row.owner_id, total: totals.total };
    });
    await emitTo([out.ownerId], 'job_finished', { jobId, summary: `Receipt ready · ${formatUGX(out.total)}` });
    return out.job;
  }

  /**
   * Mechanic earnings from completed jobs (a job's completion time is its updated_at). The chart series
   * is the last 6 months for 'month', otherwise the last 7 days. `total` covers today for 'day', or the
   * whole charted period otherwise; `payouts` lists the 20 most recent jobs.
   */
  async earnings(range: EarningsRange): Promise<Earnings> {
    return read((db) => {
      const u = this.requireRole(db, 'mechanic');
      const done = db.jobs
        .filter((j) => j.mechanic_id === u.id && j.status === 'completed')
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      const today = startOfDay(new Date());
      const sum = (rows: JobRow[]) => rows.reduce((s, j) => s + Number(j.total_price), 0);
      const series: Earnings['series'] = [];
      // One bar per month (oldest first)…
      if (range === 'month') {
        for (let i = 5; i >= 0; i--) {
          const start = new Date(today.getFullYear(), today.getMonth() - i, 1);
          const end = new Date(today.getFullYear(), today.getMonth() - i + 1, 1);
          const rows = done.filter((j) => new Date(j.updated_at) >= start && new Date(j.updated_at) < end);
          series.push({ label: start.toLocaleDateString('en-GB', { month: 'short' }), date: toISODate(start), amount: sum(rows) });
        }
      } else {
        // …or one bar per day for the last week.
        for (let i = 6; i >= 0; i--) {
          const d = new Date(today);
          d.setDate(d.getDate() - i);
          const key = toISODate(d);
          const rows = done.filter((j) => toISODate(new Date(j.updated_at)) === key);
          series.push({ label: d.toLocaleDateString('en-GB', { weekday: 'narrow' }), date: key, amount: sum(rows) });
        }
      }
      const inRange = range === 'day' ? done.filter((j) => new Date(j.updated_at) >= today) : done.filter((j) => new Date(j.updated_at) >= new Date(series[0].date));
      return {
        total: sum(inRange),
        today: sum(done.filter((j) => new Date(j.updated_at) >= today)),
        jobs: inRange.length,
        series,
        payouts: done.slice(0, 20).map((j) => {
          const v = db.vehicles.find((x) => x.id === j.vehicle_id);
          return {
            jobId: j.id,
            serviceType: j.service_type,
            vehicle: v ? `${v.model}` : 'Vehicle',
            amount: Number(j.total_price),
            date: j.updated_at,
          };
        }),
      };
    });
  }

  /** Reviews the mechanic has received, newest first, with the owner's name and job type. */
  async myReviews(): Promise<{ reviews: MechanicReview[]; average: number; count: number }> {
    return read((db) => {
      const u = this.requireRole(db, 'mechanic', { allowPending: true });
      const reviews = db.reviews
        .filter((r) => r.mechanic_id === u.id)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((r) => ({
          ...toReview(r),
          ownerName: db.users.find((x) => x.id === r.owner_id)?.full_name ?? 'Owner',
          serviceType: db.jobs.find((j) => j.id === r.job_id)?.service_type ?? '',
        }));
      return { reviews, average: mechanicRating(db, u.id), count: reviews.length };
    });
  }

  // ─── Local-mode stand-in for the web admin portal ───────────────────────────

  /** Admin approval happens on the web portal; in local mode the pending mechanic can self-approve. */
  async devApproveSelf(): Promise<User> {
    const user = await tx((db) => {
      const u = this.requireRole(db, 'mechanic', { allowPending: true });
      u.status = 'active';
      return toUser(u);
    });
    await emitTo([user.id], 'mechanic_approved', {} as RealtimePayload);
    return user;
  }

  /** Developer tool: deletes all local data (every account, car and job) and signs out. */
  async devWipe(): Promise<void> {
    await tx((db) => {
      Object.assign(db, {
        seq: {},
        users: [],
        vehicles: [],
        jobs: [],
        job_checklists: [],
        parts_quotes: [],
        reviews: [],
        system_config: [],
        job_extras: [],
        auth_tokens: [],
      });
    });
    this.setAuth(null);
  }
}
