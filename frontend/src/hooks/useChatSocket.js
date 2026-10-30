import { useEffect } from "react";
import { useAuthStore } from "../store/auth";
import useChatStore from "../store/chat";

// توسعه: بک‌اند روی پورت 8000 همین hostname — پروداکشن: هم‌دامنه (جزئیات در api/origin.js)
import { API_ORIGIN, wsUrl } from "../api/origin";

const WS_URL = wsUrl();
const API_BASE = API_ORIGIN;
const PING_INTERVAL = 30000;
const MAX_BACKOFF = 15000;

function pickToken(obj) {
  if (!obj || typeof obj !== "object") return null;
  return (
    obj.access ?? obj.accessToken ?? obj.access_token ?? obj.token ??
    obj.tokens?.access ?? obj.tokens?.accessToken ?? null
  );
}

function getAccessToken() {
  try {
    const t = pickToken(useAuthStore.getState());
    if (t) return t;
  } catch {}
  try {
    const raw = localStorage.getItem("raz-auth");
    if (raw) return pickToken(JSON.parse(raw)?.state);
  } catch {}
  return null;
}

// وقتی سرور با کد 4001 اتصال را می‌بندد یعنی توکن دسترسی منقضی شده؛
// با refresh، توکن تازه می‌گیریم و دوباره وصل می‌شویم.
async function tryRefresh() {
  const st = useAuthStore.getState() || {};
  const refreshToken = st.refresh ?? null;
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/api/auth/refresh/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh: refreshToken }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const access = data?.access ?? data?.accessToken ?? null;
    if (!access) return null;
    if (typeof st.setTokens === "function") {
      st.setTokens(access, data?.refresh ?? refreshToken);
    }
    return access;
  } catch {
    return null;
  }
}

export default function useChatSocket() {
  useEffect(() => {
    let ws = null;
    let pingTimer = null;
    let reconnectTimer = null;
    let retry = 0;
    let closedByUs = false;

    const scheduleReconnect = () => {
      if (closedByUs) return;
      const delay = Math.min(1000 * Math.pow(2, retry), MAX_BACKOFF);
      retry += 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      // توکن همیشه تازه خوانده می‌شود تا بعد از refresh هم وصل شویم
      const token = getAccessToken();
      if (!token) {
        scheduleReconnect();
        return;
      }
      try {
        ws = new WebSocket(`${WS_URL}?token=${encodeURIComponent(token)}`);
      } catch {
        scheduleReconnect();
        return;
      }

      ws.onopen = () => {
        retry = 0;
        useChatStore.getState().setConnected(true);
        useChatStore.getState().onSocketOpen();
        pingTimer = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: "ping" }));
          }
        }, PING_INTERVAL);
      };

      ws.onmessage = (e) => {
        let data = null;
        try { data = JSON.parse(e.data); } catch { return; }
        if (import.meta.env.DEV) console.debug("[ws←]", data);
        useChatStore.getState().handleSocketEvent(data);
      };

      ws.onclose = (ev) => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        // سوکتِ دورریختهٔ قبلی (ری‌ماونت StrictMode در dev) نباید وضعیتِ سوکتِ زنده را خراب کند؛
        // پاک‌سازی وضعیت در cleanup خود effect انجام می‌شود
        if (closedByUs) return;
        useChatStore.getState().setConnected(false);
        if (ev && ev.code === 4001) {
          // توکن منقضی شده — اول refresh بعد اتصال مجدد
          retry += 1;
          if (retry > 5) {
            scheduleReconnect(); // با فاصله بیشتر ادامه بده — شاید بعداً درست شود
            return;
          }
          reconnectTimer = setTimeout(async () => {
            await tryRefresh();
            connect();
          }, 500);
          return;
        }
        scheduleReconnect();
      };

      ws.onerror = () => {
        // بعد از خطا، onclose اجرا می‌شود؛ کاری لازم نیست
      };
    };

    connect();

    // فرستادن فرمان از هر جای برنامه از طریق store
    useChatStore.getState().setSocketSend((payload) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify(payload));
          if (import.meta.env.DEV) console.debug("[ws→]", payload);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    });

    return () => {
      closedByUs = true;
      if (pingTimer) clearInterval(pingTimer);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      useChatStore.getState().setSocketSend(null);
      useChatStore.getState().setConnected(false);
      if (ws) {
        try { ws.close(); } catch {}
        ws = null;
      }
    };
  }, []);
}