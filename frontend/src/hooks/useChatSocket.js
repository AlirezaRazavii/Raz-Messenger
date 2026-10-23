import { useEffect } from "react";
import * as authModule from "../store/auth";
import useChatStore from "../store/chat";

const useAuthStore =
  authModule.default ??
  authModule.useAuthStore ??
  authModule.useAuth ??
  authModule.authStore;

const WS_URL = "ws://127.0.0.1:8000/ws/";
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

      ws.onclose = () => {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        useChatStore.getState().setConnected(false);
        if (!closedByUs) scheduleReconnect();
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