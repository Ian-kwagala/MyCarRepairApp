import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { Platform } from 'react-native';

import type { LocalPhoto } from '@/models';

/** Resize to 1600 px, JPEG 0.7 before upload (§4.2, §11.1). */
async function compress(uri: string, width?: number): Promise<string> {
  try {
    const ctx = ImageManipulator.manipulate(uri);
    if (width && width > 1600) ctx.resize({ width: 1600, height: null });
    const rendered = await ctx.renderAsync();
    // Web: blob: URLs die on reload, so keep a data URI instead.
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG, base64: Platform.OS === 'web' });
    return Platform.OS === 'web' && saved.base64 ? `data:image/jpeg;base64,${saved.base64}` : saved.uri;
  } catch {
    return uri;
  }
}

function toLocalPhoto(uri: string, i: number): LocalPhoto {
  return { uri, name: `photo-${Date.now()}-${i}.jpg`, type: 'image/jpeg' };
}

export type PhotoSource = 'camera' | 'library';

export class PermissionDeniedError extends Error {}

/** Asked on first photo action, not at launch (§11). */
export async function pickPhotos(source: PhotoSource, limit: number): Promise<LocalPhoto[]> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError('Camera access is needed to take photos.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return [];
    const uris = await Promise.all(res.assets.map((a) => compress(a.uri, a.width)));
    return uris.map(toLocalPhoto);
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new PermissionDeniedError('Photo library access is needed to attach photos.');
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    quality: 0.7,
    allowsMultipleSelection: limit > 1,
    selectionLimit: limit,
  });
  if (res.canceled) return [];
  const uris = await Promise.all(res.assets.slice(0, limit).map((a) => compress(a.uri, a.width)));
  return uris.map(toLocalPhoto);
}

/**
 * Local data mode only: copy a picked photo out of the cache directory so it survives restarts.
 * In remote mode photos are uploaded to object storage instead.
 */
export function persistPhoto(photo: LocalPhoto): string {
  if (Platform.OS === 'web') return photo.uri;
  try {
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, photo.name);
    new File(photo.uri).copy(dest);
    return dest.uri;
  } catch {
    return photo.uri;
  }
}
