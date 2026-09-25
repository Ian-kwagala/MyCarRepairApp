import { router } from 'expo-router';
import { useState } from 'react';

import { api, type ForgotPasswordResult } from '@/api';
import { useConfig } from '@/hooks/queries';
import { errorMessage } from '@/api/errors';
import { Button, InlineNotice, Screen, Text, TextField } from '@/components';
import { toast } from '@/store/toast';

// Password reset screen.

/**
 * A4 Forgot password / OTP. Two steps: enter your phone/email, then prove it's you and choose a new
 * password. The proof is an SMS/email code with the real backend, or retyping the account's phone
 * number in local mode.
 */
export default function ForgotPassword() {
  const config = useConfig();
  const [identifier, setIdentifier] = useState('');
  // null = step 1; once set, how the server wants the user verified (step 2).
  const [step, setStep] = useState<ForgotPasswordResult | null>(null);
  // The OTP code, or the phone number in local mode.
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1: look up the account and learn how to verify it.
  const request = async () => {
    setError(null);
    if (!identifier.trim()) return setError('Enter your phone or email.');
    setLoading(true);
    try {
      setStep(await api.forgotPassword(identifier));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  // Step 2: set the new password, then go to sign-in.
  const reset = async () => {
    setError(null);
    setLoading(true);
    try {
      await api.resetPassword({ identifier, code, password });
      toast({ title: 'Password updated', body: 'Sign in with your new password.', tone: 'success' });
      router.replace('/sign-in');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen
      back
      title="Reset password"
      footer={step ? <Button title="Set new password" onPress={reset} loading={loading} /> : <Button title="Continue" onPress={request} loading={loading} />}>
      {!step ? (
        <>
          <Text tone="textMuted">Enter the phone number or email you signed up with.</Text>
          <TextField label="Phone or email" value={identifier} onChangeText={setIdentifier} autoCapitalize="none" keyboardType="email-address" />
        </>
      ) : (
        <>
          {step.verification === 'otp' ? (
            <>
              <Text tone="textMuted">
                {step.channel === 'support'
                  ? `Call MyCarRepair support on ${config.supportPhone}. After confirming it's you, they'll read you a 6-digit code (valid for 15 minutes).`
                  : `We sent a 6-digit code${step.destination ? ` to ${step.destination}` : ''}.`}
              </Text>
              <TextField label="Verification code" value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} />
            </>
          ) : (
            <>
              <Text tone="textMuted">
                Confirm the phone number on this account{step.destination ? ` (${step.destination})` : ''}.
              </Text>
              <TextField label="Phone number" value={code} onChangeText={setCode} keyboardType="phone-pad" placeholder="+256 …" />
            </>
          )}
          <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" hint="At least 6 characters" />
        </>
      )}
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
