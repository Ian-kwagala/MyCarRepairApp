// Delivers camera photos that Android separated from the app. On phones with little memory, Android may close the
// app while the camera app is in front; the photo then arrives after the app restarts (or its screen is rebuilt),
// with no screen waiting for it. This component, mounted while signed in, recovers such photos and sends them
// where they belong: task proof (a photo or a recorded video) straight to the job card, form photos back into that
// screen's PhotoPicker.
import { router, usePathname, type Href } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AppState, Platform } from 'react-native';

import { api } from '@/api';
import { errorMessage } from '@/api/errors';
import { recoverCameraPhoto } from '@/services/media';
import { queryClient } from '@/services/query-client';
import { useRecoveredPhotos } from '@/store/recovered-photos';
import { useSession } from '@/store/session';
import { toast } from '@/store/toast';

/** Recovers photos from a camera session Android interrupted (Android only; renders nothing). */
export function CameraRecovery() {
  const userId = useSession((s) => s.session?.user.id);
  const pathname = usePathname();
  // Read inside the AppState callback, which outlives renders.
  const here = useRef(pathname);
  useEffect(() => {
    here.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (Platform.OS !== 'android' || !userId) return;
    let checking = false;
    const check = async () => {
      if (checking) return;
      checking = true;
      try {
        const got = await recoverCameraPhoto();
        if (!got) return;
        const { purpose, photo } = got;
        if (purpose.kind === 'task') {
          // Task proof: upload it and tick the task, exactly as if the camera had returned normally.
          await api.updateTask(purpose.taskId, { isCompleted: true, photo });
          void queryClient.invalidateQueries({ queryKey: ['job', purpose.jobId] });
          void queryClient.invalidateQueries({ queryKey: ['mechanic'] });
          toast({ title: photo.type.startsWith('video/') ? 'Video saved' : 'Photo saved', body: purpose.task, tone: 'success' });
          const card = `/mechanic/job/${purpose.jobId}`;
          if (here.current !== card) router.push(card as Href);
          return;
        }
        // Form photo: hand it to that screen's PhotoPicker; open the screen if it isn't showing.
        useRecoveredPhotos.getState().add(purpose.route, photo);
        if (here.current !== purpose.route) router.push(purpose.route as Href);
      } catch (e) {
        toast({ title: 'Could not save the photo', body: errorMessage(e), tone: 'danger' });
      } finally {
        checking = false;
      }
    };
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [userId]);

  return null;
}
