import { useEffect, useRef, useState } from "react";
import {
  Loader2, Maximize, Mic, MicOff, Minimize, Phone, PhoneOff, Video, VideoOff, Volume2, VolumeX,
} from "lucide-react";
import useCallStore from "../../store/call";

function fmtDur(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function Avatar({ name, pulse = false }) {
  const initial = (name || "؟").trim().charAt(0).toUpperCase();
  return (
    <div className="relative">
      <div className="grid h-24 w-24 place-items-center rounded-full bg-emerald-100 text-4xl font-bold text-emerald-700">
        {initial}
      </div>
      {pulse && <span className="absolute inset-0 animate-ping rounded-full border-4 border-emerald-400/60" />}
    </div>
  );
}

// شمارنده‌ی مدت تماس — هر ثانیه رندر می‌شود
function Duration({ startedAt }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return undefined;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [startedAt]);
  if (!startedAt) return null;
  return <span>{fmtDur(Date.now() - startedAt)}</span>;
}

export default function CallModal() {
  const status = useCallStore((s) => s.status);
  const callType = useCallStore((s) => s.callType);
  const peer = useCallStore((s) => s.peer);
  const localStream = useCallStore((s) => s.localStream);
  const remoteStream = useCallStore((s) => s.remoteStream);
  const micOff = useCallStore((s) => s.micOff);
  const camOff = useCallStore((s) => s.camOff);
  const remoteMuted = useCallStore((s) => s.remoteMuted);
  const endedReason = useCallStore((s) => s.endedReason);
  const startedAt = useCallStore((s) => s.startedAt);

  const accept = useCallStore((s) => s.accept);
  const reject = useCallStore((s) => s.reject);
  const hangup = useCallStore((s) => s.hangup);
  const toggleMic = useCallStore((s) => s.toggleMic);
  const toggleCam = useCallStore((s) => s.toggleCam);
  const toggleRemoteAudio = useCallStore((s) => s.toggleRemoteAudio);

  const remoteRef = useRef(null);
  const localRef = useRef(null);
  const rootRef = useRef(null); // برای تمام‌صفحه‌ی تماس تصویری
  const [isFs, setIsFs] = useState(false);

  useEffect(() => {
    const onFsChange = () => setIsFs(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) document.exitFullscreen();
      else rootRef.current?.requestFullscreen?.();
    } catch {}
  };

  const isVideo = callType === "video";

  // صدای/تصویر طرف مقابل را به عنصر پخش وصل می‌کنیم
  useEffect(() => {
    const el = remoteRef.current;
    if (el && remoteStream) {
      el.srcObject = remoteStream;
      el.play?.().catch(() => {});
    }
  }, [remoteStream, isVideo, status]);

  // پیش‌نمایش خودمان (بی‌صدا تا اکو نشود)
  useEffect(() => {
    const el = localRef.current;
    if (el && localStream) {
      el.srcObject = localStream;
      el.play?.().catch(() => {});
    }
  }, [localStream, status]);

  if (status === "idle") return null;

  // ---------- زنگ ورودی ----------
  if (status === "incoming") {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/80 p-4 backdrop-blur-sm">
        <div className="mx-4 flex w-full max-w-sm flex-col items-center gap-6 rounded-3xl bg-white p-8 shadow-2xl">
          <Avatar name={peer?.username} pulse />
          <div className="text-center">
            <div className="text-lg font-bold text-slate-800">{peer?.username ?? "کاربر"}</div>
            <div className="text-sm text-slate-500">تماس {isVideo ? "تصویری" : "صوتی"} ورودی…</div>
          </div>
          <div className="flex items-center gap-10">
            <button
              onClick={reject}
              title="رد تماس"
              className="grid h-16 w-16 place-items-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-600"
            >
              <PhoneOff className="h-7 w-7" />
            </button>
            <button
              onClick={accept}
              title="پاسخ تماس"
              className="relative grid h-16 w-16 place-items-center rounded-full bg-emerald-500 text-white shadow-lg transition hover:bg-emerald-600"
            >
              <span className="absolute inset-0 animate-ping rounded-full bg-emerald-400/50" />
              <Phone className="h-7 w-7" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  const statusLine =
    status === "calling" ? "در حال تماس…"
    : status === "connecting" ? "در حال برقراری اتصال…"
    : status === "active" ? <Duration startedAt={startedAt} />
    : endedReason || "تماس پایان یافت";

  const controlButtons = (
    <div className="flex items-center justify-center gap-4">
      {localStream && (
        <button
          onClick={toggleMic}
          title={micOff ? "روشن کردن میکروفون" : "قطع میکروفون"}
          className={`grid h-14 w-14 place-items-center rounded-full shadow-lg transition ${
            micOff ? "bg-white text-slate-800" : "bg-white/20 text-white hover:bg-white/30"
          }`}
        >
          {micOff ? <MicOff className="h-6 w-6" /> : <Mic className="h-6 w-6" />}
        </button>
      )}
      {localStream && isVideo && (
        <button
          onClick={toggleCam}
          title={camOff ? "روشن کردن دوربین" : "قطع دوربین"}
          className={`grid h-14 w-14 place-items-center rounded-full shadow-lg transition ${
            camOff ? "bg-white text-slate-800" : "bg-white/20 text-white hover:bg-white/30"
          }`}
        >
          {camOff ? <VideoOff className="h-6 w-6" /> : <Video className="h-6 w-6" />}
        </button>
      )}
      {remoteStream && (
        <button
          onClick={toggleRemoteAudio}
          title={remoteMuted ? "پخش صدای طرف مقابل" : "بی‌صدا کردن طرف مقابل"}
          className={`grid h-14 w-14 place-items-center rounded-full shadow-lg transition ${
            remoteMuted ? "bg-white text-slate-800" : "bg-white/20 text-white hover:bg-white/30"
          }`}
        >
          {remoteMuted ? <VolumeX className="h-6 w-6" /> : <Volume2 className="h-6 w-6" />}
        </button>
      )}
      {isVideo && status !== "ended" && (
        <button
          onClick={toggleFullscreen}
          title={isFs ? "خروج از تمام‌صفحه" : "تمام‌صفحه"}
          className="grid h-14 w-14 place-items-center rounded-full bg-white/20 text-white shadow-lg transition hover:bg-white/30"
        >
          {isFs ? <Minimize className="h-6 w-6" /> : <Maximize className="h-6 w-6" />}
        </button>
      )}
      {status !== "ended" && (
        <button
          onClick={hangup}
          title="قطع تماس"
          className="grid h-14 w-14 place-items-center rounded-full bg-red-500 text-white shadow-lg transition hover:bg-red-600"
        >
          <PhoneOff className="h-6 w-6" />
        </button>
      )}
    </div>
  );

  // ---------- تماس صوتی ----------
  if (!isVideo) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-gradient-to-b from-slate-800 to-slate-950 p-6">
        <audio ref={remoteRef} autoPlay muted={remoteMuted} className="hidden" />
        {status === "ended" ? (
          <div className="text-center text-sm text-slate-300">{statusLine}</div>
        ) : (
          <>
            <Avatar name={peer?.username} pulse={status === "calling"} />
            <div className="text-center">
              <div className="text-xl font-bold text-white">{peer?.username ?? "کاربر"}</div>
              <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-300">
                {status === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}
                {statusLine}
              </div>
            </div>
            {controlButtons}
          </>
        )}
      </div>
    );
  }

  // ---------- تماس تصویری ----------
  return (
      <audio ref={remoteRef} autoPlay muted={remoteMuted    <div ref={rootRef} className="fixed inset-0 z-[60] bg-black">
      <video ref={remoteRef} autoPlay playsInline muted={remoteMuted} className="h-full w-full object-cover" />} className="hidden" />

      {status === "ended" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-slate-950/90">
          <div className="text-sm text-slate-300">{statusLine}</div>
        </div>
      ) : (
        <>
          {/* تا وقتی تصویر طرف مقابل نرسیده، جای خالی نشان بده */}
          {!remoteStream && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-5 bg-slate-900">
              <Avatar name={peer?.username} pulse={status === "calling"} />
              <div className="text-center">
                <div className="text-xl font-bold text-white">{peer?.username ?? "کاربر"}</div>
                <div className="mt-1 flex items-center justify-center gap-2 text-sm text-slate-300">
                  {status === "connecting" && <Loader2 className="h-4 w-4 animate-spin" />}
                  {statusLine}
                </div>
              </div>
            </div>
          )}

          <video
            ref={localRef}
            autoPlay
            playsInline
            muted
            className="absolute bottom-24 left-4 h-32 w-24 rounded-xl border-2 border-white/20 object-cover shadow-lg sm:h-40 sm:w-28"
          />

          <div className="absolute right-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white">
            {peer?.username ?? "کاربر"}
          </div>
          {status === "active" && (
            <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
              <Duration startedAt={startedAt} />
            </div>
          )}

          <div className="absolute inset-x-0 bottom-6">{controlButtons}</div>
        </>
      )}
    </div>
  );
}