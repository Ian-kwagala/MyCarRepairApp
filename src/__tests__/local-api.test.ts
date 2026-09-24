/// <reference types="jest" />
/**
 * Business rules of the on-device backend (mirrors the §7 contract and the web rules):
 * role/ownership guards, first-come claim (409), parts approval, finish lock (422),
 * SOS cancel → cancelled, geo-dispatch radius, one review per job.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

import { ApiError } from '@/api/errors';
import { LocalApiClient } from '@/api/local/client';
import type { Session } from '@/api/types';

const KAMPALA = { lat: 0.3136, lng: 32.5811 };

async function setup() {
  await AsyncStorage.clear();
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LocalApiClient: Client } = require('@/api/local/client') as { LocalApiClient: typeof LocalApiClient };
  const owner = new Client();
  const mech = new Client();
  const mech2 = new Client();
  const o = await owner.register({ fullName: 'Sarah Nakato', email: 'sarah@x.ug', phone: '0772111222', password: 'secret1', role: 'owner' });
  const approve = async (c: LocalApiClient, email: string, name: string) => {
    const s: Session = await c.register({ fullName: name, email, phone: `07${Math.floor(Math.random() * 1e8)}`, password: 'secret1', role: 'mechanic', garageName: 'G', garageLocation: 'L' });
    await c.devApproveSelf();
    await c.setOnline(true);
    return s;
  };
  await approve(mech, 'joseph@x.ug', 'Joseph Okello');
  await approve(mech2, 'peter@x.ug', 'Peter M');
  await mech.updateLocation({ lat: 0.33, lng: 32.57 }); // ~2.2 km
  await mech2.updateLocation({ lat: 0.5, lng: 32.9 }); // ~41 km — outside 10 km
  const v = await owner.createVehicle({
    make: 'Toyota', model: 'Premio', year: 2008, plateNumber: 'ubk 482x', fuelType: 'Petrol', transmission: 'Automatic',
    tyreSize: '195/65 R15', color: null, mileage: 148500, lastServiceDate: null, photos: [],
  });
  return { owner, mech, mech2, o, v };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e) {
    // Duck-typed: jest.resetModules() gives each test run its own ApiError class.
    const err = e as ApiError;
    return err?.name === 'ApiError' ? `${err.status} ${err.code}` : String(e);
  }
};

describe('LocalApiClient business rules', () => {
  it('registers owners active and mechanics pending, and enforces role on login', async () => {
    await AsyncStorage.clear();
    const c = new LocalApiClient();
    const m = await c.register({ fullName: 'M', email: 'm@x.ug', phone: '0700000001', password: 'secret1', role: 'mechanic', garageName: 'G', garageLocation: 'L' });
    expect(m.user.status).toBe('pending');
    expect(await code(c.login({ identifier: 'm@x.ug', password: 'secret1', role: 'owner' }))).toBe('401 INVALID_CREDENTIALS');
    expect(await code(c.login({ identifier: '0700000001', password: 'secret1', role: 'mechanic' }))).toBe('OK');
    expect(await code(c.listMechanicJobs('sos'))).toBe('403 FORBIDDEN'); // pending mechanic
  });

  it('dispatches SOS to the nearest online mechanics within 10 km only', async () => {
    const { owner, mech, mech2, v } = await setup();
    expect(v.plateNumber).toBe('UBK 482X');
    const res = await owner.sendSos({ vehicleId: v.id, issue: 'Flat Tire', ...KAMPALA });
    expect(res.nearbyCount).toBe(1);
    expect((await mech.listMechanicJobs('sos')).map((j) => j.id)).toEqual([res.jobId]);
    expect(await mech2.listMechanicJobs('sos')).toEqual([]);
    expect(await code(owner.sendSos({ vehicleId: v.id, issue: 'Towing', ...KAMPALA }))).toBe('409 SOS_ALREADY_ACTIVE');
  });

  it('hides the owner location from mechanics until the job is accepted', async () => {
    const { owner, mech, v } = await setup();
    const { jobId } = await owner.sendSos({ vehicleId: v.id, issue: 'Flat Tire', ...KAMPALA });
    const open = await mech.getJob(jobId);
    expect(open.owner?.locationLat).toBeNull();
    expect(open.owner?.phone).toBeNull();
    expect(open.distanceKm).toBeCloseTo(2.2, 0);
    await mech.acceptJob(jobId);
    const mine = await mech.getJob(jobId);
    expect(mine.owner?.locationLat).toBeCloseTo(KAMPALA.lat, 4);
  });

  it('stores salted password verifiers and rejects wrong passwords', async () => {
    await AsyncStorage.clear();
    jest.resetModules();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { LocalApiClient: Client } = require('@/api/local/client') as { LocalApiClient: typeof LocalApiClient };
    const c = new Client();
    await c.register({ fullName: 'A', email: 'a@x.ug', phone: '0700000011', password: 'secret1', role: 'owner' });
    await c.register({ fullName: 'B', email: 'b@x.ug', phone: '0700000012', password: 'secret1', role: 'owner' });
    // Read through the same (reset) module instance the client wrote to.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const storage = (mod.default ?? mod) as typeof AsyncStorage;
    const raw = JSON.parse((await storage.getItem('mcr.localdb.v1'))!) as { users: { password: string }[] };
    const [a, b] = raw.users.map((u) => u.password);
    expect(a).toMatch(/^sha256i\$2000\$[0-9a-f]{32}\$/);
    expect(a).not.toEqual(b); // same password, different salt
    expect(await code(c.login({ identifier: 'a@x.ug', password: 'wrong', role: 'owner' }))).toBe('401 INVALID_CREDENTIALS');
    expect(await code(c.login({ identifier: 'a@x.ug', password: 'secret1', role: 'owner' }))).toBe('OK');
  });

  it('SOS cancel sets status cancelled (not completed)', async () => {
    const { owner, v } = await setup();
    const { jobId } = await owner.sendSos({ vehicleId: v.id, issue: 'Dead Battery', ...KAMPALA });
    await owner.cancelSos(jobId);
    expect((await owner.getJob(jobId)).status).toBe('cancelled');
  });

  it('runs a full job: first-come claim, arrival checklist, quote approval, finish lock, receipt, one review', async () => {
    const { owner, mech, mech2, v } = await setup();
    const { jobId } = await owner.sendSos({ vehicleId: v.id, issue: 'Flat Tire', ...KAMPALA });

    await mech.acceptJob(jobId);
    expect(await code(mech2.acceptJob(jobId))).toBe('409 JOB_ALREADY_TAKEN');
    expect(await code(owner.cancelSos(jobId))).toBe('409 JOB_NOT_CANCELLABLE');

    const arrived = await mech.markArrived(jobId);
    expect(arrived.status).toBe('fixing');
    expect(arrived.checklist!.map((t) => t.taskDescription)).toEqual(['Initial Inspection', 'Fluid Level Check', 'Diagnostic Scan', 'Safety Test']);

    expect(await code(mech.completeJob(jobId))).toBe('422 JOB_NOT_READY');
    for (const t of arrived.checklist!) await mech.updateTask(t.id, { isCompleted: true });

    const q1 = await mech.createQuote(jobId, { partName: 'Tyre', price: 210000, photos: [] });
    const q2 = await mech.createQuote(jobId, { partName: 'Valve', price: 15000, photos: [] });
    expect(q1.isApproved).toBeNull();
    expect(await code(mech.completeJob(jobId))).toBe('422 JOB_NOT_READY'); // quotes pending
    expect(await code(mech.decideQuote(q1.id, 'approve'))).toBe('403 FORBIDDEN'); // owners decide

    await owner.decideQuote(q1.id, 'approve');
    await owner.decideQuote(q2.id, 'reject');
    expect(await code(owner.decideQuote(q1.id, 'reject'))).toBe('409 QUOTE_ALREADY_DECIDED');

    const done = await mech.completeJob(jobId);
    expect(done.status).toBe('completed');
    expect(done.totalPrice).toBe(50000 + 210000);
    expect(done.sosActive).toBe(false);

    expect((await owner.getReceipt(jobId)).url).toMatch(/^file:/);
    await owner.submitReview(jobId, { rating: 5, tags: ['On time'], feedback: 'Great' });
    expect(await code(owner.submitReview(jobId, { rating: 4 }))).toBe('409 REVIEW_EXISTS');

    const reviews = await mech.myReviews();
    expect(reviews.average).toBe(5);
    expect(reviews.reviews[0].feedback).toBe('[On time] Great');
    const earnings = await mech.earnings('week');
    expect(earnings.today).toBe(260000);
  });

  it('guards ownership: other owners cannot see a job', async () => {
    const { owner, v } = await setup();
    const job = await owner.createBooking({ vehicleId: v.id, serviceType: 'Oil Change', scheduledDate: '2999-01-01' });
    expect(job.checklist).toHaveLength(10);
    const other = new LocalApiClient();
    await other.register({ fullName: 'Eve', email: 'eve@x.ug', phone: '0701999999', password: 'secret1', role: 'owner' });
    expect(await code(other.getJob(job.id))).toBe('404 NOT_FOUND');
    expect(await code(owner.createBooking({ vehicleId: v.id, serviceType: 'Oil Change', scheduledDate: '2000-01-01' }))).toBe('400 VALIDATION_ERROR');
  });

  it('declining a booking cancels it (web parity) and persists diagnostic symptoms', async () => {
    const { owner, mech, v } = await setup();
    const booking = await owner.createBooking({ vehicleId: v.id, serviceType: 'Brake Repair', scheduledDate: '2999-01-01' });
    await mech.declineJob(booking.id);
    expect((await owner.getJob(booking.id)).status).toBe('cancelled');
    const diag = await owner.createDiagnostic({ vehicleId: v.id, symptoms: ['Engine Light', 'Overheating'] });
    expect(diag.serviceType).toBe('Diagnostic: Engine Light, Overheating');
  });
});
