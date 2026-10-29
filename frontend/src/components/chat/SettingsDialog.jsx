import { useRef, useState } from "react";
import { AtSign, Camera, Eye, EyeOff, Loader2, LogOut, ShieldCheck, Trash2, X } from "lucide-react";
import { apiChangePassword, apiChangePasswordConfirm, apiDeleteAvatar, apiLogout, apiUpdateProfile, apiUploadAvatar } from "../../api/auth";
import { parseApiError } from "../../api/client";
import { useAuthStore } from "../../store/auth";
import Avatar from "./Avatar";

// نام‌های کاربری رزروشده — همان لیست بک‌اند
const RESERVED = ["me", "admin", "root", "api", "null", "undefined"];

// فیلد رمز با چشم نمایش/مخفی — هم‌سبک بقیهٔ مودال
function PasswordInput({ name, value, onChange, placeholder, error, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          name={name}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          autoComplete={autoComplete}
          dir="ltr"
          className={`w-full rounded-xl bg-slate-100 py-2 pl-9 pr-3 text-left text-sm outline-none focus:ring-2 focus:ring-emerald-500/40 ${
            error ? "ring-2 ring-red-300" : ""
          }`}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow((s) => !s)}
          className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 transition hover:text-slate-600"
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {error && <span className="mt-1 block text-xs text-red-600">{error}</span>}
    </div>
  );
}

// تنظیمات — مودال داخل خود اپ؛ با دکمهٔ چرخ‌دنده در سرِ سایدبار باز می‌شود.
// دو زبانه: پروفایل (عکس + نام + بایو + نام کاربری) و امنیت (تغییر رمز) + خروج.
export default function SettingsDialog({ onClose }) {
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const setAuth = useAuthStore((s) => s.setAuth);
  const fileRef = useRef(null);

  const [tab, setTab] = useState("profile"); // profile | security
  const [busy, setBusy] = useState(false); // آپلود یا حذف عکس در جریان است
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false); // نمایش موقتی «ذخیره شد»

  const [form, setForm] = useState({
    display_name: user?.display_name ?? "",
    bio: user?.bio ?? "",
    username: user?.username ?? "",
  });
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // --- تغییر رمز (دو مرحله‌ای، مثل قبل) ---
  const [pwStep, setPwStep] = useState(1); // 1: رمز فعلی → 2: کد + رمز جدید
  const [pwForm, setPwForm] = useState({ current_password: "", code: "", new_password: "", new_password2: "" });
  const [pwBusy, setPwBusy] = useState(false);
  const [pwError, setPwError] = useState("");
  const [pwDone, setPwDone] = useState(false);

  const apply = (data) => {
    setUser(data);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const onChange = (e) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setFieldErrors((fe) => ({ ...fe, [e.target.name]: undefined }));
  };

  const onPwChange = (e) => {
    setPwForm((f) => ({ ...f, [e.target.name]: e.target.value }));
    setPwError("");
  };

  // --- عکس پروفایل ---

  const onPickFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // بتوان همان فایل را دوباره انتخاب کرد
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      setError("حجم عکس باید کمتر از ۵ مگابایت باشد.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      const { data } = await apiUploadAvatar(file);
      apply(data);
    } catch (err) {
      setError(parseApiError(err).general || "آپلود عکس ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAvatar = async () => {
    setError("");
    setBusy(true);
    try {
      const { data } = await apiDeleteAvatar();
      apply(data);
    } catch (err) {
      setError(parseApiError(err).general || "حذف عکس ناموفق بود.");
    } finally {
      setBusy(false);
    }
  };

  // --- فرم پروفایل ---

  const onSaveProfile = async (e) => {
    e.preventDefault();
    const dn = form.display_name.trim();
    const bio = form.bio.trim();
    const un = form.username.trim();

    // اعتبارسنجی سمت کاربر — همان قواعد بک‌اند
    const errors = {};
    if (dn.length > 64) errors.display_name = "نام نمایشی حداکثر ۶۴ کاراکتر است.";
    if (bio.length > 160) errors.bio = "بایو حداکثر ۱۶۰ کاراکتر است.";
    if (!/^[a-z0-9_]{4,32}$/.test(un)) {
      errors.username = "فقط حروف کوچک انگلیسی، رقم و _ — بین ۴ تا ۳۲ کاراکتر.";
    } else if (RESERVED.includes(un)) {
      errors.username = "این نام کاربری قابل استفاده نیست.";
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length) return;

    setError("");
    setSaving(true);
    try {
      const { data } = await apiUpdateProfile({ display_name: dn, bio, username: un });
      apply(data);
    } catch (err) {
      const parsed = parseApiError(err);
      setError(parsed.general);
      setFieldErrors(parsed.fields);
    } finally {
      setSaving(false);
    }
  };

  // --- تغییر رمز ---

  const onPwStep1 = async (e) => {
    e.preventDefault();
    if (!pwForm.current_password) {
      setPwError("رمز عبور فعلی را وارد کنید.");
      return;
    }
    setPwError("");
    setPwBusy(true);
    try {
      await apiChangePassword({ current_password: pwForm.current_password });
      setPwStep(2);
    } catch (err) {
      setPwError(parseApiError(err).general || parseApiError(err).fields?.current_password || "خطا در تأیید رمز.");
    } finally {
      setPwBusy(false);
    }
  };

  const onPwStep2 = async (e) => {
    e.preventDefault();
    const c = pwForm.code.trim();
    let msg = "";
    if (!/^\d{6}$/.test(c)) msg = "کد ۶ رقمی ارسال‌شده به ایمیل را وارد کنید.";
    else if (pwForm.new_password.length < 8) msg = "رمز عبور جدید باید حداقل ۸ کاراکتر باشد.";
    else if (pwForm.new_password2 !== pwForm.new_password) msg = "تکرار رمز عبور مطابقت ندارد.";
    if (msg) {
      setPwError(msg);
      return;
    }

    setPwBusy(true);
    try {
      const { data } = await apiChangePasswordConfirm({
        code: pwForm.code.trim(),
        new_password: pwForm.new_password,
        new_password2: pwForm.new_password2,
      });
      // توکن‌های تازه ذخیره می‌شود تا از این دستگاه بیرون نیفتیم
      setAuth(data.access, data.refresh, data.user);
      setPwDone(true);
      setPwStep(1);
      setPwForm({ current_password: "", code: "", new_password: "", new_password2: "" });
    } catch (err) {
      const parsed = parseApiError(err);
      setPwError(parsed.general || parsed.fields?.code || "خطا در تغییر رمز.");
    } finally {
      setPwBusy(false);
    }
  };

  // --- خروج ---

  const onLogout = async () => {
    const refresh = useAuthStore.getState().refresh;
    try {
      if (refresh) await apiLogout(refresh);
    } catch {
      // حتی اگر سرور جواب نداد، محلی خارج می‌شویم
    }
    useAuthStore.getState().logout();
    onClose();
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/40 p-4"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
      >
        {/* سرصفحه + زبانه‌ها */}
        <div className="shrink-0 border-b border-slate-100">
          <div className="flex items-center justify-between px-4 py-3">
            <span className="font-bold text-slate-800">تنظیمات</span>
            <button
              onClick={onClose}
              className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex gap-1 px-3">
            {[
              ["profile", "پروفایل"],
              ["security", "امنیت"],
            ].map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`-mb-px border-b-2 px-3 pb-2 pt-1 text-sm font-medium transition-colors ${
                  tab === key
                    ? "border-emerald-600 text-emerald-700"
                    : "border-transparent text-slate-400 hover:text-slate-600"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* بدنه — قابل اسکرول */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {tab === "profile" ? (
            <>
              {/* --- عکس پروفایل --- */}
              <div className="flex flex-col items-center gap-3">
                <div className="relative">
                  <Avatar user={user} size="xl" />
                  {busy && (
                    <span className="absolute inset-0 grid place-items-center rounded-full bg-white/60">
                      <Loader2 className="h-6 w-6 animate-spin text-emerald-600" />
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fileRef.current?.click()}
                    disabled={busy}
                    className="flex items-center gap-1.5 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-50"
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {user?.avatar_url ? "تغییر عکس" : "انتخاب عکس"}
                  </button>
                  {user?.avatar_url && (
                    <button
                      onClick={onDeleteAvatar}
                      disabled={busy}
                      className="flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-1.5 text-xs font-medium text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      حذف
                    </button>
                  )}
                </div>

                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickFile}
                />

                {error && <p className="text-xs text-red-600">{error}</p>}
              </div>

              <hr className="my-4 border-slate-100" />

              {/* --- فرم پروفایل --- */}
              <form onSubmit={onSaveProfile} className="space-y-3">
                <div className="text-sm font-bold text-slate-700">پروفایل</div>

                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>نام نمایشی</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      {form.display_name.length}/64
                    </span>
                  </span>
                  <input
                    name="display_name"
                    value={form.display_name}
                    onChange={onChange}
                    maxLength={64}
                    placeholder="نامی که بقیه می‌بینند"
                    className="w-full rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                  {fieldErrors.display_name && (
                    <span className="mt-1 block text-xs text-red-600">
                      {fieldErrors.display_name}
                    </span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 flex items-center justify-between text-xs font-medium text-slate-500">
                    <span>بایو</span>
                    <span className="text-[10px] font-normal text-slate-400">
                      {form.bio.length}/160
                    </span>
                  </span>
                  <textarea
                    name="bio"
                    value={form.bio}
                    onChange={onChange}
                    maxLength={160}
                    rows={2}
                    placeholder="چند جمله درباره خودتان"
                    className="w-full resize-none rounded-xl bg-slate-100 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                  />
                  {fieldErrors.bio && (
                    <span className="mt-1 block text-xs text-red-600">{fieldErrors.bio}</span>
                  )}
                </label>

                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-slate-500">نام کاربری</span>
                  <div className="relative">
                    <AtSign className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      name="username"
                      value={form.username}
                      onChange={onChange}
                      dir="ltr"
                      className="w-full rounded-xl bg-slate-100 py-2 pl-3 pr-9 text-left text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                    />
                  </div>
                  <span className="mt-1 block text-[10px] text-slate-400">
                    حروف کوچک انگلیسی، رقم و _ — بین ۴ تا ۳۲ کاراکتر
                  </span>
                  {fieldErrors.username && (
                    <span className="mt-1 block text-xs text-red-600">
                      {fieldErrors.username}
                    </span>
                  )}
                </label>

                <button
                  type="submit"
                  disabled={saving}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      در حال ذخیره…
                    </>
                  ) : saved ? (
                    "ذخیره شد ✓"
                  ) : (
                    "ذخیره"
                  )}
                </button>
              </form>
            </>
          ) : (
            <>
              {/* --- زبانهٔ امنیت: تغییر رمز --- */}
              {pwDone && (
                <div className="mb-3 flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                  رمز عبور با موفقیت تغییر کرد و با رمز جدید در همین دستگاه وارد هستید.
                </div>
              )}

              {pwStep === 1 ? (
                <form onSubmit={onPwStep1} className="space-y-3">
                  <div className="text-sm font-bold text-slate-700">تغییر رمز عبور</div>
                  <p className="text-xs leading-5 text-slate-400">
                    برای امنیت بیشتر، تغییر رمز با کدی که به ایمیل شما ارسال می‌شود تأیید می‌شود.
                  </p>
                  <PasswordInput
                    name="current_password"
                    value={pwForm.current_password}
                    onChange={onPwChange}
                    placeholder="رمز عبور فعلی"
                    autoComplete="current-password"
                  />
                  {pwError && <p className="text-xs text-red-600">{pwError}</p>}
                  <button
                    type="submit"
                    disabled={pwBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {pwBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        در حال بررسی…
                      </>
                    ) : (
                      "ارسال کد تأیید به ایمیل"
                    )}
                  </button>
                </form>
              ) : (
                <form onSubmit={onPwStep2} className="space-y-3">
                  <div className="text-sm font-bold text-slate-700">تأیید با کد ایمیل</div>
                  <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    کد تأیید به ایمیل شما ارسال شد (تا ۱۰ دقیقه معتبر است).
                  </div>
                  <PasswordInput
                    name="code"
                    value={pwForm.code}
                    onChange={onPwChange}
                    placeholder="------"
                    autoComplete="one-time-code"
                  />
                  <PasswordInput
                    name="new_password"
                    value={pwForm.new_password}
                    onChange={onPwChange}
                    placeholder="رمز عبور جدید (حداقل ۸ کاراکتر)"
                    autoComplete="new-password"
                  />
                  <PasswordInput
                    name="new_password2"
                    value={pwForm.new_password2}
                    onChange={onPwChange}
                    placeholder="تکرار رمز عبور جدید"
                    autoComplete="new-password"
                  />
                  {pwError && <p className="text-xs text-red-600">{pwError}</p>}
                  <button
                    type="submit"
                    disabled={pwBusy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {pwBusy ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        در حال تغییر…
                      </>
                    ) : (
                      "تغییر رمز عبور"
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPwStep(1);
                      setPwError("");
                    }}
                    className="w-full text-center text-xs text-slate-400 hover:text-slate-600"
                  >
                    بازگشت
                  </button>
                </form>
              )}
            </>
          )}
        </div>

        {/* پاصفحه — خروج */}
        <div className="shrink-0 border-t border-slate-100 p-3">
          <button
            onClick={onLogout}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-red-50 py-2 text-sm font-bold text-red-600 transition-colors hover:bg-red-100"
          >
            <LogOut className="h-4 w-4" />
            خروج از حساب
          </button>
        </div>
      </div>
    </div>
  );
}