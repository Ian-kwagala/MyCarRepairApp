import { create } from 'zustand';

export type ToastTone = 'info' | 'success' | 'danger' | 'warning';

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

let seq = 0;

export const useToast = create<ToastState>((set) => ({
  toasts: [],
  show: (t) => {
    const id = ++seq;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { tone: 'info', ...t, id }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 4500);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));

export const toast = (t: Omit<Toast, 'id' | 'tone'> & { tone?: ToastTone }) => useToast.getState().show(t);
