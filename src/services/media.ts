// Photo handling: asks for camera/library permission, lets the user take or pick photos, shrinks them for
// upload, keeps them safe until they are sent, and (in local mode) copies them somewhere permanent.
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
    // If resizing fails, send the original rather than losing the photo.
    return uri;
  }
}

// Photos waiting to be sent live in app storage, not the cache: Android and phone-cleaner apps (e.g. Phone Master
// on Tecno/Infinix) may empty the cache at any moment, which made uploads fail with "No such file or directory".
const PENDING_DIR = 'pending-uploads';
const PENDING_MAX_AGE_MS = 3 * 86_400_000;

function pendingDir(): Directory {
  const dir = new Directory(Paths.document, PENDING_DIR);
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

/** Moves a freshly shrunk photo out of the cache into app storage; keeps the original URI if that fails. */
function keepForUpload(uri: string): string {
  if (Platform.OS === 'web' || !uri.startsWith('file://')) return uri;
  try {
    const src = new File(uri);
    // The time prefix lets cleanOldPendingPhotos() spot photos that were picked but never sent.
    const dest = new File(pendingDir(), `${Date.now()}-${src.name}`);
    src.move(dest);
    return dest.uri;
  } catch {
    return uri;
  }
}

/** Deletes photos that have been uploaded (only ones this module moved into app storage). */
export function forgetUploadedPhotos(photos: readonly LocalPhoto[]) {
  if (Platform.OS === 'web') return;
  for (const p of photos) {
    if (!p.uri.includes(`/${PENDING_DIR}/`)) continue;
    try {
      const f = new File(p.uri);
      if (f.exists) f.delete();
    } catch {
      // Best effort: a leftover file is removed by cleanOldPendingPhotos() later.
    }
  }
}

/** On launch: removes photos picked more than 3 days ago that were never sent (a screen left mid-way). */
export function cleanOldPendingPhotos() {
  if (Platform.OS === 'web') return;
  try {
    const dir = new Directory(Paths.document, PENDING_DIR);
    if (!dir.exists) return;
    for (const entry of dir.list()) {
      const pickedAt = Number(entry.name.split('-')[0]);
      if (entry instanceof File && pickedAt && Date.now() - pickedAt > PENDING_MAX_AGE_MS) entry.delete();
    }
  } catch {
    // Housekeeping only; never block start-up.
  }
}

/** Wraps a file URI as an upload-ready photo with a unique JPEG file name. */
function toLocalPhoto(uri: string, i: number): LocalPhoto {
  return { uri, name: `photo-${Date.now()}-${i}.jpg`, type: 'image/jpeg' };
}

/** Where to get photos from: take a new one, or choose from the gallery. */
export type PhotoSource = 'camera' | 'library';

/** Thrown when the user refuses camera or photo-library access; its message can be shown as-is. */
export class PermissionDeniedError extends Error {}

/**
 * Takes a photo or lets the user pick up to `limit` from the library, and returns them compressed.
 * Returns [] if the user cancels. Permission is asked on first photo action, not at launch (§11).
 */
export async function pickPhotos(source: PhotoSource, limit: number): Promise<LocalPhoto[]> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError('Camera access is needed to take photos.');
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    if (res.canceled) return [];
    const uris = await Promise.all(res.assets.map((a) => compress(a.uri, a.width)));
    return uris.map(keepForUpload).map(toLocalPhoto);
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
  return uris.map(keepForUpload).map(toLocalPhoto);
}

/**
 * Local data mode only: copy a picked photo out of the cache directory so it survives restarts.
 * In remote mode photos are uploaded to object storage instead.
 */
export function persistPhoto(photo: LocalPhoto): string {
  // Web photos are already data URIs, which don't expire.
  if (Platform.OS === 'web') return photo.uri;
  try {
    const dir = new Directory(Paths.document, 'photos');
    if (!dir.exists) dir.create({ intermediates: true });
    const dest = new File(dir, photo.name);
    new File(photo.uri).copy(dest);
    return dest.uri;
  } catch {
    // Copy failed: fall back to the original path, which still works until the cache is cleared.
    return photo.uri;
  }
}
