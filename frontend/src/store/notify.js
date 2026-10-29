import { create } from "zustand";

// پاپ‌آپ اعلانِ داخل خود اپ — بر خلاف Notification مرورگر،
// به مجوز، HTTPS یا localhost نیازی ندارد و در هر تب/پنجره‌ای (حتی ناشناس) دیده می‌شود.
let nextId = 1;
const MAX_TOASTS = 4;

export const useNotifyStore = create((set, get) => ({
  toasts: [],

  // پیام تازه در گفتگو — اگر toast همان گفتگو از قبل باز باشد،
  // فقط متن و شمارنده به‌روز می‌شود (مثل رفتار tag در نوتیف مرورگر)
  push: (convId, title, body) => {
    const existing = get().toasts.find((t) => t.convId === convId);
    if (existing) {
      set((s) => ({
        toasts: s.toasts.map((t) =>
          t.convId === convId
            ? { ...t, title, body, count: (t.count ?? 1) + 1, at: Date.now() }
            : t
        ),
      }));
      return existing.id;
    }
    const id = nextId++;
    set((s) => ({
      toasts: [
        { id, convId, title, body, count: 1, at: Date.now() },
        ...s.toasts,
      ].slice(0, MAX_TOASTS),
    }));
    return id;
  },

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));