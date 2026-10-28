import time

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import callstate, presence
from .push import user_group


def _as_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


class ChatConsumer(AsyncJsonWebsocketConsumer):
    """سوکت شخصی هر کاربر — همه رویدادهای چت از همین یک اتصال."""

    async def connect(self):
        self.user = self.scope.get("user")
        if self.user is None or not self.user.is_authenticated:
            await self.close(code=4001)
            return

        self.group_name = user_group(self.user.id)
        await self.channel_layer.group_add(self.group_name, self.channel_name)
        await self.accept()

        if await presence.mark_online(self.user.id):
            await self._broadcast_presence(online=True)

        await self.send_json({"type": "ws.connected", "user_id": self.user.id})

        # تماسی که در غیاب ما زنگ خورده باشد (پنجره‌ی ۴۵ ثانیه) → همین الان پخش شود؛
        # هم «ورود دوباره به برنامه» و هم «وصل مجدد سوکت» را پوشش می‌دهد
        ring = await callstate.get_state(self.user.id)
        if ring and ring.get("status") == "ringing":
            await self.send_json({
                "type": "call.signal",
                "conversation_id": ring.get("conversation_id"),
                "user_id": ring.get("caller_id"),
                "signal": {
                    "kind": "offer",
                    "call_type": ring.get("call_type", "audio"),
                    "sdp": ring.get("sdp"),
                    "expires_at": ring.get("expires_at"),
                    "caller_username": ring.get("caller_username", ""),
                },
            })

    async def disconnect(self, close_code):
        user = getattr(self, "user", None)
        if user is None or not user.is_authenticated:
            return
        await self.channel_layer.group_discard(self.group_name, self.channel_name)
        if await presence.mark_offline(user.id):
            await self._broadcast_presence(online=False)

    # ---------- رویدادهای ورودی از کلاینت ----------

    async def receive_json(self, content, **kwargs):
        if not isinstance(content, dict):
            return
        event_type = content.get("type")

        if event_type == "ping":
            await presence.touch(self.user.id)
            await self.send_json({"type": "pong"})

        elif event_type == "typing":
            await self._handle_typing(content)

        elif event_type == "read":
            await self._handle_read(content)

        elif event_type == "call.signal":
            await self._handle_call(content)
        # رویداد ناشناخته → بی‌صدا نادیده گرفته می‌شود

    async def _handle_typing(self, content):
        conversation_id = _as_int(content.get("conversation_id"))
        state = content.get("state", "on")
        if conversation_id is None or state not in ("on", "off"):
            return
        if not await self._is_member(conversation_id):
            return
        await self._send_to_others(
            conversation_id,
            {
                "type": "typing",
                "conversation_id": conversation_id,
                "user_id": self.user.id,
                "state": state,
            },
        )

    async def _handle_read(self, content):
        conversation_id = _as_int(content.get("conversation_id"))
        message_id = _as_int(content.get("message_id"))
        if conversation_id is None or message_id is None:
            return
        if not await self._update_last_read(conversation_id, message_id):
            return
        await self._send_to_others(
            conversation_id,
            {
                "type": "read",
                "conversation_id": conversation_id,
                "user_id": self.user.id,
                "last_read_message_id": message_id,
            },
        )
        
    async def _handle_call(self, content):
        """سیگنالینگ WebRTC (فاز ۵) — بازتاب سیگنال تماس به اعضای دیگر گفتگو."""
        conversation_id = _as_int(content.get("conversation_id"))
        signal = content.get("signal")
        if conversation_id is None or not isinstance(signal, dict):
            return
        if not await self._is_member(conversation_id):
            return
        if await self._is_group(conversation_id):
            return  # تماس فقط برای گفتگوی خصوصی است (فاز ۵)

        kind = signal.get("kind")
        member_ids = await self._member_ids(conversation_id)
        others = [m for m in member_ids if m != self.user.id]

        if kind == "offer":
            # زنگ روی سرور ذخیره می‌شود تا اگر کاربر در پنجره‌ی ۴۵ ثانیه وارد
            # شد یا سوکتش وصلِ مجدد شد، تماس از سرور دوباره به او برسد
            for member_id in others:
                await callstate.set_ringing(
                    member_id,
                    caller_id=self.user.id,
                    caller_username=self.user.username,
                    conversation_id=conversation_id,
                    call_type=signal.get("call_type", "audio"),
                    sdp=signal.get("sdp"),
                )
            out_signal = dict(signal)
            out_signal["expires_at"] = int(time.time() * 1000) + 45000
            out_signal["caller_username"] = self.user.username
            await self._relay_call(others, conversation_id, out_signal)
            return

        if kind in ("answer", "reject"):
            # اول همه‌ی دستگاه‌های خودِ پاسخ‌دهنده زنگشان خاموش شود، بعد به
            # تماس‌گیرنده برسد
            await callstate.mark_settled(self.user.id, conversation_id, kind)
            await self.channel_layer.group_send(
                self.group_name,
                {
                    "type": "chat.event",
                    "payload": {
                        "type": "call.signal",
                        "conversation_id": conversation_id,
                        "user_id": self.user.id,
                        "signal": {"kind": "answered" if kind == "answer" else "rejected"},
                    },
                },
            )
            await self._relay_call(others, conversation_id, signal)
            return

        if kind == "hangup":
            # hangupِ سرگردان از دستگاهی که تماس همان‌جا جواب/رد شده → دور
            # انداخته می‌شود؛ وگرنه تایمرِ آن دستگاه تماسِ فعال را می‌کشت
            state = await callstate.get_state(self.user.id)
            if (
                state
                and state.get("conversation_id") == conversation_id
                and state.get("status") in ("answer", "reject")
            ):
                return
            await callstate.clear(self.user.id, conversation_id)
            for member_id in others:
                await callstate.clear(member_id, conversation_id)
            await self._relay_call(others, conversation_id, signal)
            return

        # بقیه‌ی سیگنال‌ها (مثل ice و busy)
        await self._relay_call(others, conversation_id, signal)

    async def _relay_call(self, member_ids, conversation_id, signal):
        """ارسال سیگنال تماس به اعضای داده‌شده."""
        payload = {
            "type": "call.signal",
            "conversation_id": conversation_id,
            "user_id": self.user.id,
            "signal": signal,
        }
        for member_id in member_ids:
            await self.channel_layer.group_send(
                user_group(member_id), {"type": "chat.event", "payload": payload}
            )

    # ---------- رویدادهای خروجی ----------

    async def chat_event(self, event):
        """رویداد پوش‌شده (از REST یا کاربر دیگر) → تحویل به کلاینت."""
        await self.send_json(event["payload"])

    async def _send_to_others(self, conversation_id, payload):
        """ارسال به اعضای گفتگو به‌جز خودِ فرستنده."""
        for member_id in await self._member_ids(conversation_id):
            if member_id == self.user.id:
                continue
            await self.channel_layer.group_send(
                user_group(member_id), {"type": "chat.event", "payload": payload}
            )

    async def _broadcast_presence(self, online):
        """اعلام آنلاین/آفلاین به کسانی که گفتگوی مشترک دارند."""
        payload = {"type": "presence", "user_id": self.user.id, "online": online}
        for partner_id in await self._partner_ids():
            await self.channel_layer.group_send(
                user_group(partner_id), {"type": "chat.event", "payload": payload}
            )
    # ---------- کارهای دیتابیس ----------

    @database_sync_to_async
    def _is_member(self, conversation_id):
        from .models import Participant

        return Participant.objects.filter(
            conversation_id=conversation_id, user_id=self.user.id
        ).exists()

    @database_sync_to_async
    def _is_group(self, conversation_id):
        from .models import Conversation

        return Conversation.objects.filter(
            id=conversation_id, group__isnull=False
        ).exists()

    @database_sync_to_async
    def _member_ids(self, conversation_id):
        from .models import Participant

        return list(
            Participant.objects.filter(conversation_id=conversation_id).values_list(
                "user_id", flat=True
            )
        )

    @database_sync_to_async
    def _partner_ids(self):
        from .models import Participant

        return list(
            Participant.objects.filter(conversation__members__user_id=self.user.id)
            .exclude(user_id=self.user.id)
            .values_list("user_id", flat=True)
            .distinct()
        )

    @database_sync_to_async
    def _update_last_read(self, conversation_id, message_id):
        from .models import Message, Participant

        participant = Participant.objects.filter(
            conversation_id=conversation_id, user_id=self.user.id
        ).first()
        if participant is None:
            return False
        # «خوانده‌شده» فقط رو به جلو حرکت می‌کند
        if (participant.last_read_message_id or 0) >= message_id:
            return False
        if not Message.objects.filter(
            conversation_id=conversation_id, id=message_id
        ).exists():
            return False
        participant.last_read_message_id = message_id
        participant.save(update_fields=["last_read_message"])
        return True