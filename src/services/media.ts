// Photo and video handling: asks for camera/library permission, lets the user take or pick photos (and, for job-step
// proof, record or pick a short video), shrinks photos for upload, keeps files safe until they are sent, and (in local
// mode) copies them somewhere permanent.
import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { VIDEO_MAX_MB, VIDEO_MAX_SECONDS } from '@/constants/config';
import type { LocalPhoto } from '@/models';

import { Keys, kv } from './storage';

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

/**
 * What a camera photo is for. Saved before the camera opens: Android may close the app while the camera app is
 * in front (common on phones with little memory), and the photo is then recovered on return and delivered here.
 */
export type CameraPurpose = { kind: 'task'; jobId: number; taskId: number; task: string } | { kind: 'form'; route: string };

const CAMERA_PURPOSE_KEY = Keys.cameraPurpose;
// A photo recovered long after the camera opened no longer belongs to what the user is doing.
const CAMERA_PURPOSE_MAX_AGE_MS = 30 * 60_000;

/** Thrown when the user refuses camera or photo-library access; its message can be shown as-is. */
export class PermissionDeniedError extends Error {}

/**
 * Takes a photo or lets the user pick up to `limit` from the library, and returns them compressed.
 * Returns [] if the user cancels. Permission is asked on first photo action, not at launch (§11).
 */
export async function pickPhotos(source: PhotoSource, limit: number, purpose?: CameraPurpose): Promise<LocalPhoto[]> {
  if (limit <= 0) return [];
  if (source === 'camera') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError('Camera access is needed to take photos.');
    if (purpose && Platform.OS === 'android') await kv.set(CAMERA_PURPOSE_KEY, { ...purpose, at: Date.now() });
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
    // Normal return: nothing to recover. (If the app was closed meanwhile this line never runs, and
    // recoverCameraPhoto() finds the saved purpose instead.)
    if (purpose) await kv.remove(CAMERA_PURPOSE_KEY);
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

/** A picked or recorded video as an upload-ready file (keeps the container's extension for the server). */
function toLocalVideo(asset: ImagePicker.ImagePickerAsset): LocalPhoto {
  const mime = asset.mimeType?.startsWith('video/') ? asset.mimeType : 'video/mp4';
  const ext = mime.includes('quicktime') ? 'mov' : mime.includes('3gpp') ? '3gp' : mime.includes('webm') ? 'webm' : 'mp4';
  return { uri: keepForUpload(asset.uri), name: `video-${Date.now()}.${ext}`, type: mime };
}

/** Thrown when a video is too long or too large to send; its message can be shown as-is. */
export class VideoTooLargeError extends Error {}

/** Refuses videos over the length or size limits (the server enforces the size too). */
function checkVideo(asset: ImagePicker.ImagePickerAsset) {
  // expo-image-picker reports the duration in milliseconds.
  if (asset.duration != null && asset.duration > (VIDEO_MAX_SECONDS + 1) * 1000) {
    throw new VideoTooLargeError(`Videos can be at most ${VIDEO_MAX_SECONDS} seconds. Record a shorter clip.`);
  }
  if (asset.fileSize != null && asset.fileSize > VIDEO_MAX_MB * 1024 * 1024) {
    throw new VideoTooLargeError(`That video is over ${VIDEO_MAX_MB} MB. Record a shorter clip.`);
  }
}

/**
 * Proof for a job step: a new photo, a new video (at most VIDEO_MAX_SECONDS), or one photo/video from the gallery.
 * Returns null if the user cancels. `purpose` lets a camera result survive Android closing the app meanwhile.
 */
export async function pickProof(source: 'photo' | 'video' | 'library', purpose?: CameraPurpose): Promise<LocalPhoto | null> {
  if (source === 'photo') return (await pickPhotos('camera', 1, purpose))[0] ?? null;
  if (source === 'video') {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) throw new PermissionDeniedError('Camera access is needed to record videos.');
    if (purpose && Platform.OS === 'android') await kv.set(CAMERA_PURPOSE_KEY, { ...purpose, at: Date.now() });
    // The phone's own camera app records; it stops at the time limit on its own.
    const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: VIDEO_MAX_SECONDS, videoQuality: ImagePicker.UIImagePickerControllerQualityType.Medium });
    if (purpose) await kv.remove(CAMERA_PURPOSE_KEY);
    if (res.canceled || !res.assets[0]) return null;
    checkVideo(res.assets[0]);
    return toLocalVideo(res.assets[0]);
  }
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) throw new PermissionDeniedError('Photo library access is needed to attach photos or videos.');
  const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images', 'videos'], quality: 0.7, allowsMultipleSelection: false });
  const asset = res.canceled ? undefined : res.assets[0];
  if (!asset) return null;
  if (asset.type === 'video' || asset.mimeType?.startsWith('video/')) {
    checkVideo(asset);
    return toLocalVideo(asset);
  }
  return toLocalPhoto(keepForUpload(await compress(asset.uri, asset.width)), 0);
}

/**
 * Android only: the photo (or job-step video) taken while Android closed the app (or its screen), with what it was for. Call on start
 * and whenever the app returns to the foreground. Returns null when there is nothing to recover.
 */
export async function recoverCameraPhoto(): Promise<{ purpose: CameraPurpose; photo: LocalPhoto } | null> {
  if (Platform.OS !== 'android') return null;
  let res: Awaited<ReturnType<typeof ImagePicker.getPendingResultAsync>>;
  try {
    res = await ImagePicker.getPendingResultAsync();
  } catch {
    return null;
  }
  if (!res || !('assets' in res) || res.canceled || !res.assets?.length) return null;
  const saved = await kv.get<(CameraPurpose & { at: number }) | null>(CAMERA_PURPOSE_KEY, null);
  await kv.remove(CAMERA_PURPOSE_KEY);
  if (!saved || Date.now() - saved.at > CAMERA_PURPOSE_MAX_AGE_MS) return null;
  const { at: _at, ...purpose } = saved;
  const asset = res.assets[0]!;
  // A recorded video (job-step proof) is sent as it is; photos are shrunk first.
  if (asset.type === 'video' || asset.mimeType?.startsWith('video/')) {
    try {
      checkVideo(asset);
    } catch {
      return null;
    }
    return { purpose: purpose as CameraPurpose, photo: toLocalVideo(asset) };
  }
  const uri = await compress(asset.uri, asset.width);
  return { purpose: purpose as CameraPurpose, photo: toLocalPhoto(keepForUpload(uri), 0) };
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

/**
 * Opens an uploaded photo or video full screen: in the phone's in-app browser, which plays MP4 videos with its own
 * player (the app has no video player of its own), or a new tab on web.
 */
export async function openMedia(url: string) {
  if (Platform.OS === 'web') {
    globalThis.open?.(url, '_blank', 'noopener');
    return;
  }
  await WebBrowser.openBrowserAsync(url);
}
