import moment from "moment-jalaali";

moment.locale("fa");

/** ساعت کوتاه مثل ۱۴:۳۲ */
export function timeShort(iso) {
  return iso ? moment(iso).format("HH:mm") : "";
}

/** زمان لیست: امروز فقط ساعت، امسال روز شمسی، وگرنه تاریخ کامل */
export function listTime(iso) {
  if (!iso) return "";
  const m = moment(iso);
  if (m.isSame(moment(), "day")) return m.format("HH:mm");
  if (m.isSame(moment(), "year")) return m.format("jD jMMMM");
  return m.format("jYYYY/jM/jD");
}