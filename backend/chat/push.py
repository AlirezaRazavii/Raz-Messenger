"""ارسال رویداد از کد سینک (ویوهای REST) به سوکت‌های باز کاربران."""
from asgiref.sync import async_to_sync
from channels.layers import get_channel_layer


def user_group(user_id):
    """نام گروه شخصی هر کاربر — همان چیزی که consumers.py با group_add عضو می‌شود."""
    return f"user_{user_id}"


def push_to_users(user_ids, event):
    """رویداد را به گروه شخصی همه کاربران داده‌شده می‌فرستد.

    نوع پیام لایه‌ی کانال "chat.event" است تا مستقیم به متد chat_event کانسومر
    برسد — همان مسیر رویدادهای typing/read/presence.
    """
    layer = get_channel_layer()
    for uid in sorted(set(user_ids)):
        async_to_sync(layer.group_send)(
            user_group(uid), {"type": "chat.event", "payload": event}
        )