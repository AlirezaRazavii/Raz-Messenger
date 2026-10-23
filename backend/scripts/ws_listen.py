"""شنونده‌ی رویدادهای WebSocket — برای تست دستی پوش REST.

اجرا (از پوشه backend با venv فعال):
    python scripts\ws_listen.py

دو اتصال باز می‌ماند و ۵ دقیقه هر رویداد ورودی را چاپ می‌کند.
در این فاصله از پنجره‌ی دیگر، دستورات REST را بزن. (Ctrl+C برای توقف زودتر)
"""
import asyncio
import json
import urllib.request

import websockets

BASE = "http://127.0.0.1:8000"
WS_BASE = "ws://127.0.0.1:8000/ws/"
WS_ORIGIN = "http://127.0.0.1:8000"
LISTEN_SECONDS = 300  # مدت ماندن اتصال‌ها (۵ دقیقه)

# ⚠️ همان یوزرنیم/رمزهایی که بالای ws_test.py نوشته‌ای، اینجا هم بگذار
USERS = [
    ("alireza", "alireza", "1274554756qW#rahimi"),
    ("testuser", "testuser", "1274554756qW#"),
]


def get_access_token(username, password):
    body = json.dumps({"username": username, "password": password}).encode("utf-8")
    req = urllib.request.Request(
        BASE + "/api/auth/login/",
        data=body,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(req) as response:
        return json.loads(response.read())["access"]


async def reader(label, ws):
    while True:
        message = await ws.recv()
        print(f"  [{label}] ← {message}")


async def pinger(ws):
    """ضربان ۳۰ ثانیه‌ای — همان کاری که فرانت‌اند در فاز ۲-د خواهد کرد."""
    while True:
        await asyncio.sleep(30)
        await ws.send(json.dumps({"type": "ping"}))


async def main():
    tasks = []
    try:
        for label, username, password in USERS:
            token = get_access_token(username, password)
            ws = await websockets.connect(
                WS_BASE + f"?token={token}", origin=WS_ORIGIN
            )
            tasks.append(asyncio.create_task(reader(label, ws)))
            tasks.append(asyncio.create_task(pinger(ws)))
            print(f"  [{label}] متصل شد.")
        print(f"در حال شنیدن به مدت {LISTEN_SECONDS // 60} دقیقه... (Ctrl+C برای توقف)")
        await asyncio.sleep(LISTEN_SECONDS)
    finally:
        for task in tasks:
            task.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nپایان شنیدن.")