import { Link } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable } from 'react-native';
import { z } from 'zod';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, InlineNotice, Screen, Section, Segmented, Text, TextField } from '@/components';
import { useSession } from '@/store/session';
import { useColors } from '@/theme';

type RoleOpt = 'owner' | 'mechanic';

// Validation mirrors the server rules.
const schema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(100),
    email: z.string().trim().email('Enter a valid email address.'),
    phone: z.string().trim().regex(/^\+?[0-9 ]{9,15}$/, 'Enter a valid phone number, e.g. +256 772 111 222.'),
    password: z.string().min(6, 'Password must be at least 6 characters.'),
    role: z.enum(['owner', 'mechanic']),
    garageName: z.string().trim().max(100).optional(),
    garageLocation: z.string().trim().max(100).optional(),
    expertise: z.string().trim().optional(),
  })
  .refine((v) => v.role === 'owner' || (v.garageName && v.garageName.length >= 2), {
    path: ['garageName'],
    message: 'Enter your garage name.',
  })
  .refine((v) => v.role === 'owner' || (v.garageLocation && v.garageLocation.length >= 2), {
    path: ['garageLocation'],
    message: 'Enter where your garage is.',
  });

/** A3 Sign up — owners are active immediately; mechanics land on M7 (pending). */
export default function SignUp() {
  const c = useColors();
  const signIn = useSession((s) => s.signIn);
  const [role, setRole] = useState<RoleOpt>('owner');
  const [form, setForm] = useState({ fullName: '', email: '', phone: '+256 ', password: '', garageName: '', garageLocation: '', expertise: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    setError(null);
    const parsed = schema.safeParse({ ...form, role });
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) errs[String(issue.path[0])] ??= issue.message;
      setErrors(errs);
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const session = await api.register(parsed.data);
      await signIn(session);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      back
      footer={
        <>
          <Button title={role === 'mechanic' ? 'Submit for verification' : 'Create account'} onPress={submit} loading={loading} />
          <Text center tone="textMuted">
            Already have an account?{' '}
            <Link href="/sign-in" replace>
              <Text tone="primary" variant="bodyStrong">
                Sign in
              </Text>
            </Link>
          </Text>
        </>
      }>
      <Text variant="title">Create account</Text>
      <Segmented options={['owner', 'mechanic'] as const} value={role} onChange={setRole} labels={{ owner: 'Car Owner', mechanic: 'Mechanic' }} />
      <TextField label="Full name" value={form.fullName} onChangeText={set('fullName')} placeholder="Sarah Nakato" autoComplete="name" error={errors.fullName} />
      <TextField label="Email" value={form.email} onChangeText={set('email')} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" autoComplete="email" error={errors.email} />
      <TextField label="Phone" value={form.phone} onChangeText={set('phone')} placeholder="+256 772 111 222" keyboardType="phone-pad" autoComplete="tel" error={errors.phone} />
      <TextField
        label="Password"
        value={form.password}
        onChangeText={set('password')}
        secureTextEntry={!show}
        autoComplete="new-password"
        error={errors.password}
        hint="At least 6 characters"
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow(!show)} hitSlop={12}>
            {show ? <EyeOff size={20} color={c.textMuted} /> : <Eye size={20} color={c.textMuted} />}
          </Pressable>
        }
      />
      {role === 'mechanic' ? (
        <Section title="Your garage">
          <TextField label="Garage name" value={form.garageName} onChangeText={set('garageName')} placeholder="Okello Auto Works" error={errors.garageName} />
          <TextField label="Garage location" value={form.garageLocation} onChangeText={set('garageLocation')} placeholder="Wandegeya, Kampala" error={errors.garageLocation} />
          <TextField label="Expertise" value={form.expertise} onChangeText={set('expertise')} placeholder="Brakes, electrical, Toyota & Subaru…" multiline />
          <InlineNotice tone="info">Mechanic accounts are reviewed by our team before you can go online (usually within 24 h).</InlineNotice>
        </Section>
      ) : null}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
