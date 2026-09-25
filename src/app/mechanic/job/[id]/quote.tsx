import { router, useLocalSearchParams } from 'expo-router';
import { Send } from '@/components/icons';
import { useState } from 'react';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { Button, haptic, InlineNotice, PhotoPicker, Screen, TextField } from '@/components';
import { MAX_PHOTOS } from '@/constants/config';
import type { LocalPhoto } from '@/models';
import { queryClient } from '@/services/query-client';
import { toast } from '@/store/toast';
import { formatAmountInput, parseAmount } from '@/utils/format';

// Mechanic screen for sending the owner a parts quote.

/**
 * M5 Quote — photo-first part quote; price in UGX with thousands separators; up to 5 photos.
 * At least one photo is required so the owner can see what they're paying for.
 */
export default function QuotePart() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [partName, setPartName] = useState('');
  const [price, setPrice] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setError(null);
    if (!partName.trim()) return setError('Enter the part name.');
    if (!parseAmount(price)) return setError('Enter the price in UGX.');
    if (!photos.length) return setError('Add at least one photo of the part — owners approve what they can see.');
    setSending(true);
    // Retry once on a weak network before giving up.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await api.createQuote(id, { partName: partName.trim(), price: parseAmount(price), photos });
        haptic('success');
        void queryClient.invalidateQueries({ queryKey: ['job', id] });
        toast({ title: 'Quote sent to owner', body: 'You will be notified when they decide.', tone: 'success' });
        router.back();
        return;
      } catch (e) {
        if (attempt === 1) setError(errorMessage(e));
      }
    }
    setSending(false);
  };

  return (
    <Screen back title="Quote a part" eyebrow={`Job #${id}`} footer={<Button title="Send quote to owner" icon={Send} onPress={send} loading={sending} />}>
      <PhotoPicker label="Part photos" photos={photos} onChange={setPhotos} max={MAX_PHOTOS} />
      <TextField label="Part name" value={partName} onChangeText={setPartName} placeholder="Brake Disc Rotor (front)" maxLength={100} />
      <TextField label="Price (UGX)" value={price} onChangeText={(t) => setPrice(formatAmountInput(t))} placeholder="210,000" keyboardType="number-pad" />
      {error ? <InlineNotice tone="danger">{error}</InlineNotice> : null}
    </Screen>
  );
}
