// 🔴 موقت: چون شکل صادرات client.js (default / api / client) هنوز دیدهم نشده،
// هر سه حالت پوشش داده شده. این خط با فایل تو کار کرده، پس دست نمی‌زنیم.
// (اختیاری: بعداً client.js را بفرست تا به یک import ساده تبدیلش کنم.)
import * as clientModule from "./client";
const api = clientModule.default ?? clientModule.api ?? clientModule.client;

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

// بیمه موقت: اگر فایل قدیمی‌ای هنوز apiFetchMessages را import می‌کرد نشکند.
// در فاز ۲-هـ می‌توانی این یک خط را حذف کنی.
export const apiFetchMessages = apiListMessages;

export async function apiSendMessage(conversationId, text) {
  return unwrap(api.post(`/chat/conversations/${conversationId}/messages/`, { text }));
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