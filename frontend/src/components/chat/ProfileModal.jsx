import { useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { apiGetProfile } from "../../api/auth";
import { extractError } from "../../api/chat";
import { displayName } from "../../utils/user";
import Avatar from "./Avatar";

// کارت پروفایل کاربر — با کلیک روی آواتار/نام در هدر چت خصوصی باز می‌شود.
// اطلاعات کامل (بایو، عضویت از، آنلاین) از سرور تازه گرفته می‌شود.
export default function ProfileModal({ userId, conv, onClose }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    setProfile(null);
    setError("");
    apiGetProfile(userId)
      .then(({ data }) => alive && setProfile(data))
      .catch((e) => alive && setError(extractError ? extractError(e) : "خطا در دریافت پروفایل"));
    return () => {
      alive = false;
    };
  }, [userId]);

  const p = profile;
  const online = p?.online ?? conv?.other_user?.online ?? false;

  return (
    <div
      className="fixed inset-0 z-[80] grid place-items-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="font-bold text-slate-800">پروفایل کاربر</span>
          <button
            onClick={onClose}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-3 px-4 py-6">
          {error ? (
            <p className="text-sm text-red-600">{error}</p>
          ) : !p ? (
            <div className="flex h-32 items-center gap-2 text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" /> در حال بارگذاری…
            </div>
          ) : (
            <>
              <div className="relative">
                <Avatar user={p} className="h-24 w-24 text-4xl" />
                <span
                  className={`absolute bottom-1 left-1 h-4 w-4 rounded-full border-[3px] border-white ${
                    online ? "bg-emerald-500" : "bg-slate-300"
                  }`}
                  title={online ? "متصل" : "آفلاین"}
                />
              </div>

              <div className="text-center">
                <div className="text-lg font-bold text-slate-800">{displayName(p)}</div>
                <div className="mt-0.5 text-sm text-slate-500" dir="ltr">@{p.username}</div>
              </div>

              {p.bio ? (
                <p className="rounded-xl bg-slate-50 px-3 py-2 text-center text-sm leading-6 text-slate-600">
                  {p.bio}
                </p>
              ) : (
                <p className="text-xs text-slate-400">بیو نوشته نشده است</p>
              )}

              <div className="flex w-full items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-500">
                <span>عضو «راز» از</span>
                <span dir="ltr" className="font-medium text-slate-700">
                  {new Date(p.date_joined).toLocaleDateString("fa-IR", {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}