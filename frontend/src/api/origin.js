// مبدأ بک‌اند — تنها منبع حقیقت آدرس‌ها در کل فرانت.
// توسعه (vite dev): متغیر تعریف نشده → همان قاعدهٔ قبل، بک‌اند روی پورت 8000 همین hostname.
// پروداکشن (vite build): فایل .env.production مقدار «خالی» می‌دهد → هم‌دامنه با خود سایت ("").
export const API_ORIGIN =
  import.meta.env.VITE_API_ORIGIN ??
  `${window.location.protocol}//${window.location.hostname}:8000`;

// آدرس وب‌سوکت — از همان مبدأ ساخته می‌شود (wss در https، ws در http)
export function wsUrl() {
  if (!API_ORIGIN) {
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    return `${scheme}://${window.location.host}/ws/`;
  }
  return `${API_ORIGIN.replace(/^http/, "ws")}/ws/`;
}