import { create } from "zustand";
import { useAuthStore } from "./auth";
import {
  apiListConversations,
  apiCreateConversation,
  apiListMessages,
  apiSendMessage,
  apiSendMessageWithAttachment,
  apiForwardMessage,
  apiEditMessage,
  apiDeleteMessage,
  apiSearchUsers,
  apiCreateGroup,
  apiGetGroup,
  apiRenameGroup,
  apiDeleteGroup,
  apiAddGroupMember,
  apiRemoveGroupMember,
  extractError,
} from "../api/chat";

const TYPING_TTL = 4000;
const lastSelfTyping = {}; // محافظ اکو: آخرین باری که خودم رویداد typing فرستادم

function myId() {
  const s = useAuthStore.getState() || {};
  const u = s.user || {};
  return s.userId ?? s.user_id ?? u.id ?? u.pk ?? null;
}

function convIdOf(m) {
  if (!m) return null;
  if (typeof m.conversation === "number") return m.conversation;
  if (m.conversation && typeof m.conversation === "object") return m.conversation.id ?? null;
  return m.conversation_id ?? m.conv_id ?? null;
}

function senderIdOf(m) {
  if (!m) return null;
  if (typeof m.sender === "number") return m.sender;
  if (m.sender && typeof m.sender === "object") return m.sender.id ?? null;
  return m.sender_id ?? null;
}

const useChatStore = create((set, get) => ({
  connected: false,
  socketSend: null,

  conversations: [],
  conversationsLoading: false,
  activeId: null,

  // جزئیات گروه گفتگوی فعال (اعضا، نقش‌ها، آنلاین‌بودن) — فاز ۴
  activeGroup: null,

  // { [convId]: { list: [], hasMore: false, loading: false } }
  messages: {},

  // { [convId]: { [userId]: expiresAtMs } }
  typing: {},

  // { [convId]: message_id } — برای خصوصی: آخرین خوانده‌ی طرف مقابل؛ برای گروه: کمینه‌ی خوانده‌ی اعضا
  readUpTo: {},

  // { [convId]: { [userId]: message_id } } — خوانده‌ی زنده‌ی هر عضو گروه (فاز ۴)
  groupReads: {},

  // { [convId]: message_id } — کمینه‌ی خوانده‌ی اعضا در آخرین بارگذاری لیست (فاز ۴)
  groupReadSeed: {},

  // ---------------- اتصال ----------------
  setConnected: (v) => set({ connected: v }),
  setSocketSend: (fn) => set({ socketSend: fn }),

  sendCommand: (payload) => {
    const fn = get().socketSend;
    if (typeof fn === "function") {
      try { fn(payload); return true; } catch { return false; }
    }
    return false;
  },

  onSocketOpen: () => {
    get().loadConversations();
    const { activeId } = get();
    if (activeId) get().loadMessages(activeId, { reset: true });
  },

  // ---------------- رویدادهای ورودی WebSocket ----------------
  handleSocketEvent: (data) => {
    if (!data || typeof data !== "object") return;
    // پشتیبانی از هر دو شکل ممکن پیام سرور (مستقیم یا لفافی chat.event)
    let ev = data;
    if (data.event && typeof data.event === "object") ev = data.event;
    const kind = typeof ev.event === "string" ? ev.event : (ev.type ?? null);

    switch (kind) {
      case "ws.connected": get().setConnected(true); break;
      case "presence": get()._applyPresence(ev.user_id, ev.online); break;
      case "typing": get()._applyTyping(ev.conversation_id, ev.user_id, ev.state); break;
      case "read": get()._applyRead(ev.conversation_id, ev.message_id ?? ev.last_read_message_id, ev.user_id); break;
      case "message.new": get()._applyMessageNew(ev.message); break;
      case "message.edited": get()._applyMessageEdited(ev.message); break;
      case "message.deleted": get()._applyMessageDeleted(ev); break;
      case "conversation.new": get()._applyConversationNew(ev); break;
      case "group.new": get()._applyGroupNew(ev); break;
      case "group.updated": get()._applyGroupUpdated(ev); break;
      case "group.deleted": get()._applyGroupDeleted(ev); break;
      default: break;
    }
  },

  _applyPresence: (userId, online) => {
    if (!userId) return;
    set((s) => ({
      conversations: s.conversations.map((c) => {
        const oid = c.other_user?.id ?? c.other_user?.pk;
        return oid === userId ? { ...c, other_user: { ...c.other_user, online: Boolean(online) } } : c;
      }),
    }));
  },

  _applyTyping: (convId, userId, state) => {
    if (!convId) return;
    const me = myId();
    let uid = userId;
    if (uid == null) {
      // اگر سرور user_id نفرستاد: اگر همین الان خودم typing فرستاده‌ام، اکو است
      if (Date.now() - (lastSelfTyping[convId] ?? 0) < 3500) return;
      const conv = get().conversations.find((c) => c.id === convId);
      uid = conv?.other_user?.id ?? conv?.other_user?.pk ?? -1;
    }
    if (me != null && uid === me) return;
    // سرور "on"/"off" می‌فرستد؛ رشته‌ی "off" در جاوااسکریپت truthy است!
    const isOn = state === true || state === "on" || state === 1;
    set((s) => {
      const inConv = { ...(s.typing[convId] || {}) };
      if (isOn) inConv[uid] = Date.now() + TYPING_TTL;
      else delete inConv[uid];
      return { typing: { ...s.typing, [convId]: inConv } };
    });
  },

  _applyRead: (convId, messageId, userId) => {
    if (!convId || !messageId) return;
    const conv = get().conversations.find((c) => c.id === convId);
    if (conv?.group) {
      // گروه: تیک دوتایی یعنی کمینه‌ی خوانده‌ی اعضا به این پیام رسیده باشد —
      // محافظه‌کارانه: هرگز جلوتر از min(خوانده‌ی زنده، seed سرور) نمی‌رود
      set((s) => {
        const per = { ...(s.groupReads[convId] || {}) };
        if (userId) per[userId] = Math.max(per[userId] ?? 0, messageId);
        const vals = Object.values(per);
        const seed = s.groupReadSeed[convId];
        const live = vals.length ? Math.min(...vals) : messageId;
        const value = typeof seed === "number" ? Math.min(seed, live) : live;
        return {
          groupReads: { ...s.groupReads, [convId]: per },
          readUpTo: { ...s.readUpTo, [convId]: value },
        };
      });
      return;
    }
    set((s) => ({ readUpTo: { ...s.readUpTo, [convId]: messageId } }));
  },

  _applyMessageNew: (m) => {
    const convId = convIdOf(m);
    if (!m || !convId) return;
    const s0 = get();
    if (s0.messages[convId]?.list?.some((x) => x.id === m.id)) return; // جلوگیری از تکرار
    const mine = senderIdOf(m) === myId();
    const isActive = s0.activeId === convId;
    const convExists = s0.conversations.some((c) => c.id === convId);

    set((s) => {
      const messages = { ...s.messages };
      if (isActive) {
        const b = messages[convId] ?? { list: [], hasMore: false, loading: false };
        messages[convId] = { ...b, list: [...b.list, m] };
      }
      const conversations = [...s.conversations];
      const idx = conversations.findIndex((c) => c.id === convId);
      if (idx >= 0) {
        const c = { ...conversations[idx], last_message: m };
        if (!mine && !isActive) c.unread_count = (c.unread_count ?? 0) + 1;
        conversations.splice(idx, 1);
        conversations.unshift(c);
      }
      // با رسیدن پیام، نشانگر تایپینگ فرستنده خاموش شود
      let typing = s.typing;
      if (!mine && s.typing[convId]) {
        const inConv = { ...(s.typing[convId] || {}) };
        delete inConv[senderIdOf(m)];
        typing = { ...s.typing, [convId]: inConv };
      }
      return { messages, conversations, typing };
    });

    if (!convExists) get().loadConversations();
    if (isActive && !mine) get().markRead(convId, m.id);
  },

  _applyMessageEdited: (m, hint) => {
    if (!m) return;
    const convId = convIdOf(m) ?? hint ?? null;
    set((s) => {
      const messages = { ...s.messages };
      const ids = convId ? [convId] : Object.keys(messages);
      for (const cid of ids) {
        const b = messages[cid];
        if (!b || !b.list.some((x) => x.id === m.id)) continue;
        messages[cid] = { ...b, list: b.list.map((x) => (x.id === m.id ? m : x)) };
      }
      const conversations = s.conversations.map((c) =>
        c.last_message && c.last_message.id === m.id ? { ...c, last_message: m } : c
      );
      return { messages, conversations };
    });
  },

  _applyMessageDeleted: (data) => {
    const mid = data?.id ?? data?.message_id ?? data?.message?.id;
    if (!mid) return;
    set((s) => {
      const messages = { ...s.messages };
      for (const cid of Object.keys(messages)) {
        const b = messages[cid];
        if (!b || !b.list.some((x) => x.id === mid)) continue;
        messages[cid] = { ...b, list: b.list.filter((x) => x.id !== mid) };
      }
      const conversations = s.conversations.map((c) =>
        c.last_message && c.last_message.id === mid ? { ...c, last_message: null } : c
      );
      return { messages, conversations };
    });
  },

  _applyConversationNew: (data) => {
    const conv = data?.conversation ?? null;
    if (conv?.id && !get().conversations.some((c) => c.id === conv.id)) {
      set((s) => ({ conversations: [conv, ...s.conversations] }));
    } else if (!conv) {
      get().loadConversations();
    }
  },

  // ---------------- رویدادهای گروهی (فاز ۴) ----------------
  _applyGroupNew: () => {
    get().loadConversations();
  },

  _applyGroupUpdated: (ev) => {
    // اگر خودم از گروه حذف شده بودم، گفتگو از لیست و صفحه پاک می‌شود
    if (ev?.reason === "member_removed" && ev.user_id != null && ev.user_id === myId()) {
      const convId = ev.conversation_id;
      set((s) => ({
        conversations: s.conversations.filter((c) => c.id !== convId),
        activeGroup: null,
      }));
      if (get().activeId === convId) get().setActive(null);
      return;
    }
    get().loadConversations();
    const s = get();
    if (s.activeGroup && ev.group_id === s.activeGroup.id) {
      get().loadActiveGroup(s.activeGroup.id);
    }
  },

  _applyGroupDeleted: (ev) => {
    const convId = ev.conversation_id;
    set((s) => {
      const messages = { ...s.messages };
      if (convId != null) delete messages[convId];
      return {
        conversations: s.conversations.filter((c) => c.id !== convId),
        activeGroup: s.activeGroup && s.activeGroup.id === ev.group_id ? null : s.activeGroup,
        messages,
      };
    });
    if (get().activeId === convId) get().setActive(null);
  },

  // ---------------- اکشن‌های REST ----------------
  loadConversations: async () => {
    set({ conversationsLoading: true });
    try {
      const data = await apiListConversations();
      const list = Array.isArray(data) ? data : data?.results ?? [];
      // seed تیک خوانده‌شدن از سرور — خصوصی فقط رو به جلو؛ گروه: set (عضو تازه کمینه را پایین می‌آورد)
      set((s) => {
        const readUpTo = { ...s.readUpTo };
        const groupReadSeed = { ...s.groupReadSeed };
        for (const c of list) {
          const v = Number(c.other_last_read_id ?? 0) || 0;
          if (c.group) {
            groupReadSeed[c.id] = v;
            readUpTo[c.id] = v;
          } else if (v > (readUpTo[c.id] ?? 0)) {
            readUpTo[c.id] = v;
          }
        }
        return { conversations: list, readUpTo, groupReadSeed };
      });
    } catch (e) {
      console.error("خطا در دریافت گفتگوها:", extractError ? extractError(e) : e);
    } finally {
      set({ conversationsLoading: false });
    }
  },

  createConversation: async (username) => {
    const data = await apiCreateConversation(username);
    const conv = data?.conversation ?? data;
    if (conv?.id) {
      set((s) => {
        const readUpTo = { ...s.readUpTo };
        const v = Number(conv.other_last_read_id ?? 0) || 0;
        if (v > (readUpTo[conv.id] ?? 0)) readUpTo[conv.id] = v;
        return {
          conversations: s.conversations.some((c) => c.id === conv.id)
            ? s.conversations
            : [conv, ...s.conversations],
          readUpTo,
        };
      });
      get().setActive(conv.id);
    }
    return conv;
  },

    setActive: (convId) => {
    set({ activeId: convId });
    if (convId == null) {
      set({ activeGroup: null });
      return;
    }
    const s = get();
    // گفتگوی گروهی → جزئیات گروه (اعضا و نقش‌ها) لود شود
    const conv = s.conversations.find((c) => c.id === convId);
    if (conv?.group?.id) {
      get().loadActiveGroup(conv.group.id);
    } else {
      set({ activeGroup: null });
    }
    // صفر کردن شمارنده نخوانده
    set((st) => ({
      conversations: st.conversations.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)),
    }));
    // همیشه از سرور تازه می‌گیریم: کشِ کهنه هم پیام‌های تازه را پنهان می‌کرد،
    // هم تیک خوانده‌شدن را با شناسه‌ی کهنه می‌فرستاد و سرور آن را نادیده می‌گرفت
    get().loadMessages(convId, { reset: true });
  },

  // ---------------- گروه‌ها (فاز ۴) ----------------
  loadActiveGroup: async (groupId) => {
    try {
      const g = await apiGetGroup(groupId);
      set({ activeGroup: g });
    } catch (e) {
      console.error("خطا در دریافت گروه:", extractError ? extractError(e) : e);
      set({ activeGroup: null });
    }
  },

  createGroup: async (name, members = []) => {
    const g = await apiCreateGroup(name, members);
    await get().loadConversations();
    if (g?.conversation_id) get().setActive(g.conversation_id);
    return g;
  },

  renameGroup: async (groupId, name) => {
    const g = await apiRenameGroup(groupId, name);
    set({ activeGroup: g });
    await get().loadConversations();
    return g;
  },

  addGroupMember: async (groupId, username) => {
    const member = await apiAddGroupMember(groupId, username);
    try {
      const g = await apiGetGroup(groupId);
      set({ activeGroup: g });
    } catch {}
    await get().loadConversations();
    return member;
  },

  removeGroupMember: async (groupId, userId) => {
    await apiRemoveGroupMember(groupId, userId);
    if (userId === myId()) {
      // خروج خودم از گروه — گفتگو بسته و از لیست حذف می‌شود
      set({ activeGroup: null });
      get().setActive(null);
      await get().loadConversations();
      return true;
    }
    try {
      const g = await apiGetGroup(groupId);
      set({ activeGroup: g });
    } catch {}
    await get().loadConversations();
    return true;
  },

  deleteGroup: async (groupId) => {
    const convId = get().activeGroup?.conversation_id ?? null;
    await apiDeleteGroup(groupId);
    set({ activeGroup: null });
    if (convId) get().setActive(null);
    await get().loadConversations();
    return true;
  },

  setActiveGroup: (g) => set({ activeGroup: g }),

  loadMessages: async (convId, { before, reset = false } = {}) => {
    set((s) => {
      const b = s.messages[convId] ?? { list: [], hasMore: false, loading: false };
      return { messages: { ...s.messages, [convId]: { ...b, loading: true } } };
    });
    try {
      const data = await apiListMessages(convId, before ? { before } : undefined);
      const results = Array.isArray(data) ? data : data?.results ?? [];
      const hasMore = Boolean(data?.has_more);
      set((s) => {
        const b = s.messages[convId] ?? { list: [], hasMore: false, loading: false };
        const seen = new Set();
        const merged = [...(reset ? [] : b.list), ...results]
          .filter((m) => !seen.has(m.id) && seen.add(m.id))
          .sort((x, y) => x.id - y.id);
        return { messages: { ...s.messages, [convId]: { list: merged, hasMore, loading: false } } };
      });
      if (reset && get().activeId === convId) {
        const list = get().messages[convId]?.list ?? [];
        const last = list[list.length - 1];
        if (last) get().markRead(convId, last.id);
      }
    } catch (e) {
      console.error("خطا در دریافت پیام‌ها:", extractError ? extractError(e) : e);
      set((s) => {
        const b = s.messages[convId] ?? { list: [], hasMore: false, loading: false };
        return { messages: { ...s.messages, [convId]: { ...b, loading: false } } };
      });
    }
  },

  sendMessage: async (convId, text, replyToId = null, attachment = null) => {
    let m;
    if (attachment?.file) {
      m = await apiSendMessageWithAttachment(convId, {
        text,
        replyToId,
        file: attachment.file,
        kind: attachment.kind,
        duration: attachment.duration ?? null,
      });
    } else {
      m = await apiSendMessage(convId, text, replyToId);
    }
    if (m?.id) {
      set((s) => {
        const messages = { ...s.messages };
        const b = messages[convId] ?? { list: [], hasMore: false, loading: false };
        if (!b.list.some((x) => x.id === m.id)) {
          messages[convId] = { ...b, list: [...b.list, m] };
        }
        const conversations = [...s.conversations];
        const idx = conversations.findIndex((c) => c.id === convId);
        if (idx >= 0) {
          const c = { ...conversations[idx], last_message: m };
          conversations.splice(idx, 1);
          conversations.unshift(c);
        }
        return { messages, conversations };
      });
      get().sendTyping(convId, false);
    }
    return m;
  },

  forwardMessage: async (messageId, targetConvId) => {
    const m = await apiForwardMessage(messageId, targetConvId);
    if (m?.id) {
      // اگر گفتگوی مقصد قبلاً لود شده، همان‌جا هم اضافه می‌کنیم؛
      // پوش WS هم می‌رسد ولی فقط گفتگوی فعال را لمس می‌کند — اینجا مقصد را دقیق به‌روز می‌کنیم
      set((s) => {
        const messages = { ...s.messages };
        const b = messages[targetConvId] ?? { list: [], hasMore: false, loading: false };
        if (!b.list.some((x) => x.id === m.id)) {
          messages[targetConvId] = { ...b, list: [...b.list, m] };
        }
        const conversations = [...s.conversations];
        const idx = conversations.findIndex((c) => c.id === targetConvId);
        if (idx >= 0) {
          const c = { ...conversations[idx], last_message: m };
          conversations.splice(idx, 1);
          conversations.unshift(c);
        }
        return { messages, conversations };
      });
    }
    return m;
  },

  editMessage: async (convId, messageId, text) => {
    const data = await apiEditMessage(messageId, text);
    get()._applyMessageEdited(data?.message ?? data, convId);
    return data;
  },

  deleteMessage: async (convId, messageId) => {
    await apiDeleteMessage(messageId);
    get()._applyMessageDeleted({ id: messageId });
  },

  searchUsers: async (q) => {
    if (typeof apiSearchUsers !== "function") {
      throw new Error("تابع جستجوی کاربر در api/chat.js پیدا نشد");
    }
    const data = await apiSearchUsers(q);
    return Array.isArray(data) ? data : data?.results ?? [];
  },

  // ---------------- فرمان‌های خروجی WebSocket ----------------
  markRead: (convId, messageId) => {
    if (!convId || !messageId) return;
    set((s) => ({
      conversations: s.conversations.map((c) => (c.id === convId ? { ...c, unread_count: 0 } : c)),
    }));
    get().sendCommand({ type: "read", conversation_id: convId, message_id: messageId });
  },

  sendTyping: (convId, state) => {
    if (!convId) return;
    if (state) lastSelfTyping[convId] = Date.now();
    else delete lastSelfTyping[convId];
    // سرور رشته‌ی "on"/"off" می‌خواهد — بولین بی‌صدا دور انداخته می‌شود
    get().sendCommand({ type: "typing", conversation_id: convId, state: state ? "on" : "off" });
  },
}));

export default useChatStore;