// کمک‌تابع‌های مربوط به نمایش کاربر

// قانون نمایش نام: display_name اگر تنظیم شده باشد، وگرنه username
export function displayName(user) {
  const name = (user?.display_name ?? "").toString().trim();
  return name || user?.username || "کاربر";
}