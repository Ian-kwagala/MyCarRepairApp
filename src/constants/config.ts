import type { AppConfig } from '@/models';

// Blueprint Appendix A.3 — existing enumerations reused from the web code.
export const SOS_ISSUES = [
  'Flat Tire',
  'Dead Battery',
  'Engine Failure',
  'Towing',
  'Low Fuel',
  'Car Crash',
] as const;

export const BOOKING_SERVICES = ['Oil Change', 'Brake Repair', 'General Service', 'Tyre Rotation'] as const;

export const DIAGNOSTIC_SYMPTOMS = ['Engine Light', 'Strange Noise', 'Overheating', 'Unusual Smoke'] as const;

export const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Electric'] as const;
export const TRANSMISSIONS = ['Automatic', 'Manual'] as const;

export const BOOKING_CHECKLIST = [
  'Oil Level Checked',
  'Oil Filter Replaced',
  'Coolant Level Checked',
  'Tire Pressure Checked',
  'Brake Pads Inspected',
  'Battery Terminals Inspected',
  'Lights & Signals Tested',
  'Windshield Wipers Checked',
  'Cabin Air Filter Checked',
  'Under-Carriage Inspection',
] as const;

export const ARRIVAL_CHECKLIST = ['Initial Inspection', 'Fluid Level Check', 'Diagnostic Scan', 'Safety Test'] as const;

export const REVIEW_TAGS = ['On time', 'Fair price', 'Showed old part', 'Explained clearly', 'Clean work'] as const;

/** UGX 50,000 service fee on every job (business rule). */
export const SERVICE_FEE = 50_000;

/** FR03 geo-dispatch: nearest 5 online mechanics within 10 km, widened to 20 km after 60 s. */
export const DISPATCH = { limit: 5, radiusKm: 10, widenedRadiusKm: 20, widenAfterMs: 60_000 } as const;

/** Service due = last_service_date + 6 months (client-side, §10.4). */
export const SERVICE_INTERVAL_MONTHS = 6;

export const MAX_PHOTOS = 5;
export const LOCATION_INTERVAL_MS = 15_000;
export const SOS_TIMEOUT_MS = 3 * 60_000;
export const INCOMING_SOS_SECONDS = 30;
export const SERVICE_TYPE_MAX = 50;

export const DEFAULT_CONFIG: AppConfig = {
  serviceFee: SERVICE_FEE,
  sosIssues: [...SOS_ISSUES],
  bookingServices: [...BOOKING_SERVICES],
  diagnosticSymptoms: [...DIAGNOSTIC_SYMPTOMS],
  maintenance: false,
  minAppVersion: '1.0.0',
  supportPhone: '+256700000000',
};
