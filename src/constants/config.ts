// App-wide constants: the fixed lists shown in pickers, business rules (fees, dispatch radius, intervals)
// and the default remote config used until the server's config has loaded.
import type { AppConfig } from '@/models';

// Blueprint Appendix A.3 — existing enumerations reused from the web code.
/** Breakdown types an owner can pick when raising an SOS. */
export const SOS_ISSUES = [
  'Flat Tire',
  'Dead Battery',
  'Engine Failure',
  'Towing',
  'Low Fuel',
  'Car Crash',
] as const;

/** Services an owner can book in advance. */
export const BOOKING_SERVICES = ['Oil Change', 'Brake Repair', 'General Service', 'Tyre Rotation'] as const;

/** Symptoms offered on the owner's diagnostics screen. */
export const DIAGNOSTIC_SYMPTOMS = ['Engine Light', 'Strange Noise', 'Overheating', 'Unusual Smoke'] as const;

/** Options for the vehicle form. */
export const FUEL_TYPES = ['Petrol', 'Diesel', 'Hybrid', 'Electric'] as const;
export const TRANSMISSIONS = ['Automatic', 'Manual'] as const;

/** Tasks a mechanic works through on a booked service job. */
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

/** Tasks a mechanic works through on arriving at an SOS job. */
export const ARRIVAL_CHECKLIST = ['Initial Inspection', 'Fluid Level Check', 'Diagnostic Scan', 'Safety Test'] as const;

/** Quick tags an owner can add to a mechanic review. */
export const REVIEW_TAGS = ['On time', 'Fair price', 'Showed old part', 'Explained clearly', 'Clean work'] as const;

/** UGX 50,000 service fee on every job (business rule). */
export const SERVICE_FEE = 50_000;

/** FR03 geo-dispatch: nearest 5 online mechanics within 10 km, widened to 20 km after 60 s. */
export const DISPATCH = { limit: 5, radiusKm: 10, widenedRadiusKm: 20, widenAfterMs: 60_000 } as const;

/** Service due = last_service_date + 6 months (client-side, §10.4). */
export const SERVICE_INTERVAL_MONTHS = 6;

/** Most photos allowed per vehicle or quote. */
export const MAX_PHOTOS = 5;
/** How often an online mechanic's position is sent to the server. */
export const LOCATION_INTERVAL_MS = 15_000;
/** How long an SOS waits for a mechanic before the owner is told nobody accepted. */
export const SOS_TIMEOUT_MS = 3 * 60_000;
/** Countdown a mechanic gets to accept or decline an incoming SOS. */
export const INCOMING_SOS_SECONDS = 30;
/** Maximum length of a job's service type text. */
export const SERVICE_TYPE_MAX = 50;

/** Fallback for GET /config, used offline and before the first fetch completes. */
export const DEFAULT_CONFIG: AppConfig = {
  serviceFee: SERVICE_FEE,
  sosIssues: [...SOS_ISSUES],
  bookingServices: [...BOOKING_SERVICES],
  diagnosticSymptoms: [...DIAGNOSTIC_SYMPTOMS],
  maintenance: false,
  minAppVersion: '1.0.0',
  supportPhone: '+256700000000',
};
