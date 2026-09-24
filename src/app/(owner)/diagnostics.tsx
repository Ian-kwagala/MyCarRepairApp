import { router, useLocalSearchParams } from 'expo-router';
import { Lightbulb, ThermometerSun, TriangleAlert, Volume2, Wind, type LucideIcon } from '@/components/icons';
import { useCallback, useState } from 'react';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, Grid, haptic, InlineNotice, PhotoPicker, Screen, Text, TextField, Tile } from '@/components';
import { VehiclePicker } from '@/features/vehicle-picker';
import { useConfig } from '@/hooks/queries';
import type { LocalPhoto } from '@/models';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { Space } from '@/theme';

const SYMPTOM_ICONS: Record<string, LucideIcon> = {
  'Engine Light': TriangleAlert,
  'Strange Noise': Volume2,
  Overheating: ThermometerSun,
  'Unusual Smoke': Wind,
};

/** O8 Diagnostics — symptoms + photo evidence. Symptoms are persisted with the job (§6.4 fix). */
export default function Diagnostics() {
  const config = useConfig();
  const params = useLocalSearchParams<{ vehicleId?: string }>();
  const [vehicleId, setVehicleId] = useState<number | null>(params.vehicleId ? Number(params.vehicleId) : null);
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onVehicle = useCallback((id: number) => setVehicleId(id), []);

  const toggle = (s: string) => setSymptoms((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const submit = async () => {
    setError(null);
    if (!vehicleId) return setError('Choose a vehicle.');
    if (!symptoms.length) return setError('Pick at least one symptom.');
    setLoading(true);
    try {
      const job = await api.createDiagnostic({ vehicleId, symptoms, notes: notes.trim() || undefined, photo: photos[0] ?? null });
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['jobs'] });
      toast({ title: 'Sent to mechanics', body: 'A mechanic reviews your symptoms before visiting.', tone: 'success' });
      router.replace(`/job/${job.id}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen back title="Diagnostics" eyebrow="Tell us what you notice" footer={<Button title="Send to mechanics" onPress={submit} loading={loading} disabled={!symptoms.length || !vehicleId} />}>
      <VehiclePicker value={vehicleId} onChange={onVehicle} then="/diagnostics" />
      <Text variant="label" style={{ marginTop: Space.sm }}>
        Symptoms (pick all that apply)
      </Text>
      <Grid>
        {config.diagnosticSymptoms.map((s) => (
          <Tile key={s} icon={SYMPTOM_ICONS[s] ?? TriangleAlert} label={s} selected={symptoms.includes(s)} onPress={() => toggle(s)} />
        ))}
      </Grid>
      <PhotoPicker label="Photo evidence (dashboard light, leak, smoke…)" photos={photos} onChange={setPhotos} max={1} />
      <TextField label="Anything else? (optional)" value={notes} onChangeText={setNotes} placeholder="Started after driving through water…" multiline maxLength={500} />
      <InlineNotice icon={Lightbulb}>Tip: a mechanic reviews your symptoms before visiting.</InlineNotice>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
