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

/** Key in the job-steps table for every "Diagnostic: …" job, whatever the symptoms. */
export const DIAGNOSTICS_STEPS_KEY = 'Diagnostics';

/**
 * Default steps on the mechanic's job card for each kind of job: every SOS issue, every bookable service and
 * diagnostics. Staff can change them in /admin → Settings; a job whose service isn't listed gets
 * ARRIVAL_CHECKLIST. Mechanics can add extra steps to a single job from its job card.
 */
export const DEFAULT_JOB_STEPS: Record<string, readonly string[]> = {
  'Flat Tire': ['Check tyre damage', 'Loosen nuts and jack up the car', 'Repair puncture or fit spare', 'Tighten nuts and lower the car', 'Check tyre pressure'],
  'Dead Battery': ['Test battery voltage', 'Clean and tighten terminals', 'Jump-start or replace battery', 'Test charging (alternator)'],
  'Engine Failure': ['Initial inspection', 'Check oil and coolant', 'Diagnostic scan', 'Fix the fault', 'Start and test the engine'],
  Towing: ['Photograph the car’s condition', 'Secure the car for towing', 'Tow to the garage', 'Hand over at the garage'],
  'Low Fuel': ['Deliver fuel', 'Refuel the car', 'Start the engine and check'],
  'Car Crash': ['Check everyone is safe', 'Photograph the damage', 'Make the car safe (hazards, leaks, battery)', 'Assess the damage', 'Tow or repair on site'],
  'Oil Change': ['Drain the old oil', 'Replace the oil filter', 'Refill with new oil', 'Check oil level and leaks', 'Reset the service reminder'],
  'Brake Repair': ['Inspect pads and discs', 'Replace pads or shoes', 'Check brake fluid', 'Bleed brakes if needed', 'Road-test the brakes'],
  'General Service': BOOKING_CHECKLIST,
  'Tyre Rotation': ['Check tyre wear and pressure', 'Rotate the tyres', 'Torque the wheel nuts', 'Set tyre pressures'],
  [DIAGNOSTICS_STEPS_KEY]: ['Hear the symptoms from the owner', 'Diagnostic scan', 'Inspect the affected system', 'Explain the findings and quote parts', 'Fix the fault', 'Test drive'],
};

/** Most steps one job card can have (defaults plus steps the mechanic adds). */
export const MAX_JOB_STEPS = 30;
/** Longest step description. */
export const JOB_STEP_MAX = 120;

/** Longest video a mechanic can record as proof for a step (short clips keep uploads quick on mobile data). */
export const VIDEO_MAX_SECONDS = 20;
/** Largest video upload, in MB (the server enforces the same limit). */
export const VIDEO_MAX_MB = 40;

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
  deliveryFee: 10_000,
  pickupLocation: 'MyCarRepair, Kampala',
};

/** Shop sections, in display order, with their labels. */
export const PRODUCT_CATEGORIES = [
  { key: 'parts', label: 'Spare parts' },
  { key: 'tyres', label: 'Tyres' },
  { key: 'batteries', label: 'Batteries' },
  { key: 'fluids', label: 'Oils & fluids' },
  { key: 'accessories', label: 'Accessories' },
  { key: 'electronics', label: 'Electronics' },
] as const;

/** Most of one product a single order can hold (keeps stock fair and orders sane). */
export const MAX_ORDER_QUANTITY = 20;

/** MyCarRepair's default commission on marketplace sellers' sales, in percent (changeable in /admin → Settings). */
export const DEFAULT_COMMISSION_PERCENT = 10;
