import { useEffect, useState } from "react";
import { AtSign, X } from "lucide-react";
import Avatar, { nameOf } from "./Avatar";
import { apiGetUserProfile, extractError } from "../../api/chat";

// نمایش زمان «آخرین بازدید» به فارسی
function lastSeenText(iso) {
  if (!iso) return "آخرین بازدید نامشخص";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return `آخرین بازدید امروز ${d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" })}`;
    }
    return `آخرین بازدید ${d.toLocaleDateString("fa-IR", { day: "numeric", month: "short" })}`;
  } catch {
    return "آخرین بازدید نامشخص";
  }
}

/**
 * کارت پروفایل — با کلیک روی سرِ گفتگوی خصوصی باز می‌شود.
 * مثل تلگرام: آواتار بزرگ + نام + @نام‌کاربری + بایو + وضعیت آنلاین.
 */
export default function ProfileCard({ userId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const p = await apiGetUserProfile(userId);
        if (!dead) setProfile(p);
      } catch (e) {
        if (!dead) setError(extractError(e));
      }
    })();
    return () => {
      dead = true;
    };
  }, [userId]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="font-bold text-slate-800">اطلاعات کاربر</div>
          <button
            onClick={onClose}
            className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error && <div className="m-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

        {!profile && !error && (
          <div className="py-10 text-center text-sm text-slate-400">در حال دریافت…</div>
        )}

        {profile && (
          <div className="flex flex-col items-center gap-3 p-6">
            <Avatar user={profile} size="xl" />

            <div className="text-center">
              <div className="text-lg font-bold text-slate-800">{nameOf(profile)}</div>
              <div className="mt-1 flex items-center justify-center gap-1 text-sm text-emerald-700" dir="ltr">
                <AtSign className="h-3.5 w-3.5" />
                <span className="font-medium">{profile.username}</span>
              </div>
            </div>

            {profile.bio && (
              <div className="w-full rounded-xl bg-slate-50 px-4 py-3 text-center text-sm leading-6 text-slate-600">
                {profile.bio}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              <span
                className={`h-2 w-2 rounded-full ${profile.online ? "bg-emerald-500" : "bg-slate-300"}`}
              />
              {profile.online ? "همین حالا آنلاین است" : lastSeenText(profile.last_seen)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}