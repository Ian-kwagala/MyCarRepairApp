import { useState } from 'react';
import { View } from 'react-native';
import { z } from 'zod';

import type { VehicleInput } from '@/api';
import { Button, PhotoPicker, ProgressBar, Row, Screen, Segmented, Text, TextField } from '@/components';
import { FUEL_TYPES, MAX_PHOTOS, TRANSMISSIONS } from '@/constants/config';
import type { FuelType, LocalPhoto, Transmission, Vehicle } from '@/models';
import { Space } from '@/theme';

// The 3-step add/edit car form: basics, specs, photos. Each step is validated before moving on.

// Typical Ugandan number plate, e.g. "UBK 482X". Only used for a hint; other formats are still accepted.
const PLATE_RE = /^U[A-Z]{2}\s?\d{3}[A-Z]$/i;
const thisYear = new Date().getFullYear();

// Validation rules for step 1 (basics).
const basics = z.object({
  make: z.string().trim().min(1, 'Enter the make, e.g. Toyota.').max(50),
  model: z.string().trim().min(1, 'Enter the model, e.g. Premio.').max(50),
  year: z.coerce.number().int().min(1950, 'Enter a valid year.').max(thisYear + 1, 'Enter a valid year.'),
  plateNumber: z.string().trim().min(3, 'Enter the plate number.').max(20),
  color: z.string().trim().max(30).optional(),
});

// Validation rules for step 2 (specs). The service date must be a real YYYY-MM-DD date, not in the future.
const specs = z.object({
  tyreSize: z.string().trim().max(20).optional(),
  mileage: z
    .string()
    .trim()
    .regex(/^\d*$/, 'Mileage must be a number.')
    .optional(),
  lastServiceDate: z
    .string()
    .trim()
    .refine((s) => !s || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime()) && new Date(s) <= new Date()), 'Use YYYY-MM-DD, not in the future.')
    .optional(),
});

/** What the form hands to `onSubmit`: the car details, new photos to upload, and existing photos to keep. */
export interface VehicleFormResult {
  input: VehicleInput;
  newPhotos: LocalPhoto[];
  keepPhotos: string[];
}

const STEP_TITLES = ['Basics', 'Details', 'Photos'];

/**
 * O6 — same 11 fields as the web, split into 3 short steps (basics, specs, photos). Pass `initial` to
 * edit an existing car. `onSubmit` runs on the last step; the button shows a spinner until it finishes.
 */
export function VehicleForm({
  initial,
  title,
  submitLabel,
  onSubmit,
}: {
  initial?: Vehicle;
  title: string;
  submitLabel: string;
  onSubmit: (r: VehicleFormResult) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  // Form fields, all kept as text while editing and converted on submit.
  const [f, setF] = useState({
    make: initial?.make ?? '',
    model: initial?.model ?? '',
    year: initial ? String(initial.year) : '',
    plateNumber: initial?.plateNumber ?? '',
    color: initial?.color ?? '',
    fuelType: (initial?.fuelType ?? 'Petrol') as FuelType,
    transmission: (initial?.transmission ?? 'Automatic') as Transmission,
    tyreSize: initial?.tyreSize ?? '',
    mileage: initial?.mileage != null ? String(initial.mileage) : '',
    lastServiceDate: initial?.lastServiceDate?.slice(0, 10) ?? '',
  });
  // Existing photo URLs still kept, and newly picked photos.
  const [keep, setKeep] = useState<string[]>(initial?.photos ?? []);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // Returns a change handler for one text field.
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));

  // Checks the current step; shows the first error for each field and returns whether it passed.
  const validate = (schema: z.ZodTypeAny) => {
    const r = schema.safeParse(f);
    if (r.success) {
      setErrors({});
      return true;
    }
    const errs: Record<string, string> = {};
    for (const i of r.error.issues) errs[String(i.path[0])] ??= i.message;
    setErrors(errs);
    return false;
  };

  // Main button: validate and advance, or on the last step convert the fields and submit.
  const next = async () => {
    if (step === 0 && !validate(basics)) return;
    if (step === 1 && !validate(specs)) return;
    if (step < 2) return setStep(step + 1);
    setSaving(true);
    try {
      await onSubmit({
        input: {
          make: f.make.trim(),
          model: f.model.trim(),
          year: Number(f.year),
          plateNumber: f.plateNumber.trim().toUpperCase(),
          fuelType: f.fuelType,
          transmission: f.transmission,
          tyreSize: f.tyreSize.trim() || null,
          color: f.color.trim() || null,
          mileage: f.mileage ? Number(f.mileage) : null,
          lastServiceDate: f.lastServiceDate || null,
        },
        newPhotos: photos,
        keepPhotos: keep,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      back={step > 0 ? () => setStep(step - 1) : true}
      title={title}
      eyebrow={`Step ${step + 1} of 3 · ${STEP_TITLES[step]}`}
      footer={
        <Row gap={Space.sm}>
          {step > 0 ? <Button title="Back" kind="secondary" onPress={() => setStep(step - 1)} style={{ flex: 1 }} /> : null}
          <Button title={step < 2 ? (step === 1 ? 'Next: photos' : 'Next: details') : submitLabel} onPress={next} loading={saving} style={{ flex: 2 }} />
        </Row>
      }>
      <ProgressBar pct={((step + 1) / 3) * 100} />
      {step === 0 ? (
        <>
          <Row gap={Space.md}>
            <View style={{ flex: 1 }}>
              <TextField label="Make" value={f.make} onChangeText={set('make')} placeholder="Toyota" error={errors.make} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Model" value={f.model} onChangeText={set('model')} placeholder="Premio" error={errors.model} />
            </View>
          </Row>
          <Row gap={Space.md}>
            <View style={{ flex: 1 }}>
              <TextField label="Year" value={f.year} onChangeText={set('year')} placeholder="2008" keyboardType="number-pad" maxLength={4} error={errors.year} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField
                label="Plate"
                value={f.plateNumber}
                onChangeText={set('plateNumber')}
                placeholder="UBK 482X"
                autoCapitalize="characters"
                error={errors.plateNumber}
                hint={f.plateNumber && !PLATE_RE.test(f.plateNumber.trim()) ? 'Usual format: UAx/UBx 000X' : undefined}
              />
            </View>
          </Row>
          <TextField label="Colour (optional)" value={f.color} onChangeText={set('color')} placeholder="Silver" />
        </>
      ) : step === 1 ? (
        <>
          <Text variant="label">Fuel</Text>
          <Segmented options={FUEL_TYPES} value={f.fuelType} onChange={(v) => setF((x) => ({ ...x, fuelType: v }))} />
          <Text variant="label">Transmission</Text>
          <Segmented options={TRANSMISSIONS} value={f.transmission} onChange={(v) => setF((x) => ({ ...x, transmission: v }))} />
          <Row gap={Space.md}>
            <View style={{ flex: 1 }}>
              <TextField label="Tyre size" value={f.tyreSize} onChangeText={set('tyreSize')} placeholder="195/65 R15" autoCapitalize="characters" error={errors.tyreSize} />
            </View>
            <View style={{ flex: 1 }}>
              <TextField label="Mileage (km)" value={f.mileage} onChangeText={set('mileage')} placeholder="148500" keyboardType="number-pad" error={errors.mileage} />
            </View>
          </Row>
          <TextField
            label="Last service date"
            value={f.lastServiceDate}
            onChangeText={set('lastServiceDate')}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            maxLength={10}
            error={errors.lastServiceDate}
            hint="Used to remind you when the next service is due (every 6 months)."
          />
        </>
      ) : (
        <>
          <Text tone="textMuted">Photos help mechanics identify your car and prepare the right parts.</Text>
          <PhotoPicker
            photos={photos}
            onChange={setPhotos}
            max={MAX_PHOTOS}
            existing={keep}
            onRemoveExisting={(i) => setKeep(keep.filter((_, j) => j !== i))}
          />
        </>
      )}
    </Screen>
  );
}
