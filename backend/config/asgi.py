"""
نکته مهم: get_asgi_application() باید قبل از import ماژول‌های اپ صدا زده شود
تا رجیستری جنگو آماده شود و مدل‌ها قابل import باشند.
"""

import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator

from chat.middleware import JWTAuthMiddleware
from chat.routing import websocket_urlpatterns

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        "websocket": JWTAuthMiddleware(
            AllowedHostsOriginValidator(URLRouter(websocket_urlpatterns))
        ),
    }
)