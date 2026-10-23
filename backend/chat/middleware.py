import json
from urllib.parse import parse_qs

from channels.db import database_sync_to_async
from channels.middleware import BaseMiddleware


@database_sync_to_async
def _user_from_token(raw_token):
    from django.contrib.auth import get_user_model
    from rest_framework_simplejwt.exceptions import TokenError
    from rest_framework_simplejwt.tokens import AccessToken

    try:
        token = AccessToken(raw_token)  # امضا و انقضا اعتبارسنجی می‌شود
    except TokenError:
        return None
    try:
        return get_user_model().objects.get(id=token["user_id"], is_active=True)
    except get_user_model().DoesNotExist:
        return None


class JWTAuthMiddleware(BaseMiddleware):
    """احراز هویت سوکت با توکن در کوئری‌استرینگ: ws://host/ws/?token=<access>"""

    async def __call__(self, scope, receive, send):
        if scope["type"] == "websocket":
            raw_token = None
            try:
                query = parse_qs(scope.get("query_string", b"").decode())
                raw_token = (query.get("token") or [None])[0]
            except Exception:
                raw_token = None

            scope["user"] = await _user_from_token(raw_token) if raw_token else None

            if scope["user"] is None:
                # رد مؤدبانه: قبول، پیام خطا، سپس بستن با کد 4001
                await send({"type": "websocket.accept"})
                await send(
                    {
                        "type": "websocket.send",
                        "text": json.dumps(
                            {"type": "ws.error", "detail": "توکن نامعتبر است."},
                            ensure_ascii=False,
                        ),
                    }
                )
                await send({"type": "websocket.close", "code": 4001})
                return

        return await super().__call__(scope, receive, send)