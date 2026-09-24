import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { api } from '@/api';

async function localFile(url: string, jobId: number): Promise<string> {
  if (url.startsWith('file:')) return url;
  const dir = new Directory(Paths.cache, 'receipts');
  if (!dir.exists) dir.create({ intermediates: true });
  const dest = new File(dir, `mycarrepair-receipt-${jobId}.pdf`);
  if (dest.exists) dest.delete();
  const out = await File.downloadFileAsync(url, dest);
  return out.uri;
}

/** Open the PDF receipt (GET /jobs/:id/receipt → signed URL, or generated on device in local mode). */
export async function openReceipt(jobId: number) {
  const { url } = await api.getReceipt(jobId);
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank');
    return;
  }
  if (url.startsWith('http')) {
    await WebBrowser.openBrowserAsync(url);
    return;
  }
  await Print.printAsync({ uri: url });
}

/** Share / save the PDF receipt to the device. */
export async function shareReceipt(jobId: number) {
  const { url } = await api.getReceipt(jobId);
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank');
    return;
  }
  const uri = await localFile(url, jobId);
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Receipt · Job #${jobId}` });
}
