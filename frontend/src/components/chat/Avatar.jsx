import { useEffect, useState } from "react";
import { apiUrl } from "../../api/client";

// آواتار کاربر — عکس پروفایل اگر باشد، وگرنه دایره‌ی رنگی با حرف اول نام.
// رنگ دایره از نام کاربری ساخته می‌شود تا برای هر نفر همیشه یکی باشد.
const COLORS = [
  "bg-emerald-500",
  "bg-sky-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-teal-500",
  "bg-indigo-500",
  "bg-fuchsia-500",
];

function colorFor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLORS[h % COLORS.length];
}

/**
 * user: آبجکت با username/display_name/avatar_url (یا فقط username)
 * className: اندازه و استایل ظاهری مثل "h-11 w-11 text-base"
 */
export default function Avatar({ user, name, src, className = "h-10 w-10", title }) {
  const effective = name || (user?.display_name ?? "").toString().trim() || user?.username || "؟";
  const url = src || user?.avatar_url || null;
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);

  if (url && !broken) {
    return (
      <img
        src={apiUrl(url)}
        alt={effective}
        title={title}
        draggable={false}
        onError={() => setBroken(true)}
        className={`rounded-full object-cover ${className}`}
      />
    );
  }
  return (
    <div
      title={title}
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${colorFor(user?.username || effective)} ${className}`}
    >
      {effective.trim().charAt(0).toUpperCase()}
    </div>
  );
}