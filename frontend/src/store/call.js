import { create } from "zustand";
import useChatStore from "./chat";

// ─────────────────────────────────────────────────────────────
// فاز ۵ — تماس صوتی/تصویری (WebRTC)
// سیگنالینگ offer/answer/ice روی همان WebSocket چت رد می‌شود
// (type: "call.signal")؛ خودِ صدا و تصویر P2P بین دو مرورگر
// مبادله می‌شود و از سرور عبور نمی‌کند.
// useChatStore فقط داخل بدنه‌ی توابع استفاده می‌شود، پس واردسازی
// دوطرفه‌ی chat.js و call.js بی‌خطر است (الگوی رایج zustand).
// ─────────────────────────────────────────────────────────────

const RING_TIMEOUT = 45000; // قطع خودکار تماسِ بی‌پاسخ

// آبجکت‌های غیررندری — بیرون از state نگه داشته می‌شوند
let pc = null; // RTCPeerConnection
let pendingOffer = null; // SDP پیشنهاد تا لحظه‌ی پذیرش
let pendingCandidates = []; // ICEهای رسیده قبل از setRemoteDescription
let remoteDescSet = false;
let answerSeen = false; // جلوگیری از اعمال دوباره‌ی answer (اکوی دِو / دو سوکت)
let ringTimer = null; // تایمر بی‌پاسخی
let resetTimer = null; // بازگشت ended → idle
let audioCtx = null;
let ringLoop = null;
let ringNotif = null; // نوتیفیکیشن مرورگر برای زنگِ وقتی تب پنهان است

// نوتیفیکیشن مرورگر وقتی تب پنهان است — با tag تکراری، جایگزینِ قبلی می‌شود
function showCallNotification(username, isVideo) {
  try {
    ringNotif?.close?.();
    ringNotif = new Notification("تماس ورودی — راز", {
      body: `${username || "کاربر"} · تماس ${isVideo ? "تصویری" : "صوتی"}`,
      tag: "raz-incoming-call",
    });
    ringNotif.onclick = () => {
      window.focus();
      ringNotif?.close?.();
      ringNotif = null;
    };
  } catch {
    ringNotif = null;
  }
}

function constraintsFor(callType) {
  return callType === "video"
    ? { audio: true, video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" } }
    : { audio: true };
}

// ---------- زنگ (Web Audio — بدون هیچ فایل صوتی) ----------
function ringBeep(t0, dur, gainValue) {
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = "sine";
  osc.frequency.value = 640;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const t = audioCtx.currentTime + t0;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(gainValue, t + 0.04);
  gain.gain.setValueAtTime(gainValue, t + dur - 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function startRingtone(soft) {
  stopRingtone();
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
    const g = soft ? 0.05 : 0.12; // برای تماس‌گیرنده آرام‌تر
    const pattern = () => {
      // مرورگر تا اولین کلیک کاربر صدا را قفل می‌کند؛ در هر تیک دوباره تلاش می‌شود
      if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
      ringBeep(0, 0.4, g);
      ringBeep(0.55, 0.4, g);
    };
    pattern();
    ringLoop = setInterval(pattern, 2500);
  } catch {}
}

function stopRingtone() {
  if (ringLoop) {
    clearInterval(ringLoop);
    ringLoop = null;
  }
  try { navigator.vibrate?.(0); } catch {} // توقف ویبره‌ی موبایل
  try { ringNotif?.close?.(); ringNotif = null; } catch {} // بستن نوتیف
}

function startRingTimer(onTimeout, ms = RING_TIMEOUT) {
  clearRingTimer();
  ringTimer = setTimeout(onTimeout, ms);
}

function clearRingTimer() {
  if (ringTimer) {
    clearTimeout(ringTimer);
    ringTimer = null;
  }
}

function scheduleIdleReset() {
  if (resetTimer) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    resetTimer = null;
    if (useCallStore.getState().status === "ended") {
      useCallStore.setState({ status: "idle", endedReason: "" });
    }
  }, 3000);
}

// ساخت (یا بازگرداندن) اتصال WebRTC + وصل‌کردن رویدادها
function ensurePeer() {
  if (pc) return pc;
  pendingCandidates = [];
  remoteDescSet = false;
  pc = new RTCPeerConnection({ iceServers: [] }); // روی LAN کاندیدهای host کافی‌اند؛ STUN/TURN در فاز ۷

  pc.onicecandidate = (e) => {
    if (e.candidate) useCallStore.getState()._send({ kind: "ice", candidate: e.candidate });
  };

  pc.ontrack = (e) => {
    const stream = e.streams?.[0] || new MediaStream([e.track]);
    if (useCallStore.getState().remoteStream?.id !== stream.id) {
      useCallStore.setState({ remoteStream: stream });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    const st = pc.connectionState;
    if (st === "connected") {
      useCallStore.setState({ status: "active", startedAt: Date.now() });
    } else if (st === "failed") {
      const s = useCallStore.getState();
      s._send({ kind: "hangup" });
      s._finish("اتصال برقرار نشد.");
    } else if (st === "disconnected") {
      // چند ثانیه صبر؛ شاید شبکه برگردد
      setTimeout(() => {
        if (pc && pc.connectionState === "disconnected") {
          const s2 = useCallStore.getState();
          s2._send({ kind: "hangup" });
          s2._finish("اتصال شبکه قطع شد.");
        }
      }, 4000);
    }
  };

  return pc;
}

// ICEهای صف‌شده را بعد از setRemoteDescription به اتصال می‌دهیم
async function flushCandidates() {
  if (!pc || !remoteDescSet) return;
  const list = pendingCandidates;
  pendingCandidates = [];
  for (const c of list) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(c));
    } catch {}
  }
}

function closePeer() {
  pendingOffer = null;
  pendingCandidates = [];
  remoteDescSet = false;
  answerSeen = false;
  if (pc) {
    try {
      pc.onicecandidate = null;
      pc.ontrack = null;
      pc.onconnectionstatechange = null;
    } catch {}
    try { pc.close(); } catch {}
    pc = null;
  }
}

// صبر برای جمع‌شدن کامل کاندیدهای ICE — تا همه‌شان داخل خودِ SDP بروند.
// این کار offer را «خودکفا» می‌کند: اگر سوکت گیرنده دیر وصل شود و offer
// از روی سرور دوباره پخش شود، هیچ کاندیدی گم نمی‌شود.
function waitIceGathering(p, maxMs = 2000) {
  return new Promise((resolve) => {
    if (p.iceGatheringState === "complete") return resolve();
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      p.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (p.iceGatheringState === "complete") finish();
    };
    const timer = setTimeout(finish, maxMs);
    p.addEventListener("icegatheringstatechange", onChange);
  });
}

const useCallStore = create((set, get) => ({
  status: "idle", // idle | calling | incoming | connecting | active | ended
  callType: "audio", // audio | video
  convId: null,
  peer: null, // { id, username }
  localStream: null,
  remoteStream: null,
  micOff: false,
  camOff: false,
  remoteMuted: false, // بی‌صدایی صدای طرف مقابل (فقط سمت خودِ ما)
  startedAt: 0,
  endedReason: "",

  // ---------- تماس خروجی ----------
  startCall: async (conv, callType = "audio") => {
    let st = get();
    // نمایشِ «پایان»ی که ۳ ثانیه مانده، شروعِ تازه را نبندد
    if (st.status === "ended") {
      if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
      set({ status: "idle", endedReason: "" });
      st = get();
    }
    if (st.status !== "idle") return;

    const peer = conv?.other_user;
    if (!peer?.id || !conv?.id) return;

    if (!navigator.mediaDevices?.getUserMedia) {
      set({
        status: "ended",
        endedReason: window.isSecureContext
          ? "این مرورگر از تماس پشتیبانی نمی‌کند."
          : "میکروفون و دوربین فقط روی localhost یا https کار می‌کنند.",
      });
      scheduleIdleReset();
      return;
    }

    set({
      status: "calling",
      callType,
      convId: conv.id,
      peer: { id: peer.id, username: peer.username },
      micOff: false,
      camOff: false,
      endedReason: "",
    });

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraintsFor(callType));
    } catch {
      get()._finish("دسترسی به میکروفون یا دوربین رد شد.");
      return;
    }
    if (get().status !== "calling") { // در این فاصله تماس لغو شده
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const p = ensurePeer();
    stream.getTracks().forEach((t) => p.addTrack(t, stream));
    set({ localStream: stream });

    try {
      const offer = await p.createOffer();
      await p.setLocalDescription(offer);
      await waitIceGathering(p); // همه‌ی کاندیدها داخل خود SDP جمع شوند (offer خودکفا می‌شود)
      if (get().status !== "calling") return; // در این فاصله تماس لغو شده است
      const sent = get()._send({ kind: "offer", call_type: callType, sdp: p.localDescription });
      if (!sent) {
        // سوکت لحظه‌ای قطع است — همین‌جا بفهمیم بهتر از ۴۵ ثانیه بوق بی‌فایده است
        get()._finish("اتصال به سرور برقرار نیست؛ دوباره تلاش کنید.");
        return;
      }
      startRingtone(true); // بوقِ آزاد برای تماس‌گیرنده
      startRingTimer(() => {
        // محافظ: اگر جواب آمده و تماس جریان دارد، این تایمر دیگر معتبر نیست
        if (get().status !== "calling") return;
        // stage=ringing یعنی «بی‌پاسخ» — سرور گزارش تماس را همین ثبت می‌کند
        get()._send({ kind: "hangup", stage: "ringing" });
        get()._finish("پاسخی داده نشد.");
      });
    } catch {
      get()._send({ kind: "hangup" });
      get()._finish("خطا در راه‌اندازی تماس.");
    }
  },

  // ---------- سیگنال ورودی از طرف مقابل ----------
  handleSignal: (ev) => {
    const signal = ev?.signal;
    if (!signal || typeof signal !== "object") return;
    const convId = ev.conversation_id;
    const kind = signal.kind;

    if (kind === "offer") {
      // پخشِ مجددِ زنگی که تاریخش گذشته (تماس تمام شده) → نادیده
      if (signal.expires_at && Date.now() > signal.expires_at) return;
      let st = get();
      if (st.status === "ended") {
        if (resetTimer) { clearTimeout(resetTimer); resetTimer = null; }
        set({ status: "idle", endedReason: "" });
        st = get();
      }
      if (st.status !== "idle") {
        // تکرارِ همان تماس ورودی (اکوی سوکت در dev) → نادیده؛ غیر آن → مشغول
        if (st.status === "incoming" && st.convId === convId && st.peer?.id === ev.user_id) return;
        get()._send({ kind: "busy" }, convId); // busy به همان گفتگوی تماس‌دهنده برود، نه گفتگوی فعالِ ما
        return;
      }

      // نام طرف مقابل — اول از خودِ سیگنال (حتی وقتی لیست گفتگوها هنوز لود نشده)
      const conv = useChatStore.getState().conversations.find((c) => c.id === convId);
      pendingOffer = signal.sdp;
      set({
        status: "incoming",
        callType: signal.call_type === "video" ? "video" : "audio",
        convId,
        peer: { id: ev.user_id, username: signal.caller_username || conv?.other_user?.username || "کاربر" },
        micOff: false,
        camOff: false,
        endedReason: "",
      });
      startRingtone(false);
      // موبایل: ویبره / تب پنهان: نوتیفیکیشن مرورگر
      try { navigator.vibrate?.([500, 300, 500, 300, 500]); } catch {}
      if (document.hidden && "Notification" in window) {
        try {
          const show = () => showCallNotification(get().peer?.username, signal.call_type === "video");
          if (Notification.permission === "granted") show();
          else if (Notification.permission === "default") {
            Notification.requestPermission().then((p) => { if (p === "granted") show(); }).catch(() => {});
          }
        } catch {}
      }
      startRingTimer(() => {
        // محافظ: اگر در این فاصله وضعیت عوض شده (جواب داده‌ایم)، تایمر بی‌اعتبار است
        if (get().status !== "incoming") return;
        // stage=ringing یعنی «تایمرِ بی‌پاسخ» — سرور اگر جای دیگر جواب/رد شده باشد این را دور می‌ریزد
        get()._send({ kind: "hangup", stage: "ringing" });
        get()._finish("");
      });
      return;
    }

    if (kind === "answer") {
      const st = get();
      if ((st.status !== "calling" && st.status !== "connecting") || st.convId !== convId) return;
      if (remoteDescSet || answerSeen) return; // پاسخ تکراری (اکو) — قبلاً اعمال/در حال اعمال
      answerSeen = true; // همین‌جا قفل می‌شود تا نسخه‌ی تکراری رد شود
      stopRingtone();
      clearRingTimer(); // جواب آمد — تایمر بی‌پاسخی باید همین‌جا خاموش شود (باگ قطع ۴۵ ثانیه‌ای)
      set({ status: "connecting" });
      const p = ensurePeer();
      (async () => {
        try {
          await p.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          remoteDescSet = true;
          await flushCandidates();
        } catch {
          get()._send({ kind: "hangup" });
          get()._finish("خطا در برقراری تماس.");
        }
      })();
      return;
    }

    if (kind === "ice") {
      if (!pc || !remoteDescSet) { pendingCandidates.push(signal.candidate); return; }
      pc.addIceCandidate(new RTCIceCandidate(signal.candidate)).catch(() => {});
      return;
    }

    if (kind === "hangup") {
      const st = get();
      if (st.status === "idle" || st.status === "ended") return;
      get()._finish(
        st.status === "calling" ? "پاسخی داده نشد."
        : st.status === "incoming"
        ? signal.stage === "ringing" ? "تماس بی‌پاسخ ماند." : "تماس توسط تماس‌گیرنده لغو شد."
        : "تماس توسط طرف مقابل قطع شد."
      );
      return;
    }

    if (kind === "reject") {
      if (get().status !== "calling") return;
      get()._finish("تماس رد شد.");
      return;
    }

    if (kind === "busy") {
      if (get().status !== "calling") return;
      get()._finish("کاربر در تماس دیگری است.");
      return;
    }

    if (kind === "answered" || kind === "rejected") {
      // یکی از تب‌ها/دستگاه‌های دیگرِ همین کاربر تماس را جواب یا رد کرده —
      // زنگ همین‌جا هم باید خاموش شود، وگرنه تایمرش بعداً hangup می‌فرستد
      // و تماسِ فعال را می‌کشد
      const st = get();
      if (st.status === "incoming" && st.convId === convId) get()._finish("");
      return;
    }
  },

  // ---------- پذیرش / رد / قطع ----------
  accept: async () => {
    const st = get();
    if (st.status !== "incoming" || !pendingOffer) return;
    stopRingtone();
    clearRingTimer();
    set({ status: "connecting" });
    get()._send({ kind: "answered" }); // بقیه‌ی تب‌ها/دستگاه‌های خودم زنگ را قطع کنند

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraintsFor(st.callType));
    } catch {
      get()._send({ kind: "reject" });
      get()._finish("دسترسی به میکروفون یا دوربین رد شد.");
      return;
    }
    if (get().status !== "connecting") { // در این فاصله تماس تمام شده
      stream.getTracks().forEach((t) => t.stop());
      return;
    }

    const p = ensurePeer();
    stream.getTracks().forEach((t) => p.addTrack(t, stream));
    set({ localStream: stream });

    try {
      await p.setRemoteDescription(new RTCSessionDescription(pendingOffer));
      remoteDescSet = true;
      await flushCandidates();
      const answer = await p.createAnswer();
      await p.setLocalDescription(answer);
      await waitIceGathering(p); // پاسخ هم مثل offer خودکفا شود
      if (get().status !== "connecting") return; // در این فاصله تماس تمام شده است
      get()._send({ kind: "answer", sdp: p.localDescription });
      // «active» به‌محض connected شدنِ اتصال خودکار می‌آید
    } catch {
      get()._send({ kind: "hangup" });
      get()._finish("خطا در برقراری تماس.");
    }
  },

  reject: () => {
    if (get().status !== "incoming") return;
    get()._send({ kind: "reject" });
    get()._send({ kind: "rejected" }); // بقیه‌ی تب‌ها/دستگاه‌های خودم زنگ را قطع کنند
    get()._finish("");
  },

  hangup: () => {
    const st = get();
    if (st.status === "incoming") { get().reject(); return; }
    if (st.status === "idle" || st.status === "ended") return;
    get()._send({ kind: "hangup" });
    get()._finish("تماس قطع شد.");
  },

  // ---------- کنترل‌ها ----------
  toggleMic: () => {
    const st = get();
    const track = st.localStream?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = st.micOff; // خاموش بود → روشن شود و برعکس
    set({ micOff: !st.micOff });
  },

  toggleCam: () => {
    const st = get();
    if (st.callType !== "video") return;
    const track = st.localStream?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = st.camOff;
    set({ camOff: !st.camOff });
  },

  toggleRemoteAudio: () => {
    // فقط عنصر پخشِ سمت خودمان بی‌صدا می‌شود؛ به طرف مقابل چیزی نمی‌رسد
    set((s) => ({ remoteMuted: !s.remoteMuted }));
  },

  // ---------- داخلی ----------
  _send: (signal, targetConvId) => {
    const convId = targetConvId || get().convId;
    if (!convId) return false;
    return useChatStore.getState().sendCommand({
      type: "call.signal",
      conversation_id: convId,
      signal,
    });
  },

  _finish: (reason) => {
    clearRingTimer();
    stopRingtone();
    const st = get();
    st.localStream?.getTracks().forEach((t) => t.stop());
    closePeer();
    if (st.status === "idle") return;
    if (reason) {
      set({
        status: "ended",
        endedReason: reason,
        localStream: null,
        remoteStream: null,
        micOff: false,
        camOff: false,
        remoteMuted: false,
        startedAt: 0,
      });
      scheduleIdleReset();
    } else {
      set({
        status: "idle",
        endedReason: "",
        localStream: null,
        remoteStream: null,
        micOff: false,
        camOff: false,
        remoteMuted: false,
        startedAt: 0,
        peer: null,
        convId: null,
      });
    }
  },
}));

export default useCallStore;