import { useEffect, useMemo, useState } from "react";
import { Check, History, PhoneIncoming, PhoneOutgoing, Plus, Search, UserPlus, Users, X } from "lucide-react";
import useChatStore from "../../store/chat";
import { useAuthStore } from "../../store/auth";
import { apiListCalls, extractError } from "../../api/chat";

function initial(name) {
  return (name || "؟").trim().charAt(0).toUpperCase();
}

function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function convTitle(conv) {
  return conv.group?.name || conv.other_user?.username || "گفتگو";
}

function callStatusText(status) {
  const map = {
    answered: "پاسخ داده شد",
    missed: "بی‌پاسخ",
    rejected: "رد شد",
    cancelled: "لغو شد",
    busy: "مشغول بود",
  };
  return map[status] || "تماس";
}

// پیش‌نمایش تماس در آیتم گفتگو — «تماس صوتی · بی‌پاسخ»
function callPreview(call) {
  const base = call?.call_type === "video" ? "تماس تصویری" : "تماس صوتی";
  if (call?.status && call.status !== "answered") return `${base} · ${callStatusText(call.status)}`;
  return base;
}

function ConversationItem({ conv, active, onClick }) {
  const isGroup = Boolean(conv.group);
  const other = conv.other_user ?? {};
  const last = conv.last_message ?? null;
  const unread = conv.unread_count ?? 0;
  const online = !isGroup && Boolean(other.online);
  const me = useAuthStore((s) => s.user?.id ?? s.userId ?? null);

  const preview = last
    ? last.kind === "call"
      ? callPreview(last.call)
      : (isGroup && last.sender_id !== me && last.sender_username
        ? `${last.sender_username}: `
        : "") +
      (last.text ||
        (last.attachment_kind === "image"
          ? "تصویر"
          : last.attachment_kind === "voice"
          ? "پیام صوتی"
          : last.attachment_kind === "file"
          ? "فایل"
          : "…"))
    : isGroup
    ? "گروه ساخته شد — اولین پیام را بفرست"
    : "بدون پیام";

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-3 text-right transition-colors ${
        active ? "bg-emerald-50" : "hover:bg-slate-50"
      }`}
    >
      <div className="relative shrink-0">
        <div
          className={`grid h-11 w-11 place-items-center rounded-full text-base font-bold ${
            isGroup ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
          }`}
        >
          {isGroup ? <Users className="h-5 w-5" /> : initial(other.username)}
        </div>
        {!isGroup && (
          <span
            className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white ${
              online ? "bg-emerald-500" : "bg-slate-300"
            }`}
            title={online ? "متصل" : "آفلاین"}
          />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-bold text-slate-800">{convTitle(conv)}</span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {fmtTime(last?.created_at ?? last?.created)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${unread > 0 ? "font-medium text-slate-700" : "text-slate-400"}`}>
            {preview}
          </span>
          {unread > 0 && (
            <span className="min-w-5 shrink-0 rounded-full bg-emerald-600 px-1.5 py-0.5 text-center text-[11px] font-bold text-white">
              {unread > 99 ? "+۹۹" : String(unread)}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function NewChatDialog({ onClose }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const searchUsers = useChatStore((s) => s.searchUsers);
  const createConversation = useChatStore((s) => s.createConversation);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const users = await searchUsers(term);
        const me = useAuthStore.getState();
        const my = me?.user?.id ?? me?.userId ?? null;
        setResults((users ?? []).filter((u) => u.id !== my));
        setError("");
      } catch (e) {
        setError(extractError ? extractError(e) : "خطا در جستجو");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, searchUsers]);

  const start = async (username) => {
    if (creating) return;
    setCreating(true);
    setError("");
    try {
      await createConversation(username);
      onClose();
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در ساخت گفتگو");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <UserPlus className="h-5 w-5 text-emerald-600" />
            گفتگوی جدید
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="نام کاربری را بنویسید…"
            className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          />

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

          <div className="mt-3 max-h-64 overflow-y-auto">
            {loading && <div className="py-6 text-center text-sm text-slate-400">در حال جستجو…</div>}
            {!loading && q.trim() && results.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">کاربری پیدا نشد</div>
            )}
            {!loading && !q.trim() && (
              <div className="py-6 text-center text-xs leading-6 text-slate-400">
                نام کاربری طرف مقابل را بنویسید تا جستجو شود
              </div>
            )}
            {results.map((u) => (
              <button
                key={u.id}
                onClick={() => start(u.username)}
                disabled={creating}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-right hover:bg-slate-50 disabled:opacity-50"
              >
                <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                  {initial(u.username)}
                </div>
                <span className="truncate text-sm font-medium text-slate-700">{u.username}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function NewGroupDialog({ onClose }) {
  const [name, setName] = useState("");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // [{id, username}]
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const searchUsers = useChatStore((s) => s.searchUsers);
  const createGroup = useChatStore((s) => s.createGroup);

  useEffect(() => {
    const term = q.trim();
    if (!term) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const users = await searchUsers(term);
        const me = useAuthStore.getState();
        const my = me?.user?.id ?? me?.userId ?? null;
        setResults((users ?? []).filter((u) => u.id !== my));
        setError("");
      } catch (e) {
        setError(extractError ? extractError(e) : "خطا در جستجو");
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, searchUsers]);

  const toggle = (u) =>
    setSelected((sel) =>
      sel.some((x) => x.id === u.id) ? sel.filter((x) => x.id !== u.id) : [...sel, u]
    );

  const create = async () => {
    if (creating) return;
    if (!name.trim()) {
      setError("نام گروه را وارد کن.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      await createGroup(name.trim(), selected.map((u) => u.username));
      onClose();
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در ساخت گروه");
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Users className="h-5 w-5 text-emerald-600" />
            گروه جدید
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="نام گروه…"
            className="w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-medium outline-none focus:ring-2 focus:ring-emerald-500/40"
          />

          {selected.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {selected.map((u) => (
                <span
                  key={u.id}
                  className="flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700"
                >
                  {u.username}
                  <button onClick={() => toggle(u)} className="text-emerald-400 hover:text-emerald-600" title="حذف از انتخاب">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="جستجوی نام کاربری برای افزودن عضو…"
            className="mt-3 w-full rounded-xl bg-slate-100 px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          />

          {error && <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

          <div className="mt-3 max-h-56 overflow-y-auto">
            {loading && <div className="py-6 text-center text-sm text-slate-400">در حال جستجو…</div>}
            {!loading && q.trim() && results.length === 0 && (
              <div className="py-6 text-center text-sm text-slate-400">کاربری پیدا نشد</div>
            )}
            {!loading && !q.trim() && (
              <div className="py-6 text-center text-xs leading-6 text-slate-400">
                اعضای اولیه را جستجو و انتخاب کن — بعداً هم می‌توانی داخل گروه عضو اضافه کنی
              </div>
            )}
            {results.map((u) => {
              const picked = selected.some((x) => x.id === u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggle(u)}
                  className={`flex w-full items-center gap-3 rounded-xl px-2 py-2 text-right transition-colors ${
                    picked ? "bg-emerald-50" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                    {initial(u.username)}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{u.username}</span>
                  {picked && <Check className="h-4 w-4 shrink-0 text-emerald-600" />}
                </button>
              );
            })}
          </div>

          <button
            onClick={create}
            disabled={creating || !name.trim()}
            className="mt-4 w-full rounded-xl bg-emerald-600 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
          >
            {creating ? "در حال ساخت…" : "ساخت گروه"}
          </button>
        </div>
      </div>
    </div>
  );
}

// پنل «تماس‌های اخیر» — از دکمه‌ی تاریخِ بالای سایدبار باز می‌شود
function CallsPanel({ onClose }) {
  const [calls, setCalls] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const setActive = useChatStore((s) => s.setActive);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const list = await apiListCalls();
        if (!dead) setCalls(Array.isArray(list) ? list : list?.results ?? []);
      } catch (e) {
        if (!dead) setError(extractError ? extractError(e) : "خطا در دریافت تماس‌ها");
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => {
      dead = true;
    };
  }, []);

  const fmtWhen = (iso) => {
    try {
      const d = new Date(iso);
      const today = new Date();
      const yest = new Date();
      yest.setDate(today.getDate() - 1);
      const same = (a, b) =>
        a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
      const time = d.toLocaleTimeString("fa-IR", { hour: "2-digit", minute: "2-digit" });
      if (same(d, today)) return time;
      if (same(d, yest)) return `دیروز، ${time}`;
      return `${d.toLocaleDateString("fa-IR", { day: "numeric", month: "short" })}، ${time}`;
    } catch {
      return "";
    }
  };

  const fmtDur = (sec) => {
    sec = Math.max(0, Math.floor(sec || 0));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <History className="h-5 w-5 text-emerald-600" />
            تماس‌های اخیر
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-96 overflow-y-auto p-2">
          {loading && <div className="py-8 text-center text-sm text-slate-400">در حال دریافت…</div>}
          {error && <div className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {!loading && !error && (calls?.length ?? 0) === 0 && (
            <div className="py-8 text-center text-sm text-slate-400">هنوز تماسی نداشته‌اید</div>
          )}
          {(calls ?? []).map((c) => {
            const ok = c.status === "answered";
            const DirIcon = c.outgoing ? PhoneOutgoing : PhoneIncoming;
            return (
              <button
                key={c.id}
                onClick={() => {
                  onClose();
                  setActive(c.conversation_id);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-right transition-colors hover:bg-slate-50"
              >
                <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                  {initial(c.peer?.username)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-800">{c.peer?.username ?? "کاربر"}</div>
                  <div className={`mt-0.5 flex items-center gap-1 text-xs ${ok ? "text-slate-400" : "text-red-500"}`}>
                    <DirIcon className="h-3.5 w-3.5" />
                    <span>
                      {c.call_type === "video" ? "تصویری" : "صوتی"} · {callStatusText(c.status)}
                      {ok && c.duration > 0 ? ` · ${fmtDur(c.duration)}` : ""}
                    </span>
                  </div>
                </div>
                <span className="shrink-0 text-[11px] text-slate-400">{fmtWhen(c.created_at)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const loading = useChatStore((s) => s.conversationsLoading);
  const setActive = useChatStore((s) => s.setActive);

  const [filter, setFilter] = useState("");
  const [chatDialogOpen, setChatDialogOpen] = useState(false);
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [callsOpen, setCallsOpen] = useState(false);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return conversations;
    return conversations.filter((c) => convTitle(c).toLowerCase().includes(f));
  }, [conversations, filter]);

  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative flex-1">
          <Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="جستجو در گفتگوها…"
            className="w-full rounded-xl bg-slate-100 py-2 pl-3 pr-9 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
        </div>
        <button
          onClick={() => setCallsOpen(true)}
          title="تماس‌های اخیر"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-500 transition-colors hover:bg-slate-200"
        >
          <History className="h-5 w-5" />
        </button>
        <button
          onClick={() => setGroupDialogOpen(true)}
          title="گروه جدید"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 transition-colors hover:bg-emerald-200"
        >
          <Users className="h-5 w-5" />
        </button>
        <button
          onClick={() => setChatDialogOpen(true)}
          title="گفتگوی جدید"
          className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && conversations.length === 0 ? (
          <div className="space-y-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-11 w-11 animate-pulse rounded-full bg-slate-100" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                  <div className="h-3 w-3/4 animate-pulse rounded bg-slate-100" />
                </div>
              </div>
            ))}
          </div>
        ) : list.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
            <p className="text-sm font-medium text-slate-500">
              {filter ? "گفتگویی با این نام پیدا نشد" : "هنوز گفتگویی ندارید"}
            </p>
            {!filter && (
              <div className="flex items-center gap-3">
                <button onClick={() => setChatDialogOpen(true)} className="text-xs font-medium text-emerald-600 hover:underline">
                  شروع گفتگو
                </button>
                <span className="text-slate-300">|</span>
                <button onClick={() => setGroupDialogOpen(true)} className="text-xs font-medium text-emerald-600 hover:underline">
                  ساخت گروه
                </button>
              </div>
            )}
          </div>
        ) : (
          list.map((c) => (
            <ConversationItem key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)} />
          ))
        )}
      </div>

      {chatDialogOpen && <NewChatDialog onClose={() => setChatDialogOpen(false)} />}
      {groupDialogOpen && <NewGroupDialog onClose={() => setGroupDialogOpen(false)} />}
      {callsOpen && <CallsPanel onClose={() => setCallsOpen(false)} />}
    </div>
  );
}