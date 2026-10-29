import { useEffect, useRef, useState } from "react";
import { Loader2, Search, X } from "lucide-react";
import { apiSearchMessages, extractError } from "../../api/chat";
import { useAuthStore } from "../../store/auth";
import Avatar, { nameOf } from "./Avatar";

const DEBOUNCE_MS = 350; // بعد از توقف تایپ جستجو می‌شود
const MIN_CHARS = 2; // هماهنگ با بک‌اند

// شناسهٔ فرستنده — sender هم به‌صورت آبجکت می‌آید هم عدد
function senderIdOf(m) {
  return typeof m.sender === "number" ? m.sender : m.sender?.id;
}

// زمان نتیجه — «امروز ۱۴:۳۲» / «دیروز ۰۹:۱۰» / «۱۲ مهر، ۲۰:۰۱»
function stampOf(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const today = new Date();
  const yest = new Date();
  yest.setDate(today.getDate() - 1);
  const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const time = d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  if (key(d) === key(today)) return `امروز ${time}`;
  if (key(d) === key(yest)) return `دیروز ${time}`;
  const sameYear = d.getFullYear() === today.getFullYear();
  const date = d.toLocaleDateString(
    "fa-IR",
    sameYear ? { day: "numeric", month: "long" } : { day: "numeric", month: "long", year: "numeric" }
  );
  return `${date}، ${time}`;
}

// برشی از متن حول اولین تطابق — برای پیام‌های بلند که تطابقشان پایین‌تر است
function snippet(text, q, pad = 48) {
  const t = text || "";
  if (!q) return t;
  const idx = t.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0 || t.length <= q.length + pad * 2) return t;
  const start = Math.max(0, idx - pad);
  const end = Math.min(t.length, idx + q.length + pad);
  return (start > 0 ? "…" : "") + t.slice(start, end) + (end < t.length ? "…" : "");
}

// متن با تطابق‌های برجسته — بزرگی/کوچکی حروف انگلیسی مهم نیست
function Highlight({ text, q }) {
  if (!q) return <>{text}</>;
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const parts = [];
  let i = 0;
  let key = 0;
  while (i < text.length) {
    const k = lower.indexOf(needle, i);
    if (k < 0) {
      parts.push(<span key={key++}>{text.slice(i)}</span>);
      break;
    }
    if (k > i) parts.push(<span key={key++}>{text.slice(i, k)}</span>);
    parts.push(
      <mark key={key++} className="rounded-sm bg-amber-100 px-0.5 text-inherit">
        {text.slice(k, k + needle.length)}
      </mark>
    );
    i = k + needle.length;
  }
  return <>{parts}</>;
}

/**
 * پنل جستجوی پیام‌های گفتگوی باز (بستهٔ ۳).
 * از سمت چپ روی پیام‌ها باز می‌شود؛ جستجو با توقف تایپ خودکار انجام می‌شود
 * و با کلیک روی هر نتیجه، onJump(شناسهٔ پیام) صدا زده می‌شود.
 */
export default function SearchPanel({ convId, onClose, onJump }) {
  const myId = useAuthStore((s) => s.user?.id ?? s.userId ?? null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [searched, setSearched] = useState(false); // برای تمایز «هنوز جستجو نشده» و «نتیجه‌ای نبود»
  const [error, setError] = useState("");

  const seqRef = useRef(0); // پاسخ‌های کهنه (تایپ سریع) دور ریخته می‌شوند
  const [shown, setShown] = useState(false); // انیمیشن ورود

  // باز شدن نرم از سمت چپ
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // بستن با Escape
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const runSearch = async (q, before = 0, more = false) => {
    const seq = ++seqRef.current;
    setError("");
    if (more) setLoadingMore(true);
    else setLoading(true);
    try {
      const data = await apiSearchMessages(convId, { q, before });
      if (seqRef.current !== seq) return; // جستجوی جدیدتری در راه است
      const list = Array.isArray(data?.results) ? data.results : [];
      setResults((r) =>
        more ? [...r, ...list.filter((m) => !r.some((x) => x.id === m.id))] : list
      );
      setHasMore(Boolean(data?.has_more));
      setSearched(true);
    } catch (e) {
      if (seqRef.current !== seq) return;
      setError(extractError(e));
    } finally {
      if (seqRef.current === seq) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  // جستجوی خودکار بعد از توقف تایپ
  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_CHARS) {
      seqRef.current += 1; // درخواست در حال پرواز باطل شود
      setResults([]);
      setHasMore(false);
      setSearched(false);
      setError("");
      return;
    }
    const t = setTimeout(() => runSearch(q), DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, convId]);

  const loadMore = () => {
    if (!results.length || loadingMore || loading) return;
    runSearch(query.trim(), results[results.length - 1].id, true);
  };

  const q = query.trim();
  const tooShort = q.length === 1;

  return (
    <div
      className={`absolute inset-y-0 left-0 z-40 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 ease-out ${
        shown ? "translate-x-0" : "-translate-x-full"
      }`}
    >
      {/* سرصفحه: بستن + ورودی جستجو */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 px-2 py-2.5">
        <button
          onClick={onClose}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-500 hover:bg-slate-100"
          title="بستن جستجو"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="relative min-w-0 flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جستجو در این گفتگو…"
            className="w-full rounded-xl bg-slate-100 py-2 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
      </div>

      {/* نتایج */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && (
          <div className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
        )}

        {tooShort && !error && (
          <p className="mt-8 text-center text-xs text-slate-400">برای جستجو حداقل ۲ نویسه بنویسید</p>
        )}

        {!q && !error && !searched && (
          <div className="mt-10 flex flex-col items-center gap-2 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
              <Search className="h-6 w-6" />
            </span>
            <p className="text-xs text-slate-400">عبارت را بنویسید تا در پیام‌های این گفتگو جستجو شود</p>
          </div>
        )}

        {loading && !loadingMore && (
          <div className="mt-8 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
          </div>
        )}

        {!loading && !tooShort && searched && results.length === 0 && !error && (
          <div className="mt-10 flex flex-col items-center gap-2 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-400">
              <Search className="h-6 w-6" />
            </span>
            <p className="text-sm font-medium text-slate-500">چیزی پیدا نشد</p>
            <p className="text-xs text-slate-400">عبارت دیگری را امتحان کنید</p>
          </div>
        )}

        {results.map((m) => (
          <button
            key={m.id}
            onClick={() => onJump(m.id)}
            className="flex w-full items-start gap-2.5 rounded-xl p-2.5 transition-colors hover:bg-slate-50"
            title="پرش به این پیام"
          >
            <Avatar user={m.sender} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-xs font-bold text-slate-700">
                  {senderIdOf(m) === myId ? "شما" : nameOf(m.sender)}
                </span>
                <span className="shrink-0 text-[10px] text-slate-400">{stampOf(m.created_at)}</span>
              </div>
              <p className="mt-0.5 line-clamp-2 break-words whitespace-pre-wrap text-sm leading-5 text-slate-600">
                <Highlight text={snippet(m.text, q)} q={q} />
              </p>
            </div>
          </button>
        ))}

        {hasMore && results.length > 0 && (
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="mx-auto mt-1 mb-2 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
          >
            {loadingMore ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                در حال دریافت…
              </>
            ) : (
              "نمایش نتایج بیشتر"
            )}
          </button>
        )}
      </div>
    </div>
  );
}