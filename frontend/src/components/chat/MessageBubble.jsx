import { useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { timeShort } from "../../utils/time";

export default function MessageBubble({ message, isMine, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(message.text);
  const [saving, setSaving] = useState(false);

  function submitEdit() {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    Promise.resolve(onEdit(message.id, clean)).finally(() => {
      setSaving(false);
      setEditing(false);
    });
  }

  // حالت ویرایش (داخل حباب)
  if (editing) {
    return (
      <div className="ms-auto w-[75%] rounded-2xl bg-emerald-600 p-2 shadow-sm">
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submitEdit();
            }
            if (e.key === "Escape") {
              setEditing(false);
            }
          }}
          rows={2}
          className="w-full resize-none rounded-lg bg-white p-2 text-sm text-slate-800 outline-none"
        />
        <div className="mt-1.5 flex justify-end gap-1.5">
          <button
            onClick={() => setEditing(false)}
            className="flex items-center gap-1 rounded-lg bg-white/15 px-2 py-1 text-xs text-white hover:bg-white/25"
          >
            <X className="h-3 w-3" /> لغو
          </button>
          <button
            onClick={submitEdit}
            disabled={saving || !text.trim()}
            className="flex items-center gap-1 rounded-lg bg-white px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
          >
            <Check className="h-3 w-3" /> ذخیره
          </button>
        </div>
      </div>
    );
  }

  // حباب معمولی — در RTL پیام‌های من سمت چپ (ms-auto) و طرف مقابل سمت راست
  return (
    <div
      className={`group max-w-[75%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
        isMine ? "ms-auto bg-emerald-600 text-white" : "me-auto bg-white text-slate-800"
      }`}
    >
      <div className="whitespace-pre-wrap break-words">{message.text}</div>
      <div
        className={`mt-1 flex items-center gap-1.5 text-[10px] ${
          isMine ? "text-emerald-100" : "text-slate-400"
        }`}
      >
        {isMine && (
          <span className="flex gap-0.5 opacity-0 transition group-hover:opacity-100">
            <button
              onClick={() => {
                setText(message.text);
                setEditing(true);
              }}
              title="ویرایش"
              className="rounded p-0.5 hover:bg-black/10"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={() => onDelete(message.id)}
              title="حذف"
              className="rounded p-0.5 hover:bg-black/10"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </span>
        )}
        {message.edited_at && <span>ویرایش‌شده</span>}
        <span className="ms-auto">{timeShort(message.created_at)}</span>
      </div>
    </div>
  );
}