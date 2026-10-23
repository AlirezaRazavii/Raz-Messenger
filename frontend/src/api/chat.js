import api from "./client";

// اگر client.js اینترسپتوری دارد که خودش data را برمی‌گرداند، مقدار دست‌نخورده
// برمی‌گردد؛ در غیر این صورت res.data را باز می‌کند. با هر دو حالت سازگار است.
async function unwrap(promise) {
  const res = await promise;
  if (res && typeof res === "object" && "data" in res) return res.data;
  return res;
}

export function extractError(error, fallback = "خطایی رخ داد. دوباره تلاش کن.") {
  const data = error?.response?.data;
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (typeof value === "string") return value;
      if (Array.isArray(value) && typeof value[0] === "string") return value[0];
    }
  }
  return fallback;
}

export async function apiListConversations() {
  return unwrap(api.get("/chat/conversations/"));
}

export async function apiCreateConversation(username) {
  return unwrap(api.post("/chat/conversations/", { username }));
}

export async function apiListMessages(conversationId, { before, limit } = {}) {
  const params = [];
  if (before) params.push(`before=${before}`);
  if (limit) params.push(`limit=${limit}`);
  const query = params.length ? `?${params.join("&")}` : "";
  return unwrap(api.get(`/chat/conversations/${conversationId}/messages/${query}`));
}


export async function apiSendMessage(conversationId, text, replyToId = null) {
  const body = { text };
  if (replyToId) body.reply_to = replyToId;
  return unwrap(api.post(`/chat/conversations/${conversationId}/messages/`, body));
}

export async function apiForwardMessage(messageId, conversationId) {
  return unwrap(api.post(`/chat/messages/${messageId}/forward/`, { conversation_id: conversationId }));
}

export async function apiEditMessage(messageId, text) {
  return unwrap(api.patch(`/chat/messages/${messageId}/`, { text }));
}

export async function apiDeleteMessage(messageId) {
  return unwrap(api.delete(`/chat/messages/${messageId}/`));
}

export async function apiSearchUsers(q) {
  return unwrap(api.get("/chat/users/", { params: { q } }));
}