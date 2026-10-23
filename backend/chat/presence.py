"""حضور کاربران در ردیس — مبنای نمایش آنلاین/آفلاین و آخرین بازدید.

- توابع async (mark_online / mark_offline / touch) از سمت consumers.py صدا زده می‌شوند.
- تابع sync (get_presence) از سمت ویوهای REST.
- شمارش اتصال‌ها پشتیبانی چند تب را درست نگه می‌دارد: «آنلاین» فقط با اولین
  اتصالِ باز اعلام می‌شود و «آفلاین» فقط با بسته‌شدن آخرین تب.
"""
import time
from datetime import datetime, timezone as dt_timezone

import redis
import redis.asyncio as redis_asyncio
from django.conf import settings
from django.utils import timezone as dj_timezone

ONLINE_TTL = 90                    # ثانیه — بزرگ‌تر از بازه پینگ (۳۰ ثانیه)
LAST_SEEN_TTL = 60 * 60 * 24 * 30  # سی روز

ONLINE_KEY = "presence:online:{user_id}"
CONNS_KEY = "presence:conns:{user_id}"
SEEN_KEY = "presence:last_seen:{user_id}"

_sync_redis = None
_async_redis = None


def _get_sync_redis():
    global _sync_redis
    if _sync_redis is None:
        _sync_redis = redis.Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _sync_redis


def _get_async_redis():
    global _async_redis
    if _async_redis is None:
        _async_redis = redis_asyncio.Redis.from_url(
            settings.REDIS_URL, decode_responses=True
        )
    return _async_redis


# ---------- سمت WebSocket (async) ----------

async def mark_online(user_id):
    """ثبت اتصال جدید؛ فقط اگر اولین اتصالِ باز باشد True برمی‌گرداند (برای اعلام آنلاین)."""
    r = _get_async_redis()
    conns_key = CONNS_KEY.format(user_id=user_id)
    count = await r.incr(conns_key)
    await r.expire(conns_key, ONLINE_TTL)
    if count == 1:
        await r.setex(ONLINE_KEY.format(user_id=user_id), ONLINE_TTL, "1")
        await r.set(SEEN_KEY.format(user_id=user_id), time.time(), ex=LAST_SEEN_TTL)
        return True
    return False


async def mark_offline(user_id):
    """ثبت قطع یک اتصال؛ فقط اگر آخرین اتصالِ باز بود True برمی‌گرداند (برای اعلام آفلاین)."""
    r = _get_async_redis()
    conns_key = CONNS_KEY.format(user_id=user_id)
    remaining = await r.decr(conns_key)
    if remaining <= 0:
        # آخرین اتصال بسته شد (یا شمارش از قبل صفر بود — ریست می‌کنیم)
        await r.delete(conns_key)
        was_online = await r.delete(ONLINE_KEY.format(user_id=user_id))
        await r.set(SEEN_KEY.format(user_id=user_id), time.time(), ex=LAST_SEEN_TTL)
        return bool(was_online)
    return False


async def touch(user_id):
    """تمدید مهلت کلیدها — با هر ping (هر ۳۰ ثانیه) صدا زده می‌شود."""
    r = _get_async_redis()
    await r.expire(ONLINE_KEY.format(user_id=user_id), ONLINE_TTL)
    await r.expire(CONNS_KEY.format(user_id=user_id), ONLINE_TTL)


# ---------- سمت REST (sync) ----------

def get_presence(user_ids):
    """وضعیت چند کاربر: {user_id: {"online": bool, "last_seen": "ISO" یا None}}"""
    ids = list({u for u in user_ids if u})
    if not ids:
        return {}
    r = _get_sync_redis()
    online_vals = r.mget([ONLINE_KEY.format(user_id=u) for u in ids])
    seen_vals = r.mget([SEEN_KEY.format(user_id=u) for u in ids])

    result = {}
    for uid, on, ts in zip(ids, online_vals, seen_vals):
        last_seen = None
        if ts:
            try:
                moment = datetime.fromtimestamp(float(ts), tz=dt_timezone.utc)
                last_seen = dj_timezone.localtime(moment).isoformat()
            except (TypeError, ValueError):
                last_seen = None
        result[uid] = {"online": bool(on), "last_seen": last_seen}
    return result