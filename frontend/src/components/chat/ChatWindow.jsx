import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Check, CheckCheck, Loader2, MoreHorizontal, Pencil, SendHorizonal, Trash2, X,
} from "lucide-react";
import useChatStore from "../../store/chat";
import { useAuthStore } from "../../store/auth";
import { extractError } from "../../api/chat";

const EMPTY_BUCKET = { list: [], hasMore: false, loading: false };

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

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso) {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (dayKey(d) === dayKey(today)) return "امروز";
  if (dayKey(d) === dayKey(yesterday)) return "دیروز";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(
    "fa-IR",
    sameYear
      ? { day: "numeric", month: "long" }
      : { day: "numeric", month: "long", year: "numeric" }
  );
}

function DaySeparator({ label }) {
  return (
    <div className="my-4 flex items-center justify-center">
      <span className="rounded-full bg-slate-200/70 px-3 py-1 text-[11px] font-medium text-slate-500">
        {label}
      </span>
    </div>
  );
}

function lastSeenText(iso) {
  if (!iso) return "آفلاین";
  try {
    return `آخرین بازدید ${new Date(iso).toLocaleString("fa-IR", { dateStyle: "short", timeStyle: "short" })}`;
  } catch {
    return "آفلاین";
  }
}

export default function ChatWindow() {
  const activeId = useChatStore((s) => s.activeId);
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const bucket = useChatStore((s) => s.messages[s.activeId] ?? EMPTY_BUCKET);
  const typingMap = useChatStore((s) => s.typing[s.activeId]);
  const readUpTo = useChatStore((s) => s.readUpTo[s.activeId] ?? 0);
  const myId = useAuthStore((s) => s.user?.id ?? s.userId ?? null);

  const setActive = useChatStore((s) => s.setActive);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const sendTyping = useChatStore((s) => s.sendTyping);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuFor, setMenuFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [, setTick] = useState(0);

  const scrollRef = useRef(null);
  const stickBottom = useRef(true);
  const restoreRef = useRef(null);
  const lastTypingSent = useRef(0);

  const other = conv?.other_user ?? {};

  // «در حال نوشتن…» با انقضای زمانی
  const otherTyping = Object.entries(typingMap ?? {}).some(
    ([uid, until]) => Number(uid) !== myId && until > Date.now()
  );

  useEffect(() => {
    if (!typingMap || Object.keys(typingMap).length === 0) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [typingMap]);

  // ریست موقع عوض شدن گفتگو
  useEffect(() => {
    stickBottom.current = true;
    restoreRef.current = null;
    setEditing(null);
    setMenuFor(null);
    setError("");
  }, [activeId]);

  // مدیریت اسکرول: پایین‌چسبی یا حفظ موقعیت بعد از بارگذاری قدیمی‌ها
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (restoreRef.current) {
      const { height, top } = restoreRef.current;
      restoreRef.current = null;
      el.scrollTop = el.scrollHeight - height + top;
    } else if (stickBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [bucket.list.length, activeId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (el.scrollTop < 60 && bucket.hasMore && !bucket.loading && bucket.list.length > 0) {
      const first = bucket.list[0];
      restoreRef.current = { height: el.scrollHeight, top: el.scrollTop };
      loadMessages(activeId, { before: first.id });
    }
  };

  const onTextChange = (e) => {
    const v = e.target.value;
    setText(v);
    if (v.trim()) {
      const now = Date.now();
      if (now - lastTypingSent.current > 2000) {
        lastTypingSent.current = now;
        sendTyping(activeId, true);
      }
    } else if (lastTypingSent.current) {
      lastTypingSent.current = 0;
      sendTyping(activeId, false);
    }
  };

  const stopTypingSignal = () => {
    if (lastTypingSent.current) {
      lastTypingSent.current = 0;
      sendTyping(activeId, false);
    }
  };

  const doSend = async () => {
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    setError("");
    try {
      setText("");
      stopTypingSignal();
      await sendMessage(activeId, t);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در ارسال پیام");
      setText(t);
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  };

  const startEdit = (m) => {
    setMenuFor(null);
    setEditing({ id: m.id });
    setEditText(m.text ?? "");
  };

  const saveEdit = async () => {
    const t = editText.trim();
    if (!editing || !t || savingEdit) return;
    setSavingEdit(true);
    setError("");
    try {
      await editMessage(activeId, editing.id, t);
      setEditing(null);
      setEditText("");
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در ویرایش پیام");
    } finally {
      setSavingEdit(false);
    }
  };

  const doDelete = async (m) => {
    setMenuFor(null);
    if (!window.confirm("این پیام برای هر دو طرف حذف شود؟")) return;
    setError("");
    try {
      await deleteMessage(activeId, m.id);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در حذف پیام");
    }
  };

  const renderBubble = (m) => {
    const mine = (typeof m.sender === "number" ? m.sender : m.sender?.id) === myId;
    const isEditing = editing?.id === m.id;
    const isEdited = Boolean(m.edited_at ?? m.edited);

    return (
      <div key={m.id} className={`group mb-2 flex items-end gap-1.5 ${mine ? "justify-end" : "justify-start"}`}>
        <div
          className={`relative max-w-[78%] rounded-2xl px-3.5 py-2 shadow-sm ${
            mine
              ? "rounded-bl-md bg-emerald-600 text-white"
              : "rounded-br-md border border-slate-100 bg-white text-slate-800"
          }`}
        >
          {isEditing ? (
            <div className="min-w-[200px]">
              <textarea
                autoFocus
                rows={2}
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveEdit();
                  }
                  if (e.key === "Escape") setEditing(null);
                }}
                className="w-full resize-none rounded-lg bg-black/10 p-2 text-sm text-slate-800 outline-none"
              />
              <div className="mt-1.5 flex gap-2">
                <button
                  onClick={saveEdit}
                  disabled={savingEdit}
                  className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-medium hover:bg-white/30 disabled:opacity-50"
                >
                  <Check className="h-3.5 w-3.5" /> ثبت
                </button>
                <button
                  onClick={() => setEditing(null)}
                  className="flex items-center gap-1 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-medium hover:bg-white/30"
                >
                  <X className="h-3.5 w-3.5" /> لغو
                </button>
              </div>
            </div>
          ) : (
            <>
              <p className="whitespace-pre-wrap break-words text-sm leading-6">{m.text}</p>
              <div className={`mt-1 flex items-center gap-1.5 text-[10px] ${mine ? "text-emerald-100" : "text-slate-400"}`}>
                {isEdited && <span>ویرایش‌شده</span>}
                <span className="mr-auto flex items-center gap-1">
                  {fmtTime(m.created_at ?? m.created)}
                  {mine &&
                    (m.id <= readUpTo ? (
                      <CheckCheck className="h-3.5 w-3.5" title="خوانده شد" />
                    ) : (
                      <Check className="h-3.5 w-3.5" title="ارسال شد" />
                    ))}
                </span>
              </div>
            </>
          )}
        </div>

        {mine && !isEditing && (
          <div className="relative shrink-0 pb-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setMenuFor(menuFor === m.id ? null : m.id);
              }}
              className="grid h-7 w-7 place-items-center rounded-full text-slate-400 opacity-0 transition-opacity hover:bg-slate-200 hover:text-slate-600 group-hover:opacity-100"
              title="گزینه‌ها"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
            {menuFor === m.id && (
              <div className="absolute bottom-full left-0 z-20 mb-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                <button
                  onClick={() => startEdit(m)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Pencil className="h-4 w-4" /> ویرایش
                </button>
                <button
                  onClick={() => doDelete(m)}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-red-600 hover:bg-red-50"
                >
                  <Trash2 className="h-4 w-4" /> حذف
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  if (!conv) {
    return (
      <div className="flex h-full w-full items-center justify-center text-sm text-slate-400">
        در حال بارگذاری گفتگو…
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-slate-50">
      {/* هدر گفتگو */}
      <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5">
        <button
          onClick={() => setActive(null)}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden"
          title="بازگشت"
        >
          <ArrowRight className="h-5 w-5" />
        </button>

        <div className="relative shrink-0">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-200 font-bold text-slate-600">
            {initial(other.username)}
          </div>
          <span
            className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white ${
              other.online ? "bg-emerald-500" : "bg-slate-300"
            }`}
          />
        </div>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-bold text-slate-800">{other.username ?? "کاربر"}</div>
          <div className="h-4 text-xs text-slate-500">
            {otherTyping ? (
              <span className="font-medium text-emerald-600">در حال نوشتن…</span>
            ) : other.online ? (
              "متصل"
            ) : (
              lastSeenText(other.last_seen)
            )}
          </div>
        </div>
      </div>

      {/* ناحیه پیام‌ها */}
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onClick={() => menuFor && setMenuFor(null)}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6"
      >
        {bucket.loading && bucket.list.length > 0 && (
          <div className="mb-3 flex justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
          </div>
        )}
        {bucket.list.length === 0 && !bucket.loading && (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-sm font-medium text-slate-400">هنوز پیامی رد و بدل نشده</p>
            <p className="text-xs text-slate-400">اولین پیام را شما بفرستید</p>
          </div>
        )}
        <div className="mx-auto flex max-w-3xl flex-col">
          {bucket.list.map((m, i) => {
            const prev = bucket.list[i - 1];
            const ts = m.created_at ?? m.created;
            const prevTs = prev?.created_at ?? prev?.created;
            const showDay = !prev || dayKey(prevTs) !== dayKey(ts);
            return (
              <div key={m.id}>
                {showDay && <DaySeparator label={dayLabel(ts)} />}
                {renderBubble(m)}
              </div>
            );
          })}
        </div>
      </div>

      {/* جعبه نوشتن */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-3">
        {error && <div className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <textarea
            rows={1}
            value={text}
            onChange={onTextChange}
            onKeyDown={onKeyDown}
            onBlur={stopTypingSignal}
            placeholder="پیام خود را بنویسید…"
            className="max-h-32 min-h-[44px] flex-1 resize-none rounded-2xl bg-slate-100 px-4 py-2.5 text-sm leading-6 outline-none focus:ring-2 focus:ring-emerald-500/40"
          />
          <button
            onClick={doSend}
            disabled={!text.trim() || sending}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
            title="ارسال"
          >
            {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5 -scale-x-100" />}
          </button>
        </div>
      </div>
    </div>
  );
}