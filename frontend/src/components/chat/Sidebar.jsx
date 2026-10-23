import { useEffect, useMemo, useState } from "react";
import { Plus, Search, UserPlus, X } from "lucide-react";
import useChatStore from "../../store/chat";
import * as authModule from "../../store/auth";

const useAuthStore =
  authModule.default ??
  authModule.useAuthStore ??
  authModule.useAuth ??
  authModule.authStore;
import { extractError } from "../../api/chat";

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

function ConversationItem({ conv, active, onClick }) {
  const other = conv.other_user ?? {};
  const last = conv.last_message ?? null;
  const unread = conv.unread_count ?? 0;
  const online = Boolean(other.online);

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-3 text-right transition-colors ${
        active ? "bg-emerald-50" : "hover:bg-slate-50"
      }`}
    >
      <div className="relative shrink-0">
        <div className="grid h-11 w-11 place-items-center rounded-full bg-slate-200 text-base font-bold text-slate-600">
          {initial(other.username)}
        </div>
        <span
          className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white ${
            online ? "bg-emerald-500" : "bg-slate-300"
          }`}
          title={online ? "متصل" : "آفلاین"}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="truncate font-bold text-slate-800">{other.username ?? "کاربر"}</span>
          <span className="shrink-0 text-[11px] text-slate-400">
            {fmtTime(last?.created_at ?? last?.created)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`truncate text-sm ${unread > 0 ? "font-medium text-slate-700" : "text-slate-400"}`}>
            {last ? last.text || "…" : "بدون پیام"}
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

export default function Sidebar() {
  const conversations = useChatStore((s) => s.conversations);
  const activeId = useChatStore((s) => s.activeId);
  const loading = useChatStore((s) => s.conversationsLoading);
  const setActive = useChatStore((s) => s.setActive);

  const [filter, setFilter] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const list = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return conversations;
    return conversations.filter((c) =>
      (c.other_user?.username ?? "").toLowerCase().includes(f)
    );
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
          onClick={() => setDialogOpen(true)}
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
              <button onClick={() => setDialogOpen(true)} className="text-xs font-medium text-emerald-600 hover:underline">
                شروع اولین گفتگو
              </button>
            )}
          </div>
        ) : (
          list.map((c) => (
            <ConversationItem key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)} />
          ))
        )}
      </div>

      {dialogOpen && <NewChatDialog onClose={() => setDialogOpen(false)} />}
    </div>
  );
}