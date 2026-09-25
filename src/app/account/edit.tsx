import { router } from 'expo-router';
import { useState } from 'react';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, InlineNotice, Screen, Section, TextField } from '@/components';
import { useSession, useUser } from '@/store/session';
import { toast } from '@/store/toast';

// Screen for editing your own profile (both roles).

/**
 * Edit profile — PATCH /me {fullName, phone, garageName?, garageLocation?, expertise?}. Garage fields
 * only appear for mechanics; email can't be changed here.
 */
export default function EditProfile() {
  const user = useUser();
  const setUser = useSession((s) => s.setUser);
  // Form starts with the current profile values.
  const [f, setF] = useState({
    fullName: user?.fullName ?? '',
    phone: user?.phone ?? '',
    garageName: user?.garageName ?? '',
    garageLocation: user?.garageLocation ?? '',
    expertise: user?.expertise ?? '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }));
  if (!user) return null;
  const mechanic = user.role === 'mechanic';

  // Saves the changes (garage fields only for mechanics) and updates the stored session.
  const save = async () => {
    setError(null);
    if (f.fullName.trim().length < 2) return setError('Enter your full name.');
    setSaving(true);
    try {
      const u = await api.updateMe(
        mechanic
          ? { fullName: f.fullName, phone: f.phone, garageName: f.garageName, garageLocation: f.garageLocation, expertise: f.expertise }
          : { fullName: f.fullName, phone: f.phone },
      );
      setUser(u);
      toast({ title: 'Profile updated', tone: 'success' });
      router.back();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen back title="Edit profile" footer={<Button title="Save changes" onPress={save} loading={saving} />}>
      <TextField label="Full name" value={f.fullName} onChangeText={set('fullName')} autoComplete="name" />
      <TextField label="Phone" value={f.phone} onChangeText={set('phone')} keyboardType="phone-pad" autoComplete="tel" />
      <TextField label="Email" value={user.email} editable={false} hint="Contact support to change your email." />
      {mechanic ? (
        <Section title="Garage">
          <TextField label="Garage name" value={f.garageName} onChangeText={set('garageName')} />
          <TextField label="Garage location" value={f.garageLocation} onChangeText={set('garageLocation')} />
          <TextField label="Expertise" value={f.expertise} onChangeText={set('expertise')} multiline />
        </Section>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
