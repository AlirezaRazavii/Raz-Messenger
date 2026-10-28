"""وضعیت تماس در حال زنگ — روی ردیس، تا تماسِ در جریان «گم» نشود.

اگر کاربرِ دریافت‌کننده هنگام offer سوکتِ باز نداشته باشد (خارج از برنامه
بود، در حال وصلِ مجدد بود، تب گوشی خواب بود و...)، سیگنال فقط از سوکت رد
می‌شود و برای همیشه گم می‌شود. این‌جا وضعیت زنگ با TTL هم‌اندازه‌ی پنجره‌ی
۴۵ ثانیه‌ای کلاینت ذخیره می‌شود و با هر اتصالِ جدیدِ همان کاربر دوباره
پخش می‌شود — یعنی اگر در همین پنجره وارد برنامه شود، زنگ را می‌بیند.
"""
import json
import time

import redis.asyncio as redis_asyncio

from django.conf import settings

RING_TTL = 46     # ثانیه — کمی بیشتر از تایمر ۴۵ ثانیه‌ای کلاینت
SETTLED_TTL = 60  # ثانیه — پس از جواب/رد، سیگنال‌های سرگردان دستگاه‌های دیگر خنثی می‌شوند

STATE_KEY = "call:state:{user_id}"

_async_redis = None


def _get_async_redis():
    global _async_redis
    if _async_redis is None:
        _async_redis = redis_asyncio.Redis.from_url(
            settings.REDIS_URL, decode_responses=True
        )
    return _async_redis


async def set_ringing(callee_id, *, caller_id, caller_username, conversation_id, call_type, sdp):
    """شروع زنگ برای کاربر دریافت‌کننده — offer کامل ذخیره می‌شود."""
    r = _get_async_redis()
    payload = {
        "status": "ringing",
        "conversation_id": conversation_id,
        "caller_id": caller_id,
        "caller_username": caller_username,
        "call_type": call_type,
        "sdp": sdp,
        "expires_at": int(time.time() * 1000) + 45000,
    }
    await r.set(STATE_KEY.format(user_id=callee_id), json.dumps(payload), ex=RING_TTL)


async def get_state(user_id):
    """وضعیت ذخیره‌شده — یا None."""
    r = _get_async_redis()
    raw = await r.get(STATE_KEY.format(user_id=user_id))
    if not raw:
        return None
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


async def mark_settled(user_id, conversation_id, status):
    """جواب/رد داده شد — کلیدِ همین گفتگو به وضعیت settled می‌رود.

    hangupهای سرگردان از دستگاه‌های دیگرِ همین کاربر (که هنوز زنگ می‌خورده‌اند)
    با دیدن این وضعیت روی سرور دور ریخته می‌شوند و تماسِ فعال را نمی‌کشند.
    """
    r = _get_async_redis()
    raw = await r.get(STATE_KEY.format(user_id=user_id))
    if not raw:
        return
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return
    if data.get("conversation_id") != conversation_id:
        return  # زنگِ گفتگوی دیگری است؛ دست نزن
    data["status"] = status
    data["sdp"] = None  # دیگر لازم نیست
    await r.set(STATE_KEY.format(user_id=user_id), json.dumps(data), ex=SETTLED_TTL)


async def clear(user_id, conversation_id):
    """پاک‌کردن زنگِ همین گفتگو (مثلاً hangup تماس‌گیرنده)."""
    r = _get_async_redis()
    raw = await r.get(STATE_KEY.format(user_id=user_id))
    if not raw:
        return
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return
    if data.get("conversation_id") == conversation_id:
        await r.delete(STATE_KEY.format(user_id=user_id))