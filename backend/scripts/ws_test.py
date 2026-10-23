"""
تست دستی سوکت چت: دو کاربر، پینگ، تایپ و خوانده‌شدن.
اجرا (با runserver روشن، از پوشه backend):  python scripts\\ws_test.py
تست توکن غلط:                                python scripts\\ws_test.py bad
"""

import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

import websockets

from django.contrib.auth import get_user_model

WS_BASE = "ws://127.0.0.1:8000/ws/"
WS_ORIGIN = "http://127.0.0.1:8000"


def prepare():
    """ساخت/یافتن گفتگو و پیام نمونه بین testuser و admin."""
    from chat.models import Conversation, Message, Participant
    from rest_framework_simplejwt.tokens import AccessToken

    User = get_user_model()
    u1 = User.objects.get(username="testuser")
    u2 = User.objects.get(username="alireza")

    conversation = (
        Conversation.objects.filter(members__user=u1).filter(members__user=u2).first()
    )
    if conversation is None:
        conversation = Conversation.objects.create()
        Participant.objects.create(conversation=conversation, user=u1)
        Participant.objects.create(conversation=conversation, user=u2)
        print(f"گفتگوی نمونه ساخته شد: id={conversation.id}")

    message = Message.objects.filter(conversation=conversation).order_by("-id").first()
    if message is None:
        message = Message.objects.create(
            conversation=conversation, sender=u2, text="پیام تست"
        )
        print(f"پیام نمونه ساخته شد: id={message.id}")

    return {
        "tokens": (str(AccessToken.for_user(u1)), str(AccessToken.for_user(u2))),
        "conversation_id": conversation.id,
        "message_id": message.id,
    }


async def listen(ws, name):
    try:
        async for raw in ws:
            print(f"  [{name}] ← {raw}")
    except Exception:
        pass


async def run(prep):
    t1, t2 = prep["tokens"]
    async with (
        websockets.connect(WS_BASE + f"?token={t1}", origin=WS_ORIGIN) as ws1,
        websockets.connect(WS_BASE + f"?token={t2}", origin=WS_ORIGIN) as ws2,
    ):
        l1 = asyncio.create_task(listen(ws1, "testuser"))
        l2 = asyncio.create_task(listen(ws2, "admin"))
        await asyncio.sleep(0.5)

        print("→ testuser: ping")
        await ws1.send(json.dumps({"type": "ping"}))

        print("→ testuser: typing on")
        await ws1.send(json.dumps({"type": "typing", "conversation_id": prep["conversation_id"], "state": "on"}))

        print("→ testuser: typing off")
        await ws1.send(json.dumps({"type": "typing", "conversation_id": prep["conversation_id"], "state": "off"}))

        print("→ testuser: read")
        await ws1.send(json.dumps({"type": "read", "conversation_id": prep["conversation_id"], "message_id": prep["message_id"]}))

        await asyncio.sleep(1.5)
        l1.cancel()
        l2.cancel()
        print("\nپایان تست — رویدادهای موردانتظار بالا باید آمده باشند.")


async def bad_token_test():
    async with websockets.connect(WS_BASE + "?token=invalid-token") as ws:
        raw = await ws.recv()
        print("پاسخ با توکن غلط:", raw)
        try:
            await ws.recv()
        except websockets.exceptions.ConnectionClosed as e:
            code = e.rcvd.code if e.rcvd else None
            print("اتصال بسته شد با کد:", code, "(انتظار: 4001)")


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "bad":
        asyncio.run(bad_token_test())
    else:
        prep = prepare()
        print(f"conversation_id={prep['conversation_id']}  message_id={prep['message_id']}\n")
        asyncio.run(run(prep))