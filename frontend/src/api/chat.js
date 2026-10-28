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

export async function apiSendMessageWithAttachment(
  conversationId,
  { text, file, kind, duration, replyToId }
) {
  const body = new FormData();
  if (text) body.append("text", text);
  if (replyToId) body.append("reply_to", String(replyToId));
  if (kind) body.append("kind", kind);
  if (duration != null) body.append("duration", String(duration));
  body.append("attachment", file);
  // FormData را بدون هدر دستی می‌فرستیم — خودِ axios مرز multipart را می‌سازد
  return unwrap(api.post(`/chat/conversations/${conversationId}/messages/`, body));
}

export async function apiDownloadAttachment(messageId) {
  return unwrap(
    api.get(`/chat/messages/${messageId}/attachment/`, { responseType: "blob" })
  );
}

export async function apiForwardMessage(messageId, conversationId) {
  return unwrap(api.post(`/chat/messages/${messageId}/forward/`, { conversation_id: conversationId }));
}

export async function apiEditMessage(messageId, text) {
  return unwrap(api.patch(`/chat/messages/${messageId}/`, { text }));
}

// scope: "me" = مخفی برای خودم (حتی پیام طرف مقابل)؛ "everyone" = حذف دوطرفه (فقط پیام خودم)
export async function apiDeleteMessage(messageId, scope = "everyone") {
  return unwrap(api.delete(`/chat/messages/${messageId}/`, { data: { scope } }));
}

// حذف دسته‌ای — همان دو scope
export async function apiBulkDeleteMessages(conversationId, ids, scope = "me") {
  return unwrap(
    api.post(`/chat/conversations/${conversationId}/messages/bulk-delete/`, { ids, scope })
  );
}

export async function apiSearchUsers(q) {
  return unwrap(api.get("/chat/users/", { params: { q } }));
}

// ---------- گروه‌ها (فاز ۴) ----------

export async function apiCreateGroup(name, members = []) {
  return unwrap(api.post("/chat/groups/", { name, members }));
}

export async function apiGetGroup(groupId) {
  return unwrap(api.get(`/chat/groups/${groupId}/`));
}

export async function apiRenameGroup(groupId, name) {
  return unwrap(api.patch(`/chat/groups/${groupId}/`, { name }));
}

export async function apiDeleteGroup(groupId) {
  return unwrap(api.delete(`/chat/groups/${groupId}/`));
}

export async function apiAddGroupMember(groupId, username) {
  return unwrap(api.post(`/chat/groups/${groupId}/members/`, { username }));
}

// خروج خود از گروه هم با همین است — userId = شناسه خودم
export async function apiRemoveGroupMember(groupId, userId) {
  return unwrap(api.delete(`/chat/groups/${groupId}/members/${userId}/`));
}

// ---------- تماس‌ها (فاز ۵، بسته ۱) ----------

export async function apiListCalls() {
  return unwrap(api.get("/chat/calls/"));
}