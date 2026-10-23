from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer

from . import presence
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