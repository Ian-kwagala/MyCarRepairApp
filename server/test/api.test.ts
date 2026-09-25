/**
 * API v1 integration tests (§14.2): every rule the apps rely on, against a real PostgreSQL database,
 * plus Socket.io scoping (IT02/03/04/10: dispatch, first-come, no cross-contamination).
 * Needs TEST_DATABASE_URL (default: local Postgres on 5433, database mycarrepair_test).
 */
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';

import { io as connect, type Socket } from 'socket.io-client';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@127.0.0.1:5433/mycarrepair_test';
process.env.ADMIN_PASSWORD = 'admin-test';
process.env.LOGIN_RATE_LIMIT = '1000';

// Stand-in for Google's OAuth and FCM endpoints, so push runs end to end without a Firebase project.
const { generateKeyPairSync, createVerify } = await import('node:crypto');
const http = await import('node:http');
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const fcmCalls: { path: string; auth: string; message: Json }[] = [];
const fcmDead = new Set<string>();
const google = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.url === '/token') {
      const [h, p, sig] = (new URLSearchParams(raw).get('assertion') ?? '').split('.');
      const ok = !!sig && createVerify('RSA-SHA256').update(`${h}.${p}`).verify(publicKey, Buffer.from(sig, 'base64url'));
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' }).end(JSON.stringify({ access_token: 'fake-access', expires_in: 3600 }));
      return;
    }
    const { message } = JSON.parse(raw);
    fcmCalls.push({ path: req.url ?? '', auth: req.headers.authorization ?? '', message });
    if (fcmDead.has(message.token)) res.writeHead(404).end(JSON.stringify({ error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } }));
    else res.writeHead(200).end('{}');
  });
});
await new Promise<void>((r) => google.listen(0, r));
const googleBase = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;
process.env.FCM_API_BASE = googleBase;
process.env.FCM_SERVICE_ACCOUNT = JSON.stringify({
  project_id: 'mcr-test',
  client_email: 'push@mcr-test.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  token_uri: `${googleBase}/token`,
});

const { createServer } = await import('node:http');
const { createApp } = await import('../src/app');
const { migrate, pool } = await import('../src/db');
const { attachRealtime, closeRealtime } = await import('../src/realtime');

let base = '';
const server = createServer(createApp());
const sockets: Socket[] = [];

// 1×1 PNG, so uploads pass content sniffing.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

async function call(method: string, path: string, opts: { token?: string; body?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`${base}/api/v1${path}`, { method, headers, body });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : undefined) as Json };
}

async function register(role: 'owner' | 'mechanic', email: string, extra: Record<string, string> = {}) {
  const r = await call('POST', '/auth/register', {
    body: { fullName: email.split('@')[0], email, phone: `07${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, password: 'secret1', role, ...extra },
  });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  return r.json as { user: Json; accessToken: string; refreshToken: string };
}

async function approve(userId: number) {
  const res = await fetch(`${base}/admin/users/${userId}/approve`, {
    method: 'POST',
    redirect: 'manual',
    headers: { Authorization: `Basic ${Buffer.from('admin:admin-test').toString('base64')}`, Origin: base },
  });
  assert.equal(res.status, 303);
}

async function mechanic(email: string, lat: number, lng: number) {
  const s = await register('mechanic', email, { garageName: 'Garage', garageLocation: 'Kampala' });
  await approve(s.user.id);
  assert.equal((await call('POST', '/me/location', { token: s.accessToken, body: { lat, lng } })).status, 204);
  assert.equal((await call('PATCH', '/mechanic/status', { token: s.accessToken, body: { isOnline: true } })).json.isOnline, true);
  return s;
}

function listen(token: string) {
  const events: { event: string; payload: Json }[] = [];
  const s = connect(base, { transports: ['websocket'], auth: { token } });
  s.onAny((event, payload) => events.push({ event, payload }));
  sockets.push(s);
  return new Promise<{ socket: Socket; events: typeof events }>((resolve, reject) => {
    s.on('connect', () => resolve({ socket: s, events }));
    s.on('connect_error', reject);
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function eventually(fn: () => boolean, what: string) {
  for (let i = 0; i < 40; i++) {
    if (fn()) return;
    await wait(50);
  }
  assert.fail(`timed out waiting for ${what}`);
}

const KAMPALA = { lat: 0.3136, lng: 32.5811 };

async function ownerWithCar(email: string) {
  const o = await register('owner', email);
  const form = new FormData();
  for (const [k, v] of Object.entries({ make: 'Subaru', model: 'Forester', year: '2010', plateNumber: 'UAZ 901K', fuelType: 'Petrol', transmission: 'Automatic' })) form.append(k, v);
  const v = await call('POST', '/vehicles', { token: o.accessToken, form });
  return { ...o, vehicleId: v.json.id as number };
}

before(async () => {
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await migrate();
  attachRealtime(server);
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  sockets.forEach((s) => s.disconnect());
  closeRealtime();
  await new Promise((r) => server.close(r));
  await new Promise((r) => google.close(r));
  await pool.end();
});

describe('auth', () => {
  test('owner active, mechanic pending and limited to /me until approved', async () => {
    const o = await register('owner', 'o1@x.ug');
    assert.equal(o.user.status, 'active');
    assert.equal(o.user.password, undefined);
    const m = await register('mechanic', 'm1@x.ug', { garageName: 'G', garageLocation: 'L' });
    assert.equal(m.user.status, 'pending');
    assert.equal((await call('GET', '/me', { token: m.accessToken })).status, 200);
    assert.equal((await call('GET', '/mechanic/jobs?tab=bookings', { token: m.accessToken })).status, 403);

    const live = await listen(m.accessToken);
    await approve(m.user.id);
    await eventually(() => live.events.some((e) => e.event === 'mechanic_approved'), 'mechanic_approved');
    assert.equal((await call('GET', '/mechanic/jobs?tab=bookings', { token: m.accessToken })).status, 200);
  });

  test('duplicate email, wrong role or password, refresh rotation, logout', async () => {
    const o = await register('owner', 'o2@x.ug');
    assert.equal((await call('POST', '/auth/register', { body: { fullName: 'Dup', email: 'O2@x.ug', phone: '0701000000', password: 'secret1', role: 'owner' } })).status, 409);
    assert.equal((await call('POST', '/auth/login', { body: { email: 'o2@x.ug', password: 'secret1', role: 'mechanic' } })).status, 401);
    assert.equal((await call('POST', '/auth/login', { body: { email: 'o2@x.ug', password: 'nope', role: 'owner' } })).status, 401);
    const login = await call('POST', '/auth/login', { body: { phone: o.user.phone, password: 'secret1', role: 'owner' } });
    assert.equal(login.status, 200);

    const r1 = await call('POST', '/auth/refresh', { body: { refreshToken: o.refreshToken } });
    assert.equal(r1.status, 200);
    assert.equal((await call('POST', '/auth/refresh', { body: { refreshToken: o.refreshToken } })).status, 401, 'old refresh token is single-use');
    await call('POST', '/auth/logout', { token: r1.json.accessToken, body: { refreshToken: r1.json.refreshToken } });
    assert.equal((await call('POST', '/auth/refresh', { body: { refreshToken: r1.json.refreshToken } })).status, 401, 'logout revokes');
    assert.equal((await call('GET', '/me', { token: 'garbage' })).status, 401);
  });

  test('password reset with a one-time code', async () => {
    const o = await register('owner', 'o3@x.ug');
    const f = await call('POST', '/auth/forgot-password', { body: { identifier: 'o3@x.ug' } });
    assert.equal(f.json.verification, 'otp');
    const { rows } = await pool.query(`SELECT code_hint FROM password_resets WHERE user_id = $1`, [o.user.id]);
    assert.equal((await call('POST', '/auth/reset-password', { body: { identifier: 'o3@x.ug', code: '000000x', password: 'newpass1' } })).status, 400);
    assert.equal((await call('POST', '/auth/reset-password', { body: { identifier: 'o3@x.ug', code: rows[0].code_hint, password: 'newpass1' } })).status, 204);
    assert.equal((await call('POST', '/auth/login', { body: { email: 'o3@x.ug', password: 'newpass1', role: 'owner' } })).status, 200);
    assert.equal((await call('POST', '/auth/refresh', { body: { refreshToken: o.refreshToken } })).status, 401, 'reset revokes sessions');
  });
});

describe('vehicles', () => {
  test('multipart create with photos, ownership, keepPhotos, delete', async () => {
    const o = await register('owner', 'v1@x.ug');
    const other = await register('owner', 'v2@x.ug');
    const form = new FormData();
    for (const [k, v] of Object.entries({ make: 'Toyota', model: 'Premio', year: '2008', plateNumber: 'ubk 482x', fuelType: 'Petrol', transmission: 'Automatic', tyreSize: '195/65 R15', color: '', mileage: '148500', lastServiceDate: '2026-04-06' })) form.append(k, v);
    form.append('photos', new Blob([PNG], { type: 'image/png' }), 'a.png');
    form.append('photos', new Blob([PNG], { type: 'image/png' }), 'b.png');
    const c = await call('POST', '/vehicles', { token: o.accessToken, form });
    assert.equal(c.status, 201, JSON.stringify(c.json));
    assert.equal(c.json.plateNumber, 'UBK 482X');
    assert.equal(c.json.color, null);
    assert.equal(c.json.photos.length, 2);
    const img = await fetch(c.json.photos[0]);
    assert.equal(img.headers.get('content-type'), 'image/png');

    const bad = new FormData();
    bad.append('photos', new Blob([Buffer.from('<script>')], { type: 'image/png' }), 'x.png');
    assert.equal((await call('PATCH', `/vehicles/${c.json.id}`, { token: o.accessToken, form: bad })).status, 400, 'content sniffing');

    assert.equal((await call('GET', `/vehicles/${c.json.id}`, { token: other.accessToken })).status, 404);
    const keep = new FormData();
    keep.append('keepPhotos', JSON.stringify([c.json.photos[1]]));
    keep.append('mileage', '150000');
    const u = await call('PATCH', `/vehicles/${c.json.id}`, { token: o.accessToken, form: keep });
    assert.deepEqual(u.json.photos, [c.json.photos[1]]);
    assert.equal(u.json.mileage, 150000);
    assert.equal(u.json.make, 'Toyota');
    assert.equal((await call('DELETE', `/vehicles/${c.json.id}`, { token: o.accessToken })).status, 204);
    assert.equal((await call('GET', '/vehicles', { token: o.accessToken })).json.length, 0);
  });
});

describe('jobs', () => {
  test('SOS → nearest mechanic only → first-come claim → arrival → quote → finish lock → receipt → one review', async () => {
    const near = await mechanic('near@x.ug', 0.33, 32.57); // ~2.2 km
    const near2 = await mechanic('near2@x.ug', 0.32, 32.58); // ~0.7 km
    const far = await mechanic('far@x.ug', 0.5, 32.9); // ~41 km
    const owner = await ownerWithCar('sos@x.ug');
    const [nearLive, farLive, ownerLive] = await Promise.all([listen(near.accessToken), listen(far.accessToken), listen(owner.accessToken)]);

    const sos = await call('POST', '/sos', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, issue: 'Flat Tire', ...KAMPALA } });
    assert.equal(sos.status, 201);
    assert.ok(sos.json.nearbyCount >= 2);
    const jobId = sos.json.jobId as number;
    await eventually(() => nearLive.events.some((e) => e.event === 'new_job_pushed' && e.payload.jobId === jobId), 'dispatch to near');
    assert.ok(!farLive.events.some((e) => e.event === 'new_job_pushed'), 'far mechanic not alerted');
    assert.equal((await call('POST', '/sos', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, issue: 'Towing', ...KAMPALA } })).status, 409);

    // Distance but no exact owner location before acceptance (§13.1).
    const open = await call('GET', `/jobs/${jobId}`, { token: near.accessToken });
    assert.equal(open.json.owner.locationLat, null);
    assert.equal(open.json.owner.phone, null);
    assert.ok(Math.abs(open.json.distanceKm - 2.2) < 0.3);
    assert.equal((await call('GET', `/jobs/${jobId}`, { token: far.accessToken })).status, 404);
    assert.equal((await call('GET', '/mechanic/jobs?tab=sos', { token: far.accessToken })).json.length, 0);

    // Two mechanics accept at the same time: exactly one wins.
    const [a, b] = await Promise.all([
      call('POST', `/mechanic/jobs/${jobId}/accept`, { token: near.accessToken }),
      call('POST', `/mechanic/jobs/${jobId}/accept`, { token: near2.accessToken }),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409]);
    const winner = a.status === 200 ? near : near2;
    const loser = a.status === 200 ? near2 : near;
    await eventually(() => ownerLive.events.some((e) => e.event === 'job_taken'), 'job_taken');
    assert.equal((await call('POST', `/sos/${jobId}/cancel`, { token: owner.accessToken })).status, 409);
    assert.equal((await call('GET', `/jobs/${jobId}`, { token: loser.accessToken })).status, 409);

    // Location relay while en route.
    await call('POST', '/me/location', { token: winner.accessToken, body: { lat: 0.315, lng: 32.58 } });
    await eventually(() => ownerLive.events.some((e) => e.event === 'mechanic_location' && e.payload.lat === 0.315), 'mechanic_location');

    const arrived = await call('POST', `/mechanic/jobs/${jobId}/arrived`, { token: winner.accessToken });
    assert.equal(arrived.json.status, 'fixing');
    assert.equal(arrived.json.checklist.length, 4);
    assert.equal((await call('POST', `/mechanic/jobs/${jobId}/complete`, { token: winner.accessToken })).status, 422);

    for (const t of arrived.json.checklist) {
      const f = new FormData();
      f.append('isCompleted', 'true');
      if (t === arrived.json.checklist[0]) f.append('photo', new Blob([PNG], { type: 'image/png' }), 'proof.png');
      const r = await call('PATCH', `/mechanic/tasks/${t.id}`, { token: winner.accessToken, form: f });
      assert.equal(r.status, 200, JSON.stringify(r.json));
    }
    await eventually(() => ownerLive.events.some((e) => e.event === 'task_update'), 'task_update');

    const qf = new FormData();
    qf.append('partName', 'Tyre 215/65 R16');
    qf.append('price', '210000');
    qf.append('photos', new Blob([PNG], { type: 'image/png' }), 'part.png');
    const quote = await call('POST', `/mechanic/jobs/${jobId}/quotes`, { token: winner.accessToken, form: qf });
    assert.equal(quote.status, 201);
    assert.equal(quote.json.isApproved, null);
    await eventually(() => ownerLive.events.some((e) => e.event === 'new_quote_alert' && e.payload.quoteId === quote.json.id), 'new_quote_alert');
    assert.equal((await call('POST', `/mechanic/jobs/${jobId}/complete`, { token: winner.accessToken })).json.error.code, 'JOB_NOT_READY');

    assert.equal((await call('POST', `/quotes/${quote.json.id}/decision`, { token: winner.accessToken, body: { decision: 'approve' } })).status, 403);
    assert.equal((await call('POST', `/quotes/${quote.json.id}/decision`, { token: owner.accessToken, body: { decision: 'approve' } })).json.isApproved, true);
    assert.equal((await call('POST', `/quotes/${quote.json.id}/decision`, { token: owner.accessToken, body: { decision: 'reject' } })).status, 409);

    const done = await call('POST', `/mechanic/jobs/${jobId}/complete`, { token: winner.accessToken });
    assert.equal(done.json.status, 'completed');
    assert.equal(done.json.totalPrice, 260000);
    assert.equal(done.json.sosActive, false);
    await eventually(() => ownerLive.events.some((e) => e.event === 'job_finished'), 'job_finished');

    const receipt = await call('GET', `/jobs/${jobId}/receipt`, { token: owner.accessToken });
    const pdf = await fetch(receipt.json.url);
    assert.equal(pdf.headers.get('content-type'), 'application/pdf');
    assert.equal((await pdf.arrayBuffer()).byteLength > 1000, true);
    assert.equal((await fetch(receipt.json.url.replace(/sig=[0-9a-f]+/, 'sig=00'))).status, 403);

    assert.equal((await call('POST', `/jobs/${jobId}/review`, { token: owner.accessToken, body: { rating: 5, tags: ['On time'], feedback: 'Great' } })).status, 201);
    assert.equal((await call('POST', `/jobs/${jobId}/review`, { token: owner.accessToken, body: { rating: 4 } })).status, 409);
    const reviews = await call('GET', '/mechanic/reviews', { token: winner.accessToken });
    assert.equal(reviews.json.reviews[0].feedback, '[On time] Great');
    const earnings = await call('GET', '/mechanic/earnings?range=week', { token: winner.accessToken });
    assert.equal(earnings.json.today, 260000);
    const stats = await call('GET', '/mechanic/stats', { token: winner.accessToken });
    assert.deepEqual(stats.json, { totalJobs: 1, activeJobs: 0, rating: 5 });
  });

  test('bookings: past dates rejected, checklist, decline cancels; diagnostics keep symptoms; SOS cancel → cancelled', async () => {
    const m = await mechanic('bk@x.ug', 0.31, 32.58);
    const owner = await ownerWithCar('bk-owner@x.ug');
    assert.equal((await call('POST', '/jobs/bookings', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, serviceType: 'Oil Change', scheduledDate: '2020-01-01' } })).status, 400);
    const bk = await call('POST', '/jobs/bookings', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, serviceType: 'Oil Change', scheduledDate: '2999-01-01', notes: 'Squeak' } });
    assert.equal(bk.status, 201);
    assert.equal(bk.json.checklist.length, 10);
    assert.equal(bk.json.scheduledDate, '2999-01-01');
    assert.ok((await call('GET', '/mechanic/jobs?tab=bookings', { token: m.accessToken })).json.some((j: Json) => j.id === bk.json.id));
    assert.equal((await call('POST', `/mechanic/jobs/${bk.json.id}/decline`, { token: m.accessToken })).status, 204);
    assert.equal((await call('GET', `/jobs/${bk.json.id}`, { token: owner.accessToken })).json.status, 'cancelled');

    const df = new FormData();
    df.append('vehicleId', String(owner.vehicleId));
    df.append('symptoms[]', 'Engine Light');
    df.append('symptoms[]', 'Overheating');
    df.append('photo', new Blob([PNG], { type: 'image/png' }), 'dash.png');
    const diag = await call('POST', '/jobs/diagnostics', { token: owner.accessToken, form: df });
    assert.equal(diag.status, 201, JSON.stringify(diag.json));
    assert.equal(diag.json.serviceType, 'Diagnostic: Engine Light, Overheating');

    const sos = await call('POST', '/sos', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, issue: 'Dead Battery', ...KAMPALA } });
    assert.equal((await call('POST', `/sos/${sos.json.jobId}/cancel`, { token: owner.accessToken })).status, 204);
    assert.equal((await call('GET', `/jobs/${sos.json.jobId}`, { token: owner.accessToken })).json.status, 'cancelled');
    const active = await call('GET', '/jobs?scope=active', { token: owner.accessToken });
    assert.deepEqual(active.json.map((j: Json) => j.id), [diag.json.id]);
  });

  test('events never reach other users (IT10)', async () => {
    const a = await ownerWithCar('iso-a@x.ug');
    const b = await ownerWithCar('iso-b@x.ug');
    const bLive = await listen(b.accessToken);
    await mechanic('iso-m@x.ug', 0.3136, 32.5811);
    await call('POST', '/sos', { token: a.accessToken, body: { vehicleId: a.vehicleId, issue: 'Low Fuel', ...KAMPALA } });
    await wait(300);
    assert.equal(bLive.events.length, 0);
    assert.equal((await call('GET', '/jobs?scope=active', { token: b.accessToken })).json.length, 0);
  });
});

describe('admin console', () => {
  const basic = (pass = 'admin-test') => ({ Authorization: `Basic ${Buffer.from(`staff:${pass}`).toString('base64')}` });
  const get = async (path: string, headers: Record<string, string> = basic()) => {
    const res = await fetch(`${base}/admin${path}`, { headers });
    return { status: res.status, html: await res.text() };
  };
  const post = (path: string, form: Record<string, string>, origin = base) =>
    fetch(`${base}/admin${path}`, { method: 'POST', redirect: 'manual', headers: { ...basic(), Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });

  test('needs the admin password and blocks cross-site posts', async () => {
    assert.equal((await get('/', {})).status, 401);
    assert.equal((await get('/', basic('wrong'))).status, 401);
    assert.equal((await post('/settings/maintenance', { mode: 'on' }, 'https://evil.example')).status, 403);
    // Browsers only send the real Origin on our own form posts if the page allows it.
    assert.equal((await fetch(`${base}/admin`, { headers: basic() })).headers.get('referrer-policy'), 'same-origin');
    const raw = (headers: Record<string, string>) =>
      fetch(`${base}/admin/settings/maintenance`, { method: 'POST', redirect: 'manual', headers: { ...basic(), 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body: 'mode=off' });
    assert.equal((await raw({ 'Sec-Fetch-Site': 'cross-site', Origin: base })).status, 403, 'browser says cross-site');
    assert.equal((await raw({ Origin: 'null' })).status, 403, 'opaque origin');
    assert.equal((await raw({ 'Sec-Fetch-Site': 'same-origin' })).status, 303, 'browser says same-origin');
  });

  test('every page renders, with user data escaped', async () => {
    const owner = await ownerWithCar('adm-owner@x.ug');
    await call('PATCH', '/me', { token: owner.accessToken, body: { fullName: '<script>alert(1)</script>' } });
    const m = await mechanic('adm-mech@x.ug', 0.3136, 32.5811);
    const sos = await call('POST', '/sos', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, issue: 'Flat Tire', ...KAMPALA } });
    assert.equal((await call('POST', `/mechanic/jobs/${sos.json.jobId}/accept`, { token: m.accessToken })).status, 200);
    const pending = await register('mechanic', 'adm-pending@x.ug', { garageName: 'Pending Garage', garageLocation: 'Ntinda' });

    const pages: [string, string][] = [
      ['/', 'Live jobs'],
      ['/approvals', 'Pending Garage'],
      ['/jobs', `#${sos.json.jobId}`],
      ['/jobs?status=active&type=sos&q=UAZ', `#${sos.json.jobId}`],
      [`/jobs/${sos.json.jobId}`, 'Job card'],
      ['/owners?q=adm-owner', 'adm-owner@x.ug'],
      ['/mechanics?status=online', 'adm-mech'],
      [`/users/${owner.user.id}`, 'Garage (1)'],
      [`/users/${m.user.id}`, 'Latest reviews'],
      ['/resets', 'Active codes'],
      ['/settings', 'Maintenance mode'],
    ];
    for (const [path, text] of pages) {
      const r = await get(path);
      assert.equal(r.status, 200, path);
      assert.ok(r.html.includes(text), `${path} should show "${text}"`);
      assert.ok(!r.html.includes('<script>alert(1)'), `${path} escapes user data`);
    }
    assert.ok((await get('/owners')).html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
    assert.equal((await get('/jobs/999999')).status, 404);
    assert.match((await get('/assets/admin.js')).html, /data-confirm|dataset\.confirm/);

    // Approve from the approvals page returns there; an off-site "back" falls back to /admin.
    const ok = await post(`/users/${pending.user.id}/approve`, { back: '/admin/approvals' });
    assert.equal(ok.status, 303);
    assert.equal(ok.headers.get('location'), '/admin/approvals?notice=approved');
    const evil = await post(`/users/${pending.user.id}/suspend`, { back: '//evil.example/admin' });
    assert.equal(evil.headers.get('location'), '/admin?notice=suspended');
  });

  test('settings reach the apps through /config', async () => {
    assert.equal((await post('/settings', { support_phone: 'call me', min_app_version: '1.0.0' })).headers.get('location'), '/admin/settings?error=phone');
    assert.equal((await post('/settings', { support_phone: '+256 772 123456', min_app_version: '1.2.0' })).status, 303);
    assert.equal((await post('/settings/maintenance', { mode: 'on' })).status, 303);
    let cfg = (await call('GET', '/config')).json;
    assert.equal(cfg.supportPhone, '+256 772 123456');
    assert.equal(cfg.minAppVersion, '1.2.0');
    assert.equal(cfg.maintenance, true);
    assert.ok((await get('/')).html.includes('Maintenance mode is on'));
    await post('/settings/maintenance', { mode: 'off' });
    await post('/settings', { support_phone: '+256700000000', min_app_version: '1.0.0' });
    cfg = (await call('GET', '/config')).json;
    assert.equal(cfg.maintenance, false);
  });
});

describe('push notifications (FCM)', () => {
  const ENTEBBE = { lat: 0.0512, lng: 32.4637 }; // away from the other tests' mechanics
  const registerToken = async (token: string, t: string) =>
    assert.equal((await call('POST', '/me/push-token', { token: t, body: { token, platform: 'android' } })).status, 204);

  test('an SOS reaches mechanics whose app is closed; open apps get it live; dead tokens are dropped', async () => {
    const closed = await mechanic('push-closed@x.ug', ENTEBBE.lat + 0.01, ENTEBBE.lng);
    const open = await mechanic('push-open@x.ug', ENTEBBE.lat, ENTEBBE.lng + 0.01);
    const gone = await mechanic('push-gone@x.ug', ENTEBBE.lat - 0.01, ENTEBBE.lng);
    await registerToken('fcm-closed-phone', closed.accessToken);
    await registerToken('fcm-open-phone', open.accessToken);
    await registerToken('fcm-uninstalled', gone.accessToken);
    fcmDead.add('fcm-uninstalled');
    await listen(open.accessToken);

    const owner = await ownerWithCar('push-owner@x.ug');
    const sos = await call('POST', '/sos', { token: owner.accessToken, body: { vehicleId: owner.vehicleId, issue: 'Car Crash', ...ENTEBBE } });
    assert.equal(sos.status, 201);
    const jobId = sos.json.jobId;

    await eventually(() => fcmCalls.some((c) => c.message.token === 'fcm-closed-phone'), 'FCM message to the closed app');
    const msg = fcmCalls.find((c) => c.message.token === 'fcm-closed-phone')!;
    assert.equal(msg.path, '/v1/projects/mcr-test/messages:send');
    assert.equal(msg.auth, 'Bearer fake-access');
    assert.equal(msg.message.android.priority, 'HIGH');
    assert.equal(msg.message.data.channelId, 'sos');
    assert.equal(msg.message.data.title, 'New SOS · Car Crash');
    assert.equal(JSON.parse(msg.message.data.body).url, `/mechanic/incoming/${jobId}`);
    for (const v of Object.values(msg.message.data)) assert.equal(typeof v, 'string', 'FCM data values must be strings');

    await eventually(() => fcmCalls.some((c) => c.message.token === 'fcm-uninstalled'), 'FCM attempt to the dead token');
    for (let i = 0; i < 40 && (await pool.query(`SELECT 1 FROM device_tokens WHERE token = 'fcm-uninstalled'`)).rowCount; i++) await wait(50);
    assert.equal((await pool.query(`SELECT 1 FROM device_tokens WHERE token = 'fcm-uninstalled'`)).rowCount, 0, 'dead token removed');
    assert.ok(!fcmCalls.some((c) => c.message.token === 'fcm-open-phone'), 'a connected app gets the socket event, not a push');
  });

  test('admin can send a test notification to a phone', async () => {
    const o = await register('owner', 'push-test@x.ug');
    await registerToken('fcm-owner-phone', o.accessToken);
    const res = await fetch(`${base}/admin/users/${o.user.id}/test-push`, {
      method: 'POST',
      redirect: 'manual',
      headers: { Authorization: `Basic ${Buffer.from('staff:admin-test').toString('base64')}`, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ back: `/admin/users/${o.user.id}` }),
    });
    assert.equal(res.headers.get('location'), `/admin/users/${o.user.id}?notice=push-sent`);
    await eventually(() => fcmCalls.some((c) => c.message.token === 'fcm-owner-phone' && c.message.data.title === 'Test from MyCarRepair'), 'test push');
    const page = await (await fetch(`${base}/admin/settings`, { headers: { Authorization: `Basic ${Buffer.from('staff:admin-test').toString('base64')}` } })).text();
    assert.ok(page.includes('Phones get SOS alerts'), 'settings show push as on');
  });
});
