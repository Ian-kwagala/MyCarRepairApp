/// <reference types="jest" />
// Unit tests for the pure helper functions: money formatting, job stages, billing, the finish lock,
// review tags, phone numbers, service-due dates, distances, date grouping, shop order rules, job steps per service
// and booking dates.
import { ARRIVAL_CHECKLIST, DEFAULT_JOB_STEPS } from '@/constants/config';
import { bookingDay, composeFeedback, canFinish, computeTotals, isUpcomingBooking, parseFeedback, reminderTimes, serviceDueInDays, stageIndex, stagesFor, stepsFor } from '@/utils/jobs';
import { dateGroup, formatAmountInput, formatUGX, normalizePhone, parseAmount } from '@/utils/format';
import { distanceKm } from '@/utils/geo';
import { nextOrderStatuses, orderSteps, orderTotals } from '@/utils/shop';
import type { ChecklistItem, PartsQuote } from '@/models';

// Minimal test fixtures: a checklist task (done or not) and a quote (approved / rejected / pending).
const task = (done: boolean): ChecklistItem => ({ id: 1, jobId: 1, taskDescription: 't', isCompleted: done, photoUrl: null, completedAt: null });
const quote = (price: number, isApproved: boolean | null): PartsQuote => ({ id: 1, jobId: 1, partName: 'p', price, photos: [], isApproved, createdAt: '' });

describe('UGX formatting', () => {
  it('uses thousands separators and no minor unit', () => {
    expect(formatUGX(210000)).toBe('UGX 210,000');
    expect(formatUGX(50000.4, false)).toBe('50,000');
  });
  it('parses typed amounts', () => {
    expect(parseAmount('210,000')).toBe(210000);
    expect(formatAmountInput('1234567')).toBe('1,234,567');
  });
});

describe('status → stage mapping (O9)', () => {
  it('maps job status to the 5-stage timeline', () => {
    expect(stageIndex({ status: 'pending' })).toBe(0);
    expect(stageIndex({ status: 'accepted' })).toBe(1);
    expect(stageIndex({ status: 'fixing', checklist: [task(false)] })).toBe(2); // Arrived
    expect(stageIndex({ status: 'fixing', checklist: [task(true), task(false)] })).toBe(3); // Fixing
    expect(stageIndex({ status: 'completed' })).toBe(4);
    expect(stageIndex({ status: 'cancelled' })).toBe(-1);
  });
});

describe('billing rules', () => {
  it('bills the 50,000 fee plus approved parts only', () => {
    expect(computeTotals([quote(120000, true), quote(210000, null), quote(90000, false)])).toEqual({
      serviceFee: 50000,
      approvedParts: 120000,
      total: 170000,
    });
  });
  it('locks Finish until every task is done and no quote is pending (§6.4)', () => {
    expect(canFinish({ status: 'fixing', checklist: [task(true), task(false)], quotes: [] }).ok).toBe(false);
    expect(canFinish({ status: 'fixing', checklist: [task(true)], quotes: [quote(1, null)] })).toMatchObject({ ok: false, openQuotes: 1 });
    expect(canFinish({ status: 'fixing', checklist: [task(true)], quotes: [quote(1, false)] }).ok).toBe(true);
  });
});

describe('reviews', () => {
  it('stores quick-tags inside the feedback text and reads them back', () => {
    const fb = composeFeedback(['On time', 'Fair price'], 'Great work');
    expect(fb).toBe('[On time, Fair price] Great work');
    expect(parseFeedback(fb)).toEqual({ tags: ['On time', 'Fair price'], comment: 'Great work' });
    expect(parseFeedback('plain')).toEqual({ tags: [], comment: 'plain' });
  });
});

describe('misc', () => {
  it('normalises Ugandan phone numbers', () => {
    expect(normalizePhone('0772 111222')).toBe('+256772111222');
    expect(normalizePhone('256772111222')).toBe('+256772111222');
  });
  it('computes service due = last service + 6 months', () => {
    const d = new Date();
    d.setMonth(d.getMonth() - 6);
    d.setDate(d.getDate() + 12);
    expect(serviceDueInDays({ lastServiceDate: d.toISOString() })).toBeGreaterThanOrEqual(11);
    expect(serviceDueInDays({ lastServiceDate: null })).toBeNull();
  });
  it('haversine distance matches known Kampala distance', () => {
    expect(distanceKm(0.3136, 32.5811, 0.33, 32.57)).toBeCloseTo(2.2, 1);
  });
  it('groups activity like the web (Today … Older)', () => {
    expect(dateGroup(new Date().toISOString())).toBe('Today');
    expect(dateGroup('2020-01-01T00:00:00Z')).toBe('Older');
  });
});

describe('shop orders', () => {
  const lines = [
    { unitPrice: 85_000, quantity: 2 },
    { unitPrice: 15_000, quantity: 1 },
  ];
  it('adds the delivery fee for delivery only', () => {
    expect(orderTotals(lines, 'delivery', 10_000)).toEqual({ subtotal: 185_000, deliveryFee: 10_000, total: 195_000 });
    expect(orderTotals(lines, 'pickup', 10_000)).toEqual({ subtotal: 185_000, deliveryFee: 0, total: 185_000 });
    expect(orderTotals([], 'delivery', 10_000).total).toBe(0);
  });
  it('follows delivery or pickup steps, and staff can cancel until delivered', () => {
    expect(orderSteps('delivery')).toEqual(['placed', 'confirmed', 'out_for_delivery', 'delivered']);
    expect(orderSteps('pickup')).toEqual(['placed', 'confirmed', 'ready_for_pickup', 'delivered']);
    expect(nextOrderStatuses('confirmed', 'pickup')).toEqual(['ready_for_pickup', 'cancelled']);
    expect(nextOrderStatuses('out_for_delivery', 'delivery')).toEqual(['delivered', 'cancelled']);
    expect(nextOrderStatuses('delivered', 'delivery')).toEqual([]);
    expect(nextOrderStatuses('cancelled', 'pickup')).toEqual([]);
  });
});

describe('job steps and bookings', () => {
  it('starts each kind of job with its own steps', () => {
    expect(stepsFor('Oil Change', DEFAULT_JOB_STEPS)).toEqual([...DEFAULT_JOB_STEPS['Oil Change']!]);
    expect(stepsFor('flat tire', DEFAULT_JOB_STEPS)).toEqual([...DEFAULT_JOB_STEPS['Flat Tire']!]);
    expect(stepsFor('Diagnostic: Engine Light, Overheating', DEFAULT_JOB_STEPS)).toEqual([...DEFAULT_JOB_STEPS.Diagnostics!]);
    expect(stepsFor('Windscreen repair', DEFAULT_JOB_STEPS)).toEqual([...ARRIVAL_CHECKLIST]);
    expect(stepsFor('Oil Change', { 'Oil Change': ['Only step'] })).toEqual(['Only step']);
  });
  it('knows when a booking is and keeps upcoming ones quiet', () => {
    const now = new Date(2026, 8, 30, 10, 0); // 30 Sep 2026, 10:00 local
    expect(bookingDay('2026-09-29', now)).toBe('past');
    expect(bookingDay('2026-09-30', now)).toBe('today');
    expect(bookingDay('2026-10-01', now)).toBe('tomorrow');
    expect(bookingDay('2026-10-05', now)).toBe('later');
    const booking = { status: 'accepted' as const, sosActive: false, scheduledDate: '2026-10-05' };
    expect(isUpcomingBooking(booking, now)).toBe(true);
    expect(isUpcomingBooking({ ...booking, scheduledDate: '2026-09-30' }, now)).toBe(false);
    expect(isUpcomingBooking({ ...booking, status: 'fixing' }, now)).toBe(false);
    expect(isUpcomingBooking({ ...booking, sosActive: true }, now)).toBe(false);
    expect(stagesFor({ scheduledDate: '2026-10-05' })[2]).toBe('Check-in');
    expect(stagesFor({ scheduledDate: null })[2]).toBe('Arrived');
  });
  it('reminds at 6 pm the evening before and 7 am on the day', () => {
    const { eve, day } = reminderTimes('2026-10-01');
    expect([eve.getFullYear(), eve.getMonth(), eve.getDate(), eve.getHours()]).toEqual([2026, 8, 30, 18]);
    expect([day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 9, 1, 7]);
  });
});
