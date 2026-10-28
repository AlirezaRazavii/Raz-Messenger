import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight, Check, CheckCheck, Copy, Crown, Download, File as FileIcon, Forward,
  Image as ImageIcon, Loader2, LogOut, Mic, MoreHorizontal, Paperclip, Pencil, Phone, PhoneCall,
  PhoneIncoming, PhoneMissed, PhoneOutgoing, Play,
  Reply, SendHorizonal, Trash2, Users, UserPlus, Video, X,
} from "lucide-react";
import useChatStore from "../../store/chat";
import { useAuthStore } from "../../store/auth";
import { extractError, apiDownloadAttachment } from "../../api/chat";
import useCallStore from "../../store/call";

const EMPTY_BUCKET = { list: [], hasMore: false, loading: false };
const MAX_UPLOAD_MB = 25;
const MAX_VOICE_SEC = 300; // حداکثر ۵ دقیقه برای هر ویس

// کش نشانی‌های blob تصاویر و ویس‌ها — دوباره فچر نشود وقتی حباب دوباره رندر می‌شود
const objectUrlCache = new Map();

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

function fmtSize(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} بایت`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} کیلوبایت`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} مگابایت`;
}

// تایمر ضبط ویس: 0:07 یا 1:23
function fmtRecTime(sec) {
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
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

function fmtCallDur(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

// ردیف سیستمی تماس — مثل تلگرام وسط چت؛ کلیک روی آن = تماس مجدد
function CallRow({ message, mine, onRedial }) {
  const call = message.call ?? {};
  const answered = call.status === "answered";
  const Icon = answered ? PhoneCall : mine ? PhoneOutgoing : PhoneIncoming;
  const label =
    `${call.call_type === "video" ? "تماس تصویری" : "تماس صوتی"} · ${callStatusText(call.status)}` +
    (answered && call.duration > 0 ? ` · ${fmtCallDur(call.duration)}` : "");

  return (
    <div className="my-1.5 flex justify-center">
      <button
        onClick={onRedial}
        title="تماس مجدد"
        className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition-colors hover:bg-slate-100 ${
          answered ? "text-slate-500" : "text-red-500"
        }`}
      >
        <Icon className={`h-3.5 w-3.5 ${answered ? "text-emerald-600" : ""}`} />
        <span className="font-medium">{label}</span>
        <span className="text-slate-300">·</span>
        <span className="text-slate-400">{fmtTime(message.created_at ?? message.created)}</span>
      </button>
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

// فشرده‌سازی عکس سمت کلاینت — پهنای حداکثر ۱۶۰۰، کیفیت ۰٫۸۵
function compressImage(file, maxDim = 1600, quality = 0.85) {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return Promise.resolve(file);
  if (file.size < 300 * 1024) return Promise.resolve(file); // عکس کوچک: لازم نیست
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      try {
        let { width, height } = img;
        const scale = Math.min(1, maxDim / Math.max(width, height));
        width = Math.round(width * scale);
        height = Math.round(height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // پس‌زمینه شفاف PNG در JPEG سیاه نشود
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob(
          (blob) => {
            if (!blob || blob.size >= file.size) {
              resolve(file);
              return;
            }
            const out = new File([blob], file.name.replace(/\.\w+$/, ".jpg"), {
              type: "image/jpeg",
            });
            resolve(out);
          },
          "image/jpeg",
          quality
        );
      } catch {
        resolve(file);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

// حباب تصویر — «دانلود دل‌خواه» مثل تلگرام
function MediaImage({ message, onOpen }) {
  const [url, setUrl] = useState(objectUrlCache.get(message.id) ?? null);
  const [downloading, setDownloading] = useState(false);
  const [failed, setFailed] = useState(false);

  const download = async () => {
    if (downloading || url) return;
    setDownloading(true);
    setFailed(false);
    try {
      const blob = await apiDownloadAttachment(message.id);
      if (!blob) throw new Error("empty");
      if (objectUrlCache.size > 300) {
        for (const old of objectUrlCache.values()) URL.revokeObjectURL(old);
        objectUrlCache.clear();
      }
      const u = URL.createObjectURL(blob);
      objectUrlCache.set(message.id, u);
      setUrl(u);
    } catch {
      setFailed(true);
    } finally {
      setDownloading(false);
    }
  };

  if (failed) {
    return (
      <div className="mb-1 flex h-48 w-64 flex-col items-center justify-center gap-2 rounded-lg bg-black/10 text-xs opacity-70">
        خطا در دانلود تصویر
        <button onClick={download} className="rounded-full bg-black/10 px-3 py-1 hover:bg-black/20">
          تلاش مجدد
        </button>
      </div>
    );
  }
  if (url) {
    return (
      <img
        src={url}
        alt={message.attachment_name || "تصویر"}
        onClick={() => onOpen(url)}
        className="mb-1 max-h-72 w-auto max-w-full cursor-zoom-in rounded-lg object-cover"
      />
    );
  }
  return (
    <div className="mb-1 grid h-48 w-64 place-items-center rounded-lg bg-black/10">
      {downloading ? (
        <div className="flex flex-col items-center gap-2 text-xs opacity-70">
          <Loader2 className="h-5 w-5 animate-spin" />
          در حال دانلود…
        </div>
      ) : (
        <button
          onClick={download}
          className="flex flex-col items-center gap-2 text-xs opacity-80 transition-opacity hover:opacity-100"
          title="دانلود تصویر"
        >
          <span className="grid h-10 w-10 place-items-center rounded-full bg-black/10">
            <Download className="h-5 w-5" />
          </span>
          تصویر · {fmtSize(message.attachment_size)}
        </button>
      )}
    </div>
  );
}

// حباب فایل/ویس — دانلود/پخش فقط با کلیک کاربر
function MediaFile({ message, mine, onDownload }) {
  const isVoice = message.attachment_kind === "voice";
  const [audioUrl, setAudioUrl] = useState(objectUrlCache.get(message.id) ?? null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const play = async () => {
    if (loading || audioUrl) return;
    setLoading(true);
    setFailed(false);
    try {
      const blob = await apiDownloadAttachment(message.id);
      if (!blob) throw new Error("empty");
      const u = URL.createObjectURL(blob);
      objectUrlCache.set(message.id, u);
      setAudioUrl(u);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  if (isVoice) {
    if (audioUrl) {
      return (
        <audio
          controls
          src={audioUrl}
          preload="none"
          onLoadedMetadata={(e) => {
            // کروم برای webm مدت را اول Infinity نشان می‌دهد — این ترفند آن را درست می‌کند
            const a = e.currentTarget;
            if (a.duration === Infinity || Number.isNaN(a.duration)) {
              a.currentTime = 1e101;
              a.ontimeupdate = () => {
                a.ontimeupdate = null;
                a.currentTime = 0;
              };
            }
          }}
          className="mb-1 h-9 w-60"
        />
      );
    }
    return (
      <div className={`mb-1 flex min-w-[220px] items-center gap-3 rounded-xl p-2.5 ${mine ? "bg-white/15" : "bg-slate-100"}`}>
        <button
          onClick={play}
          disabled={loading}
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
            mine ? "bg-white/20 text-white hover:bg-white/30" : "bg-white text-slate-500 hover:bg-slate-200"
          } disabled:opacity-50`}
          title="پخش"
        >
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Play className="h-5 w-5" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">پیام صوتی</div>
          <div className={`text-[11px] ${mine ? "text-emerald-100" : "text-slate-500"}`}>
            {message.voice_duration ? `${message.voice_duration} ثانیه` : ""}
            {failed ? " — خطا! دوباره بزن" : ""}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mb-1 flex min-w-[220px] max-w-full items-center gap-3 rounded-xl p-2.5 ${
        mine ? "bg-white/15" : "bg-slate-100"
      }`}
    >
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${
          mine ? "bg-white/20" : "bg-white"
        }`}
      >
        <FileIcon className={`h-5 w-5 ${mine ? "text-white" : "text-slate-500"}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{message.attachment_name || "فایل"}</div>
        <div className={`text-[11px] ${mine ? "text-emerald-100" : "text-slate-500"}`}>
          {fmtSize(message.attachment_size)}
        </div>
      </div>
      <button
        onClick={onDownload}
        title="دانلود"
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${
          mine ? "text-white hover:bg-white/20" : "text-slate-500 hover:bg-slate-200"
        }`}
      >
        <Download className="h-4 w-4" />
      </button>
    </div>
  );
}

function ForwardDialog({ message, onClose }) {
  const conversations = useChatStore((s) => s.conversations);
  const forwardMessage = useChatStore((s) => s.forwardMessage);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  const pick = async (conv) => {
    if (busyId != null) return;
    setBusyId(conv.id);
    setError("");
    try {
      await forwardMessage(message.id, conv.id);
      onClose();
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در فوروارد پیام");
      setBusyId(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2 font-bold text-slate-800">
            <Forward className="h-5 w-5 text-emerald-600" />
            فوروارد پیام
          </div>
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2">
          <div className="truncate text-xs text-slate-500" title={message?.text}>{message?.text}</div>
        </div>

        <div className="p-2">
          {error && <div className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}
          {conversations.length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">گفتگوی دیگری وجود ندارد</div>
          )}
          <div className="max-h-72 overflow-y-auto">
            {conversations.map((c) => {
              const isGroup = Boolean(c.group);
              return (
                <button
                  key={c.id}
                  onClick={() => pick(c)}
                  disabled={busyId != null}
                  className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-right hover:bg-slate-50 disabled:opacity-50"
                >
                  <div
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${
                      isGroup ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {isGroup ? <Users className="h-4 w-4" /> : initial(c.other_user?.username)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-700">
                      {c.group?.name || c.other_user?.username || "گفتگو"}
                    </div>
                    <div className="truncate text-xs text-slate-400">
                      {isGroup && c.last_message?.sender_username
                        ? `${c.last_message.sender_username}: ${c.last_message?.text ?? ""}`
                        : c.last_message?.text ?? "بدون پیام"}
                    </div>
                  </div>
                  {busyId === c.id && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-emerald-600" />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// پنل اعضای گروه — تغییر نام، افزودن/حذف عضو، خروج، حذف گروه (فاز ۴)
function GroupMembersDialog({ onClose }) {
  const group = useChatStore((s) => s.activeGroup);
  const loadActiveGroup = useChatStore((s) => s.loadActiveGroup);
  const renameGroup = useChatStore((s) => s.renameGroup);
  const addGroupMember = useChatStore((s) => s.addGroupMember);
  const removeGroupMember = useChatStore((s) => s.removeGroupMember);
  const deleteGroup = useChatStore((s) => s.deleteGroup);
  const searchUsers = useChatStore((s) => s.searchUsers);
  const myId = useAuthStore((s) => s.user?.id ?? s.userId ?? null);

  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [addQ, setAddQ] = useState("");
  const [addResults, setAddResults] = useState([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const myRole = group?.my_role ?? "";
  const canManage = myRole === "owner" || myRole === "admin";

  // تازه‌سازی اعضا و وضعیت آنلاین هنگام باز شدن پنل
  useEffect(() => {
    if (group?.id) loadActiveGroup(group.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const term = addQ.trim();
    if (!term || !canManage) {
      setAddResults([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const users = await searchUsers(term);
        const memberIds = new Set((group?.members ?? []).map((m) => m.id));
        setAddResults((users ?? []).filter((u) => !memberIds.has(u.id)));
      } catch {
        setAddResults([]);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [addQ, group, canManage, searchUsers]);

  if (!group) return null;

  const doRename = async () => {
    const n = newName.trim();
    if (!n || busy) return;
    setBusy(true);
    setError("");
    try {
      await renameGroup(group.id, n);
      setRenaming(false);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در تغییر نام گروه");
    } finally {
      setBusy(false);
    }
  };

  const doAdd = async (username) => {
    if (adding || busy) return;
    setAdding(true);
    setError("");
    try {
      await addGroupMember(group.id, username);
      setAddQ("");
      setAddResults([]);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در افزودن عضو");
    } finally {
      setAdding(false);
    }
  };

  const doRemove = async (m) => {
    if (busy) return;
    if (!window.confirm(`«${m.username}» از گروه حذف شود؟`)) return;
    setBusy(true);
    setError("");
    try {
      await removeGroupMember(group.id, m.id);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در حذف عضو");
    } finally {
      setBusy(false);
    }
  };

  const doLeave = async () => {
    if (busy) return;
    if (!window.confirm("از این گروه خارج می‌شوی؟")) return;
    setBusy(true);
    setError("");
    try {
      await removeGroupMember(group.id, myId);
      onClose(); // گفتگو بسته و از لیست حذف می‌شود
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در خروج از گروه");
      setBusy(false);
    }
  };

  const doDelete = async () => {
    if (busy) return;
    if (!window.confirm("گروه برای همه‌ی اعضا حذف شود؟ این کار برگشت ندارد.")) return;
    setBusy(true);
    setError("");
    try {
      await deleteGroup(group.id);
      onClose();
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در حذف گروه");
      setBusy(false);
    }
  };

  // قواعد حذف عضو — قرینه‌ی بک‌اند
  const canRemove = (m) => {
    if (m.id === myId) return false;
    if (m.role === "owner") return false;
    if (myRole === "owner") return true;
    if (myRole === "admin") return m.role === "member";
    return false;
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <Users className="h-5 w-5 shrink-0 text-emerald-600" />
            {renaming ? (
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") doRename();
                    if (e.key === "Escape") setRenaming(false);
                  }}
                  className="min-w-0 flex-1 rounded-lg bg-slate-100 px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <button onClick={doRename} disabled={busy} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50">
                  ثبت
                </button>
                <button onClick={() => setRenaming(false)} className="rounded-lg bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200">
                  لغو
                </button>
              </div>
            ) : (
              <>
                <span className="min-w-0 truncate font-bold text-slate-800">{group.name}</span>
                {canManage && (
                  <button
                    onClick={() => {
                      setNewName(group.name);
                      setRenaming(true);
                    }}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title="تغییر نام گروه"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </>
            )}
          </div>
          <button onClick={onClose} className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">
          {group.members?.length ?? 0} عضو
          {myRole === "owner" && " — تو سازنده‌ی گروهی"}
          {myRole === "admin" && " — تو مداری"}
        </div>

        <div className="p-2">
          {error && <div className="m-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>}

          <div className="max-h-72 overflow-y-auto">
            {(group.members ?? []).map((m) => (
              <div key={m.id} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-slate-50">
                <div className="relative shrink-0">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-slate-200 text-sm font-bold text-slate-600">
                    {initial(m.username)}
                  </div>
                  <span
                    className={`absolute bottom-0 left-0 h-2.5 w-2.5 rounded-full border-2 border-white ${
                      m.online ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-700">
                      {m.username}
                      {m.id === myId && <span className="text-slate-400"> (تو)</span>}
                    </span>
                    {m.role === "owner" && <Crown className="h-3.5 w-3.5 shrink-0 text-amber-500" title="سازنده گروه" />}
                    {m.role === "admin" && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 text-[10px] font-bold text-emerald-700">مدیر</span>
                    )}
                  </div>
                </div>
                {canRemove(m) && (
                  <button
                    onClick={() => doRemove(m)}
                    disabled={busy}
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                    title="حذف از گروه"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>

          {canManage && (
            <div className="mt-2 border-t border-slate-100 pt-2">
              <div className="flex items-center gap-2 rounded-xl bg-slate-100 px-3 py-1.5">
                <UserPlus className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={addQ}
                  onChange={(e) => setAddQ(e.target.value)}
                  placeholder="افزودن عضو با نام کاربری…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
                {adding && <Loader2 className="h-4 w-4 animate-spin text-emerald-600" />}
              </div>
              {addResults.length > 0 && (
                <div className="mt-1 max-h-32 overflow-y-auto">
                  {addResults.map((u) => (
                    <button
                      key={u.id}
                      onClick={() => doAdd(u.username)}
                      disabled={adding}
                      className="flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-right hover:bg-slate-50 disabled:opacity-50"
                    >
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-200 text-xs font-bold text-slate-600">
                        {initial(u.username)}
                      </div>
                      <span className="truncate text-sm text-slate-700">{u.username}</span>
                      <UserPlus className="mr-auto h-4 w-4 shrink-0 text-emerald-600" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            {myRole !== "owner" && (
              <button
                onClick={doLeave}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-slate-100 py-2 text-xs font-bold text-slate-600 hover:bg-slate-200 disabled:opacity-50"
              >
                <LogOut className="h-3.5 w-3.5" />
                خروج از گروه
              </button>
            )}
            {myRole === "owner" && (
              <button
                onClick={doDelete}
                disabled={busy}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-red-50 py-2 text-xs font-bold text-red-600 hover:bg-red-100 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                حذف گروه
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatWindow() {
  const activeId = useChatStore((s) => s.activeId);
  const conv = useChatStore((s) => s.conversations.find((c) => c.id === s.activeId) ?? null);
  const bucket = useChatStore((s) => s.messages[s.activeId] ?? EMPTY_BUCKET);
  const typingMap = useChatStore((s) => s.typing[s.activeId]);
  const readUpTo = useChatStore((s) => s.readUpTo[s.activeId] ?? 0);
  const activeGroup = useChatStore((s) => s.activeGroup);
  const myId = useAuthStore((s) => s.user?.id ?? s.userId ?? null);

  const setActive = useChatStore((s) => s.setActive);
  const loadMessages = useChatStore((s) => s.loadMessages);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const editMessage = useChatStore((s) => s.editMessage);
  const deleteMessage = useChatStore((s) => s.deleteMessage);
  const sendTyping = useChatStore((s) => s.sendTyping);
  const startCall = useCallStore((s) => s.startCall);

  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [menuFor, setMenuFor] = useState(null);
  const [editing, setEditing] = useState(null);
  const [editText, setEditText] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [forwarding, setForwarding] = useState(null);
  const [pending, setPending] = useState(null); // { file, kind, url }
  const [lightbox, setLightbox] = useState(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recSecs, setRecSecs] = useState(0);
  const [tick, setTick] = useState(0);

  const scrollRef = useRef(null);
  const stickBottom = useRef(true);
  const restoreRef = useRef(null);
  const lastTypingSent = useRef(0);
  const imageInputRef = useRef(null);
  const fileInputRef = useRef(null);

  // ضبط ویس
  const mediaRecorderRef = useRef(null);
  const recStreamRef = useRef(null);
  const chunksRef = useRef([]);
  const recStartRef = useRef(0);
  const recTimerRef = useRef(null);
  const discardRef = useRef(false);

  const other = conv?.other_user ?? {};
  const isGroup = Boolean(conv?.group);
  const groupName = activeGroup?.name ?? conv?.group?.name ?? "گروه";
  const memberCount = activeGroup?.member_count ?? conv?.group?.member_count ?? null;

  const otherTyping = Object.entries(typingMap ?? {}).some(
    ([uid, until]) => Number(uid) !== myId && until > Date.now()
  );

  // نام تایپ‌کننده‌های گروه — هر ثانیه تازه می‌شود (تیک) تا TTLها منقضی شوند
  const typingNames = useMemo(() => {
    if (!typingMap) return [];
    const now = Date.now();
    const members = activeGroup?.members ?? [];
    const names = [];
    for (const [uid, until] of Object.entries(typingMap)) {
      if (until <= now) continue;
      if (myId != null && Number(uid) === myId) continue;
      names.push(members.find((m) => m.id === Number(uid))?.username ?? "عضو گروه");
    }
    return names;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typingMap, activeGroup, myId, tick]);

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
    setReplyTo(null);
    setForwarding(null);
    setError("");
    setMembersOpen(false);
    if (pending?.url) URL.revokeObjectURL(pending.url);
    setPending(null);
    cancelVoiceRecording(); // ضبط نیمه‌تمام هنگام تغییر گفتگو دور ریخته می‌شود
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  // توقف کامل ضبط هنگام بسته شدن صفحه
  useEffect(() => {
    return () => {
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      const rec = mediaRecorderRef.current;
      if (rec && rec.state !== "inactive") {
        try {
          rec.stop();
        } catch {}
      }
      if (recStreamRef.current) {
        recStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // مدیریت اسکرول
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

  // ---------- پیوست ----------
  const pickImage = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`حجم فایل نمی‌تواند بیش از ${MAX_UPLOAD_MB} مگابایت باشد.`);
      return;
    }
    setError("");
    const out = await compressImage(file);
    setPending({ file: out, kind: "image", url: URL.createObjectURL(out) });
  };

  const pickFile = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
      setError(`حجم فایل نمی‌تواند بیش از ${MAX_UPLOAD_MB} مگابایت باشد.`);
      return;
    }
    setError("");
    setPending({ file, kind: "file", url: null });
  };

  const removePending = () => {
    if (pending?.url) URL.revokeObjectURL(pending.url);
    setPending(null);
  };

  // ---------- ضبط ویس (فاز ۳-ج) ----------
  const pickVoiceMime = () => {
    if (typeof MediaRecorder === "undefined") return "";
    const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
    for (const c of candidates) {
      try {
        if (MediaRecorder.isTypeSupported(c)) return c;
      } catch {}
    }
    return "";
  };

  // توقف ضبط: discard=true یعنی دور انداخته شود
  const stopRec = (discard) => {
    const rec = mediaRecorderRef.current;
    if (!rec || rec.state === "inactive") return;
    discardRef.current = discard;
    try {
      rec.stop();
    } catch {}
  };

  const stopVoiceRecording = () => stopRec(false);
  const cancelVoiceRecording = () => stopRec(true);

  const startVoiceRecording = async () => {
    if (recording || sending || pending) return;
    setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError(
        window.isSecureContext
          ? "این مرورگر از ضبط صدا پشتیبانی نمی‌کند."
          : "میکروفون فقط روی localhost یا https کار می‌کند. فعلاً از خودِ کامپیوتر ویس بفرست."
      );
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("دسترسی به میکروفون رد شد.");
      return;
    }
    const mime = pickVoiceMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 32000 } : undefined);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("راه‌اندازی ضبط صدا در این مرورگر ممکن نشد.");
      return;
    }

    chunksRef.current = [];
    discardRef.current = false;
    recStartRef.current = Date.now();
    mediaRecorderRef.current = rec;
    recStreamRef.current = stream;

    rec.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    rec.onstop = async () => {
      if (recTimerRef.current) {
        clearInterval(recTimerRef.current);
        recTimerRef.current = null;
      }
      const secs = Math.max(1, Math.round((Date.now() - recStartRef.current) / 1000));
      if (recStreamRef.current) {
        recStreamRef.current.getTracks().forEach((t) => t.stop());
        recStreamRef.current = null;
      }
      const discarded = discardRef.current;
      discardRef.current = false;
      const chunks = chunksRef.current;
      chunksRef.current = [];
      setRecording(false);
      setRecSecs(0);
      if (discarded || chunks.length === 0) return;

      const type = mime || "audio/webm";
      const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
      const blob = new Blob(chunks, { type });
      const file = new File([blob], `voice-${Date.now()}.${ext}`, { type });
      setSending(true);
      try {
        const created = await sendMessage(
          activeId,
          "",
          replyTo?.id ?? null,
          { file, kind: "voice", duration: secs }
        );
        setReplyTo(null);
        // فرستنده بتواند ویس خودش را بی‌درنگ پخش کند — بدون دانلود مجدد از سرور
        if (created?.id) {
          if (objectUrlCache.size > 300) {
            for (const old of objectUrlCache.values()) URL.revokeObjectURL(old);
            objectUrlCache.clear();
          }
          objectUrlCache.set(created.id, URL.createObjectURL(blob));
        }
      } catch (e) {
        setError(extractError ? extractError(e) : "خطا در ارسال پیام صوتی");
      } finally {
        setSending(false);
      }
    };

    try {
      rec.start(250);
    } catch {
      stream.getTracks().forEach((t) => t.stop());
      setError("شروع ضبط ممکن نشد.");
      return;
    }
    setRecSecs(0);
    setRecording(true);
    recTimerRef.current = setInterval(() => {
      const elapsed = (Date.now() - recStartRef.current) / 1000;
      setRecSecs(elapsed);
      if (Math.floor(elapsed) >= MAX_VOICE_SEC) stopRec(false); // توقف خودکار در سقف مجاز
    }, 250);
  };

  const doDownload = async (m) => {
    setError("");
    try {
      const blob = await apiDownloadAttachment(m.id);
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u;
      a.download = m.attachment_name || "file";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در دانلود فایل");
    }
  };

  const doCopy = async (m) => {
    setMenuFor(null);
    try {
      await navigator.clipboard.writeText(m.text ?? "");
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = m.text ?? "";
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {}
    }
  };

  const startReply = (m) => {
    setMenuFor(null);
    setReplyTo(m);
  };

  const startForward = (m) => {
    setMenuFor(null);
    setForwarding(m);
  };

  const doSend = async () => {
    const t = text.trim();
    if (recording || (!t && !pending) || sending) return;
    setSending(true);
    setError("");
    const att = pending;
    try {
      setText("");
      stopTypingSignal();
      setPending(null);
      const created = await sendMessage(
        activeId,
        t,
        replyTo?.id ?? null,
        att ? { file: att.file, kind: att.kind } : null
      );
      // فرستنده عکس خودش را بی‌درنگ ببیند (مثل تلگرام) — بدون دانلود مجدد از سرور
      if (att?.kind === "image" && created?.id) {
        if (objectUrlCache.size > 300) {
          for (const old of objectUrlCache.values()) URL.revokeObjectURL(old);
          objectUrlCache.clear();
        }
        objectUrlCache.set(created.id, URL.createObjectURL(att.file));
      }
      if (att?.url) URL.revokeObjectURL(att.url);
      setReplyTo(null);
    } catch (e) {
      setError(extractError ? extractError(e) : "خطا در ارسال پیام");
      setText(t);
      setPending(att); // پیوست برای تلاش مجدد سر جایش می‌مانَد
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
    // ردیف سیستمی تماس — حباب ندارد؛ وسط چت نشان داده می‌شود
    if (m.kind === "call") {
      return (
        <CallRow
          message={m}
          mine={mine}
          onRedial={() => conv && startCall(conv, m.call?.call_type === "video" ? "video" : "audio")}
        />
      );
    }
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
              {isGroup && !mine && (
                <div className="mb-0.5 text-[11px] font-bold text-emerald-700">
                  {m.sender?.username ?? "کاربر"}
                </div>
              )}
              {m.reply_to && (
                <div
                  className={`mb-1.5 truncate rounded-lg border-r-2 px-2 py-1 text-[11px] leading-5 ${
                    mine
                      ? "border-emerald-200 bg-emerald-500/25 text-emerald-50"
                      : "border-emerald-500 bg-emerald-50 text-slate-600"
                  }`}
                  title={m.reply_to.text}
                >
                  <span className="font-bold">{m.reply_to.sender_username ?? "کاربر"}: </span>
                  {m.reply_to.text}
                </div>
              )}
              {m.attachment_kind === "image" && (
                <MediaImage message={m} onOpen={setLightbox} />
              )}
              {(m.attachment_kind === "file" || m.attachment_kind === "voice") && (
                <MediaFile message={m} mine={mine} onDownload={() => doDownload(m)} />
              )}
              {m.text && <p className="whitespace-pre-wrap break-words text-sm leading-6">{m.text}</p>}
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

        {!isEditing && (
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
                  onClick={() => doCopy(m)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-4 w-4" /> کپی متن
                </button>
                <button
                  onClick={() => startReply(m)}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Reply className="h-4 w-4" /> پاسخ
                </button>
                <button
                  onClick={() => startForward(m)}
                  className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                >
                  <Forward className="h-4 w-4" /> فوروارد
                </button>
                {mine && (
                  <>
                    <button
                      onClick={() => startEdit(m)}
                      className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil className="h-4 w-4" /> ویرایش
                    </button>
                    <button
                      onClick={() => doDelete(m)}
                      className="flex w-full items-center gap-2 border-t border-slate-100 px-3 py-2 text-right text-sm text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" /> حذف
                    </button>
                  </>
                )}
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
      <div
        onClick={isGroup ? () => setMembersOpen(true) : undefined}
        title={isGroup ? "دیدن اعضای گروه" : undefined}
        className={`flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 py-2.5 ${
          isGroup ? "cursor-pointer hover:bg-slate-50" : ""
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setActive(null);
          }}
          className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 hover:bg-slate-100 md:hidden"
          title="بازگشت"
        >
          <ArrowRight className="h-5 w-5" />
        </button>

        <div className="relative shrink-0">
          <div
            className={`grid h-10 w-10 place-items-center rounded-full font-bold ${
              isGroup ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-600"
            }`}
          >
            {isGroup ? <Users className="h-5 w-5" /> : initial(other.username)}
          </div>
          {!isGroup && (
            <span
              className={`absolute bottom-0 left-0 h-3 w-3 rounded-full border-2 border-white ${
                other.online ? "bg-emerald-500" : "bg-slate-300"
              }`}
            />
          )}
        </div>

        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-bold text-slate-800">
            {isGroup ? groupName : (other.username ?? "کاربر")}
          </div>
          <div className="h-4 truncate text-xs text-slate-500">
            {typingNames.length > 0 ? (
              <span className="font-medium text-emerald-600">
                {isGroup ? `${typingNames.join("، ")} در حال نوشتن…` : "در حال نوشتن…"}
              </span>
            ) : isGroup ? (
              `${memberCount ?? "…"} عضو`
            ) : other.online ? (
              "متصل"
            ) : (
              lastSeenText(other.last_seen)
            )}
          </div>
        </div>

        {!isGroup && (
          <div className="flex shrink-0 items-center gap-1">
            <button
              onClick={() => startCall(conv, "audio")}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
              title="تماس صوتی"
            >
              <Phone className="h-5 w-5" />
            </button>
            <button
              onClick={() => startCall(conv, "video")}
              className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 hover:bg-emerald-50 hover:text-emerald-600"
              title="تماس تصویری"
            >
              <Video className="h-5 w-5" />
            </button>
          </div>
        )}

        {isGroup && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setMembersOpen(true);
            }}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            title="اعضا"
          >
            <Users className="h-5 w-5" />
          </button>
        )}
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

        {replyTo && (
          <div className="mx-auto mb-2 flex max-w-3xl items-start gap-2 rounded-xl border-r-2 border-emerald-500 bg-emerald-50 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-emerald-700">
                پاسخ به {replyTo.sender?.username ?? "کاربر"}
              </div>
              <div className="truncate text-xs text-slate-500">{replyTo.text}</div>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="grid h-6 w-6 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-200"
              title="لغو پاسخ"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {pending && (
          <div className="mx-auto mb-2 flex max-w-3xl items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            {pending.kind === "image" && pending.url ? (
              <img src={pending.url} alt="" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-slate-200">
                <FileIcon className="h-6 w-6 text-slate-500" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-slate-700">{pending.file.name}</div>
              <div className="text-[11px] text-slate-400">{fmtSize(pending.file.size)}</div>
            </div>
            <button
              onClick={removePending}
              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-slate-200"
              title="حذف پیوست"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {recording ? (
          <div className="mx-auto flex max-w-3xl items-center gap-2">
            <button
              onClick={cancelVoiceRecording}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-red-500 transition-colors hover:bg-red-50"
              title="دور انداختن ضبط"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <div className="flex min-h-[44px] flex-1 items-center gap-3 rounded-2xl bg-red-50 px-4 py-2">
              <span className="relative flex h-3 w-3 shrink-0">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500" />
              </span>
              <span className="shrink-0 text-sm font-bold tabular-nums text-red-700">
                {fmtRecTime(recSecs)}
              </span>
              <div className="flex h-5 flex-1 items-center gap-1 overflow-hidden" aria-hidden="true">
                {Array.from({ length: 28 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-1 shrink-0 rounded-full bg-red-300"
                    style={{ height: `${4 + ((i * 5 + Math.floor(recSecs * 4)) % 15)}px` }}
                  />
                ))}
              </div>
              <span className="shrink-0 text-[11px] text-red-400">حداکثر {MAX_VOICE_SEC / 60} دقیقه</span>
            </div>
            <button
              onClick={stopVoiceRecording}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700"
              title="ارسال ویس"
            >
              <SendHorizonal className="h-5 w-5 -scale-x-100" />
            </button>
          </div>
        ) : (
          <div className="mx-auto flex max-w-3xl items-end gap-1.5">
            <input ref={imageInputRef} type="file" accept="image/*" hidden onChange={pickImage} />
            <input ref={fileInputRef} type="file" hidden onChange={pickFile} />

            <button
              onClick={() => imageInputRef.current?.click()}
              disabled={!!pending || sending}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
              title="ارسال تصویر (فشرده می‌شود)"
            >
              <ImageIcon className="h-5 w-5" />
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={!!pending || sending}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
              title="ارسال فایل (بدون تغییر)"
            >
              <Paperclip className="h-5 w-5" />
            </button>
            <button
              onClick={startVoiceRecording}
              disabled={!!pending || sending}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 disabled:opacity-40"
              title="ضبط پیام صوتی"
            >
              <Mic className="h-5 w-5" />
            </button>

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
              disabled={(!text.trim() && !pending) || sending}
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-emerald-600 text-white transition-colors hover:bg-emerald-700 disabled:opacity-40"
              title="ارسال"
            >
              {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <SendHorizonal className="h-5 w-5 -scale-x-100" />}
            </button>
          </div>
        )}
      </div>

      {forwarding && <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} />}
      {membersOpen && <GroupMembersDialog onClose={() => setMembersOpen(false)} />}

      {lightbox && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain"
            onClick={(e) => e.stopPropagation()}
          />
          <button
            onClick={() => setLightbox(null)}
            className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
            title="بستن"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
    </div>
  );
}