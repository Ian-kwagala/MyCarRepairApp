/// <reference types="jest" />
// Unit tests for the pure helper functions: money formatting, job stages, billing, the finish lock,
// review tags, phone numbers, service-due dates, distances and date grouping.
import { composeFeedback, canFinish, computeTotals, parseFeedback, serviceDueInDays, stageIndex } from '@/utils/jobs';
import { dateGroup, formatAmountInput, formatUGX, normalizePhone, parseAmount } from '@/utils/format';
import { distanceKm } from '@/utils/geo';
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
