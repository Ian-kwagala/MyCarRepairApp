// Short pop-up messages ("toasts") shown at the top of the screen. At most 3 show at once and each
// disappears after 4.5 seconds.
import { create } from 'zustand';

/** Colour/meaning of a toast. */
export type ToastTone = 'info' | 'success' | 'danger' | 'warning';

/** One toast; `onPress` makes it tappable (e.g. to open the related job). */
export interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: ToastTone;
  onPress?: () => void;
}

interface ToastState {
  toasts: Toast[];
  show: (t: Omit<Toast, 'id' | 'tone'> & { tone?: ToastTone }) => void;
  dismiss: (id: number) => void;
}

// Counter for unique toast IDs.
let seq = 0;

/** Hook for the visible toasts, used by the component that renders them. */
export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (t) => {
    const id = ++seq;
    // Keep the 2 newest plus this one, and remove this one automatically after 4.5 s.
    set((s) => ({ toasts: [...s.toasts.slice(-2), { tone: 'info', ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

/** Shows a toast from anywhere, including outside React components. Tone defaults to 'info'. */
export const toast = (t: Omit<Toast, 'id' | 'tone'> & { tone?: ToastTone }) => useToast.getState().show(t);
