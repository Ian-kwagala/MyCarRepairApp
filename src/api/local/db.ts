/**
 * On-device data store used while the backend/data source is being decided.
 *
 * Rows use the exact column names of the web platform's PostgreSQL tables (snake_case, CSV photo
 * columns, tri-state is_approved) so the mappers are the same ones the API applies (§5.1).
 * It starts EMPTY — no seed data. Users create their own accounts, cars and jobs.
 */
import { Keys, kv } from '@/services/storage';

export interface UserRow {
  id: number;
  full_name: string;
  email: string;
  password: string; // salted SHA-256 (bcrypt on the server)
  phone: string | null;
  role: 'owner' | 'mechanic' | 'admin';
  status: 'active' | 'pending' | 'suspended';
  location_lat: number | null;
  location_lng: number | null;
  is_online: boolean;
  garage_name: string | null;
  garage_location: string | null;
  expertise: string | null;
  created_at: string;
}

export interface VehicleRow {
  id: number;
  owner_id: number;
  make: string;
  model: string;
  year: number;
  plate_number: string;
  fuel_type: string;
  transmission: string;
  tyre_size: string | null;
  color: string | null;
  mileage: number | null;
  last_service_date: string | null;
  photos: string | null; // csv paths
  created_at: string;
}

export interface JobRow {
  id: number;
  owner_id: number;
  mechanic_id: number | null;
  vehicle_id: number;
  service_type: string;
  status: 'pending' | 'accepted' | 'diagnosing' | 'fixing' | 'ready' | 'completed' | 'cancelled';
  total_price: number;
  sos_active: boolean;
  start_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChecklistRow {
  id: number;
  job_id: number;
  task_description: string;
  is_completed: boolean;
  photo_url: string | null;
  completed_at: string | null;
}

export interface QuoteRow {
  id: number;
  job_id: number;
  part_name: string;
  price: number;
  photo_evidence: string | null; // csv paths
  is_approved: boolean | null; // NULL = pending
  created_at: string;
}

export interface ReviewRow {
  id: number;
  job_id: number;
  mechanic_id: number;
  owner_id: number;
  rating: number;
  feedback: string | null;
  created_at: string;
}

/** Auxiliary (not part of the shared schema): booking fields the jobs table has no column for. */
export interface JobExtraRow {
  job_id: number;
  scheduled_date: string | null;
  notes: string | null;
  photo: string | null;
}

export interface LocalDb {
  version: 1;
  seq: Record<string, number>;
  users: UserRow[];
  vehicles: VehicleRow[];
  jobs: JobRow[];
  job_checklists: ChecklistRow[];
  parts_quotes: QuoteRow[];
  reviews: ReviewRow[];
  system_config: { key: string; value: string }[];
  // auxiliary
  job_extras: JobExtraRow[];
  auth_tokens: { token: string; user_id: number; kind: 'access' | 'refresh'; created_at: string }[];
}

const empty = (): LocalDb => ({
  version: 1,
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

let cache: LocalDb | null = null;
let chain: Promise<unknown> = Promise.resolve();

async function load(): Promise<LocalDb> {
  if (!cache) cache = { ...empty(), ...(await kv.get<Partial<LocalDb>>(Keys.localDb, {})) } as LocalDb;
  return cache;
}

/** Read-only access. */
export async function read<T>(fn: (db: LocalDb) => T): Promise<T> {
  await chain;
  return fn(await load());
}

/** Serialized read-modify-write, like a DB transaction (keeps first-come claims atomic). */
export function tx<T>(fn: (db: LocalDb) => T | Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    const db = await load();
    const snapshot = JSON.stringify(db);
    try {
      const result = await fn(db);
      await kv.set(Keys.localDb, db);
      return result;
    } catch (e) {
      cache = JSON.parse(snapshot) as LocalDb; // roll back
      throw e;
    }
  });
  chain = run.catch(() => undefined);
  return run;
}

export function nextId(db: LocalDb, table: string): number {
  const n = (db.seq[table] ?? 0) + 1;
  db.seq[table] = n;
  return n;
}

export const now = () => new Date().toISOString();

/** Photos are stored as a comma-separated column; each entry is URI-encoded so data: URIs survive. */
export function joinPaths(paths: string[]): string | null {
  return paths.length ? paths.map((p) => encodeURIComponent(p)).join(',') : null;
}

export function splitPaths(csv: string | null): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .filter(Boolean)
    .map((p) => {
      try {
        return decodeURIComponent(p);
      } catch {
        return p;
      }
    });
}
