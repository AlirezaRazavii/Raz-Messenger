import { useEffect } from "react";
import { BellRing, X } from "lucide-react";
import { useNotifyStore } from "../../store/notify";
import useChatStore from "../../store/chat";

// عمر هر پاپ‌آپ — با هر پیام تازه در همان گفتگو از نو شروع می‌شود
const TOAST_MS = 4500;

function Toast({ t }) {
  const dismiss = useNotifyStore((s) => s.dismiss);
  const setActive = useChatStore((s) => s.setActive);

  // تایمر خود-بستن — وابسته به t.at تا با رساندن پیام تازه ریست شود
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [t.at, t.id, dismiss]);

  return (
    <div
      onClick={() => {
        setActive(t.convId);
        dismiss(t.id);
      }}
      className="animate-toast-in pointer-events-auto flex w-72 cursor-pointer items-start gap-2.5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-xl shadow-slate-900/10 backdrop-blur transition-colors hover:bg-white"
      title="باز کردن گفتگو"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-emerald-100 text-emerald-600">
        <BellRing className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-bold text-slate-800">{t.title}</span>
            {(t.count ?? 1) > 1 && (
              <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700">
                {(t.count ?? 1).toLocaleString("fa-IR")} پیام
              </span>
            )}
          </span>
          <button
            onClick={(e) => {
              e.stopPropagation();
              dismiss(t.id);
            }}
            className="shrink-0 rounded-lg p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            title="بستن"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
        <span className="mt-0.5 block truncate text-xs leading-5 text-slate-500" dir="auto">
          {t.body || "پیام جدید"}
        </span>
      </span>
    </div>
  );
}

// لایهٔ پاپ‌آپ اعلان‌ها — گوشهٔ پایین چپ، روی همهٔ لایه‌ها (حتی مودال تماس)
export default function NotifyToasts() {
  const toasts = useNotifyStore((s) => s.toasts);
  if (!toasts.length) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-[70] flex w-72 flex-col-reverse gap-2">
      {toasts.map((t) => (
        <Toast key={t.id} t={t} />
      ))}
    </div>
  );
}