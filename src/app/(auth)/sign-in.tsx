import { Link, router } from 'expo-router';
import { Eye, EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, InlineNotice, Screen, Segmented, Text, TextField } from '@/components';
import { APP_ROLE } from '@/constants/app-variant';
import { useSession } from '@/store/session';
import { Space, useColors } from '@/theme';

type RoleOpt = 'owner' | 'mechanic';

/** A2 Sign in — role toggle like the web; email or phone + password. */
export default function SignIn() {
  const c = useColors();
  const signIn = useSession((s) => s.signIn);
  const [role, setRole] = useState<RoleOpt>(APP_ROLE ?? 'owner');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!identifier.trim() || !password) {
      setError('Enter your phone or email and password.');
      return;
    }
    setLoading(true);
    try {
      const session = await api.login({ identifier, password, role });
      await signIn(session);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      back={() => (router.canGoBack() ? router.back() : router.replace('/welcome'))}
      footer={
        <>
          <Button title="Sign in" onPress={submit} loading={loading} />
          <Text center tone="textMuted">
            New here?{' '}
            <Link href="/sign-up" replace>
              <Text tone="primary" variant="bodyStrong">
                Create account
              </Text>
            </Link>
          </Text>
        </>
      }>
      <Text variant="title">Welcome back</Text>
      <Text tone="textMuted">{APP_ROLE === 'mechanic' ? 'Sign in to your mechanic account' : 'Sign in to MyCarRepair'}</Text>
      {APP_ROLE ? null : (
        <View style={{ marginTop: Space.md }}>
          <Segmented options={['owner', 'mechanic'] as const} value={role} onChange={setRole} labels={{ owner: 'Car Owner', mechanic: 'Mechanic' }} />
        </View>
      )}
      <TextField
        label="Phone or email"
        value={identifier}
        onChangeText={setIdentifier}
        placeholder="+256 772 111 222"
        autoCapitalize="none"
        autoComplete="username"
        keyboardType="email-address"
        returnKeyType="next"
      />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry={!show}
        autoComplete="current-password"
        returnKeyType="go"
        onSubmitEditing={submit}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow(!show)} hitSlop={12}>
            {show ? <EyeOff size={20} color={c.textMuted} /> : <Eye size={20} color={c.textMuted} />}
          </Pressable>
        }
      />
      <Link href="/forgot-password" asChild>
        <Pressable accessibilityRole="link" style={{ alignSelf: 'flex-end', paddingVertical: Space.sm }}>
          <Text tone="primary" variant="bodyStrong">
            Forgot password?
          </Text>
        </Pressable>
      </Link>
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
