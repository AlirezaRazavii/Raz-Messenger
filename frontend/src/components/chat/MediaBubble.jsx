import { useState } from "react";
import api from "../api/client";

// دانلود دل‌خواه (مثل تلگرام): پیام فقط متادیتا دارد؛ فایل فقط با کلیک کاربر دانلود می‌شود.
// کش در سطح ماژول: با جابه‌جایی بین گفتگوها دوباره دانلود نمی‌شود (تا رفرش صفحه).
const urlCache = new Map();

// اگر هنگام دانلود 404 گرفتی، این مسیر را با مسیرِ apiForwardMessage در api/chat.js هم‌راستا کن
const attachmentPath = (id) => `/messages/${id}/attachment/`;

function formatBytes(n) {
  if (!n) return "";
  if (n < 1024) return `${n} بایت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} کیلوبایت`;
  return `${(n / (1024 * 1024)).toFixed(1)} مگابایت`;
}

const IconDownload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconFile = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
  </svg>
);

const IconImage = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <polyline points="21 15 16 10 5 21" />
  </svg>
);

const IconPlay = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="6 3 20 12 6 21 6 3" />
  </svg>
);

export default function MediaBubble({ message }) {
  const kind = message?.attachment_kind;
  const name = message?.attachment_name || "فایل";
  const size = message?.attachment_size || 0;

  const [objectUrl, setObjectUrl] = useState(() => urlCache.get(message?.id) || null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  if (!kind) return null;

  // ذخیره در دیسک (فایل/ویس) بدون دانلود مجدد، از همان کش
  const triggerSave = () => {
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const handleDownload = async () => {
    if (downloading) return;
    setError(null);
    if (objectUrl) {
      if (kind !== "image") triggerSave();
      return;
    }
    setDownloading(true);
    setProgress(0);
    try {
      const res = await api.get(attachmentPath(message.id), {
        responseType: "blob",
        onDownloadProgress: (e) => {
          if (e.total) setProgress(Math.round((e.loaded / e.total) * 100));
        },
      });
      // بعضی کلاینت‌ها response و بعضی data را برمی‌گردانند — هر دو حالت پوشش داده شده
      const blob = res instanceof Blob ? res : res?.data;
      if (!(blob instanceof Blob)) throw new Error("bad response");
      const url = URL.createObjectURL(blob);
      urlCache.set(message.id, url);
      setObjectUrl(url);
      if (kind !== "image") triggerSave();
    } catch {
      setError("دانلود ناموفق بود");
    } finally {
      setDownloading(false);
    }
  };

  const boxStyle = {
    background: "rgba(127,127,127,0.15)",
    border: "1px solid rgba(127,127,127,0.25)",
  };
  const btnStyle = {
    background: "rgba(127,127,127,0.25)",
  };

  if (kind === "image") {
    return (
      <div className="my-1">
        {objectUrl ? (
          <img
            src={objectUrl}
            alt={name}
            onClick={() => window.open(objectUrl, "_blank")}
            className="max-w-[240px] max-h-[240px] rounded-xl object-cover cursor-pointer"
            style={{ border: "1px solid rgba(127,127,127,0.25)" }}
          />
        ) : (
          <div
            className="w-[220px] h-[150px] rounded-xl flex flex-col items-center justify-center gap-2 select-none"
            style={boxStyle}
          >
            <IconImage />
            {downloading ? (
              <div className="w-[140px]">
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.3)" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
                <div className="text-center text-[11px] mt-1 opacity-70">{progress}%</div>
              </div>
            ) : (
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full active:scale-95 transition"
                style={btnStyle}
              >
                <IconDownload />
                دانلود{size ? ` (${formatBytes(size)})` : ""}
              </button>
            )}
            {error && <div className="text-[11px] text-red-400">{error}</div>}
          </div>
        )}
      </div>
    );
  }

  if (kind === "file") {
    return (
      <div className="my-1 flex items-center gap-2.5 rounded-xl px-3 py-2.5 max-w-[280px]" style={boxStyle}>
        <div className="shrink-0 opacity-80"><IconFile /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] truncate" dir="auto" title={name}>{name}</div>
          <div className="text-[11px] opacity-60">{formatBytes(size)}</div>
          {downloading && (
            <div className="mt-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(127,127,127,0.3)" }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
          {error && <div className="text-[11px] text-red-400 mt-0.5">{error}</div>}
        </div>
        <button
          onClick={handleDownload}
          disabled={downloading}
          title="دانلود"
          className="shrink-0 p-2 rounded-full active:scale-95 transition disabled:opacity-50"
          style={btnStyle}
        >
          {downloading ? <span className="text-[10px]">{progress}%</span> : <IconDownload />}
        </button>
      </div>
    );
  }

  if (kind === "voice") {
    return (
      <div className="my-1">
        {objectUrl ? (
          <audio controls src={objectUrl} preload="none" className="max-w-[260px] h-9" />
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              disabled={downloading}
              className="flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full active:scale-95 transition disabled:opacity-50"
              style={btnStyle}
            >
              <IconPlay />
              {downloading ? `${progress}%` : "پخش"}
              {message.voice_duration ? ` (${message.voice_duration}s)` : ""}
            </button>
            {error && <span className="text-[11px] text-red-400">{error}</span>}
          </div>
        )}
      </div>
    );
  }

  return null;
}