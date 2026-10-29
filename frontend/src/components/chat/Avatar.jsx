import { useState } from "react";
import { Users } from "lucide-react";

// دامنهٔ بک‌اند — همان قاعدهٔ client.js؛ برای <img> که هدر JWT ندارد
const BACKEND = `${window.location.protocol}//${window.location.hostname}:8000`;
export function absUrl(path) {
  if (!path) return null;
  return path.startsWith("http") ? path : BACKEND + path;
}

// نام نمایشی کاربر — خالی بود یعنی همان نام کاربری
export function nameOf(user) {
  return user?.display_name?.trim() || user?.username || "";
}

export function initialOf(name) {
  const n = (name || "").trim();
  return n ? n.charAt(0).toUpperCase() : "؟";
}

const SIZES = {
  xs: "h-7 w-7 text-[11px]",
  sm: "h-9 w-9 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-11 w-11 text-base",
  xl: "h-20 w-20 text-2xl",
};

const DOTS = { xs: "h-2 w-2", sm: "h-2.5 w-2.5", md: "h-3 w-3", lg: "h-3 w-3", xl: "h-4 w-4" };

/**
 * آواتار مشترک اپ — برای هر جایی که کاربر یا گروه دیده می‌شود.
 *
 * user: {avatar_url, username, display_name}  |  group: true → آواتار گروهی
 * size: xs|sm|md|lg|xl  |  online: undefined=بدون نقطه، true/false=با نقطهٔ وضعیت
 */
export default function Avatar({ user, group, size = "md", online, className = "" }) {
  const [broken, setBroken] = useState(false);
  const url = !group && user?.avatar_url && !broken ? absUrl(user.avatar_url) : null;
  const name = nameOf(user);

  return (
    <span className={`relative inline-grid shrink-0 place-items-center ${SIZES[size]} ${className}`}>
      {url ? (
        <img
          src={url}
          onError={() => setBroken(true)}
          alt={name}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          className={`grid h-full w-full place-items-center rounded-full font-bold ${
            group ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
          }`}
        >
          {group ? <Users className="h-1/2 w-1/2" /> : initialOf(name)}
        </span>
      )}
      {online !== undefined && !group && (
        <span
          className={`absolute bottom-0 left-0 ${DOTS[size]} rounded-full border-2 border-white ${
            online ? "bg-emerald-500" : "bg-slate-300"
          }`}
        />
      )}
    </span>
  );
}