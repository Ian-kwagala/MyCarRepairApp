/**
 * RemoteApiClient — the §7 contract over HTTPS: JSON, `Authorization: Bearer <accessToken>`,
 * refresh on 401, uniform error envelope `{ error: { code, message } }`, multipart for photos.
 */
import { Platform } from 'react-native';

import type {
  AppConfig,
  ChecklistItem,
  Earnings,
  Job,
  LocalPhoto,
  MechanicStats,
  PartsQuote,
  Review,
  User,
  Vehicle,
} from '@/models';

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

type Tokens = Pick<Session, 'accessToken' | 'refreshToken'>;
type Body = Record<string, unknown> | FormData | undefined;

const TIMEOUT_MS = 20_000;

async function appendPhoto(form: FormData, field: string, p: LocalPhoto) {
  if (Platform.OS === 'web') {
    // Browsers need a real Blob (the picker gives data: or blob: URIs).
    form.append(field, await (await fetch(p.uri)).blob(), p.name);
    return;
  }
  // React Native FormData file part.
  form.append(field, { uri: p.uri, name: p.name, type: p.type } as unknown as Blob);
}

async function toForm(fields: Record<string, unknown>, files: Record<string, LocalPhoto[]>) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) v.forEach((x) => form.append(`${k}[]`, String(x)));
    else form.append(k, v === null ? '' : String(v));
  }
  for (const [k, list] of Object.entries(files)) for (const p of list) await appendPhoto(form, k, p);
  return form;
}

export class RemoteApiClient implements ApiClient {
  readonly mode = 'remote' as const;
  private tokens: Tokens | null = null;
  private tokenListener: ((t: Tokens | null) => void) | null = null;
  private refreshing: Promise<boolean> | null = null;

  constructor(private baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  setAuth(tokens: Tokens | null) {
    this.tokens = tokens;
  }

  onTokensChanged(cb: (t: Tokens | null) => void) {
    this.tokenListener = cb;
  }

  private async refresh(): Promise<boolean> {
    if (!this.tokens?.refreshToken) return false;
    this.refreshing ??= (async () => {
      try {
        const res = await this.raw('POST', '/auth/refresh', { refreshToken: this.tokens!.refreshToken }, false);
        const next = { accessToken: res.accessToken as string, refreshToken: (res.refreshToken as string) ?? this.tokens!.refreshToken };
        this.tokens = next;
        this.tokenListener?.(next);
        return true;
      } catch {
        this.tokens = null;
        this.tokenListener?.(null);
        return false;
      } finally {
        this.refreshing = null;
      }
    })();
    return this.refreshing;
  }

  private async raw(method: string, path: string, body?: Body, auth = true): Promise<any> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (auth && this.tokens?.accessToken) headers.Authorization = `Bearer ${this.tokens.accessToken}`;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { method, headers, body: payload, signal: ctrl.signal });
    } catch {
      throw Errors.network();
    } finally {
      clearTimeout(timer);
    }
    if (res.status === 204) return undefined;
    const text = await res.text();
    let json: any = undefined;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }
    if (!res.ok && res.status !== 202) {
      const err = json?.error;
      throw new ApiError(err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status}).`, res.status);
    }
    return json;
  }

  private async req<T>(method: string, path: string, body?: Body): Promise<T> {
    try {
      return await this.raw(method, path, body);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401 && (await this.refresh())) {
        return this.raw(method, path, body);
      }
      if (e instanceof ApiError && e.status === 401) this.tokenListener?.(null);
      throw e;
    }
  }

  private asSession(res: any): Session {
    const s: Session = { user: res.user, accessToken: res.accessToken ?? null, refreshToken: res.refreshToken ?? null };
    this.setAuth(s);
    return s;
  }

  // Auth & account
  async register(input: RegisterInput) {
    return this.asSession(await this.raw('POST', '/auth/register', { ...input }, false));
  }
  async login(input: LoginInput) {
    const isEmail = input.identifier.includes('@');
    return this.asSession(
      await this.raw(
        'POST',
        '/auth/login',
        { [isEmail ? 'email' : 'phone']: input.identifier.trim(), password: input.password, role: input.role },
        false,
      ),
    );
  }
  async logout(pushToken?: string | null) {
    try {
      // Revokes this device's refresh token and push token on the server.
      await this.raw('POST', '/auth/logout', { pushToken: pushToken ?? undefined, refreshToken: this.tokens?.refreshToken ?? undefined }, false);
    } finally {
      this.setAuth(null);
    }
  }
  forgotPassword(identifier: string) {
    return this.raw('POST', '/auth/forgot-password', { identifier }, false) as Promise<ForgotPasswordResult>;
  }
  async resetPassword(input: { identifier: string; code: string; password: string }) {
    await this.raw('POST', '/auth/reset-password', input, false);
  }
  me() {
    return this.req<User>('GET', '/me');
  }
  updateMe(patch: ProfilePatch) {
    return this.req<User>('PATCH', '/me', { ...patch });
  }
  async updateLocation(input: { lat: number; lng: number; accuracy?: number | null }) {
    await this.req('POST', '/me/location', { ...input });
  }
  async registerPushToken(token: string, platform: string) {
    await this.req('POST', '/me/push-token', { token, platform });
  }
  getConfig() {
    return this.raw('GET', '/config', undefined, false) as Promise<AppConfig>;
  }

  // Vehicles
  listVehicles() {
    return this.req<Vehicle[]>('GET', '/vehicles');
  }
  getVehicle(id: number) {
    return this.req<{ vehicle: Vehicle; recentJobs: Job[] }>('GET', `/vehicles/${id}`);
  }
  async createVehicle(input: VehicleCreate) {
    const { photos, ...fields } = input;
    return this.req<Vehicle>('POST', '/vehicles', await toForm(fields as Record<string, unknown>, { photos }));
  }
  async updateVehicle(id: number, patch: VehicleUpdate) {
    const { newPhotos, keepPhotos, ...fields } = patch;
    return this.req<Vehicle>(
      'PATCH',
      `/vehicles/${id}`,
      // keepPhotos goes as JSON so "keep none" ([]) is distinguishable from "unchanged" (absent).
      await toForm({ ...fields, keepPhotos: keepPhotos ? JSON.stringify(keepPhotos) : undefined } as Record<string, unknown>, { photos: newPhotos ?? [] }),
    );
  }
  async deleteVehicle(id: number) {
    await this.req('DELETE', `/vehicles/${id}`);
  }

  // Jobs (owner)
  createBooking(input: BookingInput) {
    return this.req<Job>('POST', '/jobs/bookings', { ...input });
  }
  async createDiagnostic(input: DiagnosticInput) {
    const { photo, ...fields } = input;
    return this.req<Job>('POST', '/jobs/diagnostics', await toForm(fields as Record<string, unknown>, { photo: photo ? [photo] : [] }));
  }
  sendSos(input: SosInput) {
    return this.req<SosResult>('POST', '/sos', { ...input });
  }
  async cancelSos(jobId: number) {
    await this.req('POST', `/sos/${jobId}/cancel`);
  }
  listJobs(scope: JobScope) {
    return this.req<Job[]>('GET', `/jobs?scope=${scope}&limit=50`);
  }
  getJob(id: number) {
    return this.req<Job>('GET', `/jobs/${id}`);
  }
  decideQuote(quoteId: number, decision: 'approve' | 'reject') {
    return this.req<PartsQuote>('POST', `/quotes/${quoteId}/decision`, { decision });
  }
  getReceipt(jobId: number) {
    return this.req<{ url: string }>('GET', `/jobs/${jobId}/receipt`);
  }
  submitReview(jobId: number, input: ReviewInput) {
    return this.req<Review>('POST', `/jobs/${jobId}/review`, { ...input });
  }

  // Mechanic
  setOnline(isOnline: boolean) {
    return this.req<User>('PATCH', '/mechanic/status', { isOnline });
  }
  listMechanicJobs(tab: MechanicTab, coords?: { lat: number; lng: number } | null) {
    const q = coords ? `&lat=${coords.lat}&lng=${coords.lng}` : '';
    return this.req<Job[]>('GET', `/mechanic/jobs?tab=${tab}${q}`);
  }
  mechanicStats() {
    return this.req<MechanicStats>('GET', '/mechanic/stats');
  }
  acceptJob(jobId: number) {
    return this.req<Job>('POST', `/mechanic/jobs/${jobId}/accept`);
  }
  async declineJob(jobId: number) {
    await this.req('POST', `/mechanic/jobs/${jobId}/decline`);
  }
  markArrived(jobId: number) {
    return this.req<Job>('POST', `/mechanic/jobs/${jobId}/arrived`);
  }
  async updateTask(taskId: number, input: { isCompleted: boolean; photo?: LocalPhoto | null }) {
    return this.req<ChecklistItem>(
      'PATCH',
      `/mechanic/tasks/${taskId}`,
      await toForm({ isCompleted: input.isCompleted }, { photo: input.photo ? [input.photo] : [] }),
    );
  }
  async createQuote(jobId: number, input: QuoteInput) {
    return this.req<PartsQuote>(
      'POST',
      `/mechanic/jobs/${jobId}/quotes`,
      await toForm({ partName: input.partName, price: input.price }, { photos: input.photos }),
    );
  }
  completeJob(jobId: number) {
    return this.req<Job>('POST', `/mechanic/jobs/${jobId}/complete`);
  }
  earnings(range: EarningsRange) {
    return this.req<Earnings>('GET', `/mechanic/earnings?range=${range}`);
  }
  myReviews() {
    return this.req<{ reviews: MechanicReview[]; average: number; count: number }>('GET', '/mechanic/reviews');
  }
}
