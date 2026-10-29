from datetime import timedelta
import io

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.core.mail import send_mail
from django.core.files.base import ContentFile
from django.db import transaction
from django.http import FileResponse
from django.utils import timezone

from PIL import Image
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import (
    BlacklistedToken,
    OutstandingToken,
)
from rest_framework_simplejwt.tokens import RefreshToken

from .models import InviteCode, PasswordResetCode
from .serializers import (
    ChangePasswordConfirmSerializer,
    ChangePasswordRequestSerializer,
    ForgotPasswordSerializer,
    LoginSerializer,
    ProfileUpdateSerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    UserSerializer,
)

User = get_user_model()

MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15
CODE_TTL_MINUTES = 10

MAX_AVATAR_MB = 5
AVATAR_SIZE = 512  # مربع ۵۱۲×۵۱۲ — برای دایره‌های اپ کاملاً کافی است


# ---------- توابع کمکی ----------

def _issue_tokens(user):
    token = RefreshToken.for_user(user)
    return {"access": str(token.access_token), "refresh": str(token)}


def _apply_new_password(user, new_password):
    """تنظیم رمز جدید، بازکردن قفل احتمالی و باطل‌کردن همه توکن‌های قبلی."""
    user.set_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.save(update_fields=["password", "failed_login_attempts", "locked_until"])
    # خروج از همه دستگاه‌ها: همه توکن‌های صادرشده قبلی باطل می‌شوند
    for outstanding in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=outstanding)
    return _issue_tokens(user)


def _send_code_email(user, code, purpose):
    if purpose == PasswordResetCode.PURPOSE_RESET:
        subject = "بازیابی رمز عبور"
        action = "بازیابی رمز عبور"
    else:
        subject = "تأیید تغییر رمز عبور"
        action = "تغییر رمز عبور"
    body = (
        f"سلام {user.username} عزیز،\n\n"
        f"کد تأیید {action} شما: {code}\n"
        f"این کد تا {CODE_TTL_MINUTES} دقیقه معتبر است.\n"
        f"اگر شما چنین درخواستی نداده‌اید، این ایمیل را نادیده بگیرید."
    )
    send_mail(subject, body, settings.DEFAULT_FROM_EMAIL, [user.email], fail_silently=False)


def create_and_send_code(user, purpose):
    """باطل‌کردن کدهای قبلی، ساخت کد تازه و ارسال ایمیل. خروجی: (موفق؟, پیام خطا)"""
    PasswordResetCode.objects.filter(
        user=user, purpose=purpose, used_at__isnull=True
    ).update(used_at=timezone.now())
    code_obj = PasswordResetCode.objects.create(
        user=user,
        purpose=purpose,
        code=PasswordResetCode.generate_code(),
        expires_at=timezone.now() + timedelta(minutes=CODE_TTL_MINUTES),
    )
    try:
        _send_code_email(user, code_obj.code, purpose)
        return True, ""
    except Exception:
        return False, "ارسال ایمیل ناموفق بود؛ کمی بعد دوباره تلاش کنید."


def _broadcast_profile_updated(user):
    """اعلام تغییر پروفایل به همه‌ی کسانی که گفتگوی مشترک دارند.

    فرانت با دیدن این رویداد لیست گفتگوها (و اعضای گروهِ باز) را تازه می‌کند.
    """
    try:
        from chat.models import Participant
        from chat.push import push_to_users

        partner_ids = list(
            Participant.objects.filter(
                conversation__participants=user
            )
            .exclude(user=user)
            .values_list("user_id", flat=True)
            .distinct()
        )
        push_to_users(
            partner_ids + [user.id],
            {
                "type": "user.updated",
                "user_id": user.id,
                "username": user.username,
                "display_name": user.display_name,
            },
        )
    except Exception:
        pass  # پخش زنده اختیاری است — ذخیره در دیتابیس مهم است


# ---------- ثبت‌نام ----------

class RegisterView(generics.CreateAPIView):
    """
    ثبت‌نام فقط با کد دعوت معتبر.
    شمارنده کد با select_for_update داخل تراکنش قفل می‌شود تا دو درخواست
    همزمان نتوانند از ظرفیت آخر کد بیشتر استفاده کنند.
    """

    serializer_class = RegisterSerializer
    permission_classes = [permissions.AllowAny]

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        with transaction.atomic():
            try:
                invite = InviteCode.objects.select_for_update().get(
                    code=serializer.validated_data["invite_code"]
                )
            except InviteCode.DoesNotExist:
                return Response(
                    {"invite_code": ["کد دعوت نامعتبر است."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if not invite.is_valid:
                return Response(
                    {"invite_code": ["این کد دعوت معتبر نیست (منقضی یا ظرفیتش تکمیل شده است)."]},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            invite.used_count += 1
            invite.save(update_fields=["used_count"])
            user = serializer.save(used_invite=invite)

        return Response(
            {"user": UserSerializer(user).data, **_issue_tokens(user)},
            status=status.HTTP_201_CREATED,
        )


class MeView(generics.RetrieveUpdateAPIView):
    """اطلاعات کاربر واردشده — GET برای دیدن، PATCH برای ویرایش پروفایل."""

    serializer_class = UserSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_object(self):
        return self.request.user

    def patch(self, request, *args, **kwargs):
        serializer = ProfileUpdateSerializer(
            request.user, data=request.data, partial=True
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        _broadcast_profile_updated(request.user)
        return Response(UserSerializer(request.user).data)


# ---------- ورود / خروج ----------

class LoginView(generics.GenericAPIView):
    """ورود با نام کاربری و رمز؛ بعد از ۵ خطا حساب به مدت ۱۵ دقیقه قفل می‌شود."""

    serializer_class = LoginSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        username = serializer.validated_data["username"].strip()
        password = serializer.validated_data["password"]

        user = User.objects.filter(username__iexact=username).first()

        if user is None:
            return Response(
                {"detail": "نام کاربری یا رمز عبور اشتباه است."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        if user.locked_until and timezone.now() < user.locked_until:
            minutes_left = max(
                1, int((user.locked_until - timezone.now()).total_seconds() // 60) + 1
            )
            return Response(
                {
                    "detail": f"حساب شما به دلیل تلاش‌های ناموفق قفل شده است؛ حدود {minutes_left} دقیقه دیگر دوباره تلاش کنید."
                },
                status=status.HTTP_403_FORBIDDEN,
            )

        if not user.is_active:
            return Response(
                {"detail": "حساب شما غیرفعال است."}, status=status.HTTP_403_FORBIDDEN
            )

        auth_user = authenticate(request, username=user.username, password=password)
        if auth_user is None:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_FAILED_LOGINS:
                user.locked_until = timezone.now() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
                user.save(update_fields=["failed_login_attempts", "locked_until"])
                return Response(
                    {"detail": f"تعداد تلاش‌های ناموفق زیاد بود؛ حساب شما به مدت {LOCKOUT_MINUTES} دقیقه قفل شد."},
                    status=status.HTTP_403_FORBIDDEN,
                )
            user.save(update_fields=["failed_login_attempts"])
            remaining = MAX_FAILED_LOGINS - user.failed_login_attempts
            return Response(
                {"detail": f"نام کاربری یا رمز عبور اشتباه است. ({remaining} تلاش باقی مانده)"},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        user.failed_login_attempts = 0
        user.locked_until = None
        user.save(update_fields=["failed_login_attempts", "locked_until"])

        return Response({"user": UserSerializer(user).data, **_issue_tokens(user)})


class LogoutView(APIView):
    """خروج — توکن refresh باطل (blacklist) می‌شود."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        refresh = request.data.get("refresh")
        if not refresh:
            return Response(
                {"detail": "توکن refresh ارسال نشده است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            token = RefreshToken(refresh)
            token.blacklist()
        except Exception:
            return Response(
                {"detail": "توکن نامعتبر است."}, status=status.HTTP_400_BAD_REQUEST
            )
        return Response({"detail": "با موفقیت خارج شدید."})


# ---------- بازیابی رمز (فراموشی) ----------

class ForgotPasswordView(generics.GenericAPIView):
    """ارسال کد بازیابی به ایمیل — پاسخ همیشه موفق است تا وجود ایمیل قابل حدس نباشد."""

    serializer_class = ForgotPasswordSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "email"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        email = serializer.validated_data["email"].strip()
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if user is not None:
            ok, err = create_and_send_code(user, PasswordResetCode.PURPOSE_RESET)
            if not ok:
                return Response({"detail": err}, status=status.HTTP_502_BAD_GATEWAY)
        return Response(
            {"detail": "اگر این ایمیل در سیستم ثبت شده باشد، کد بازیابی برای آن ارسال شد."}
        )


class ResetPasswordView(generics.GenericAPIView):
    """تعیین رمز جدید با ایمیل + کد؛ همه توکن‌های قبلی باطل می‌شوند."""

    serializer_class = ResetPasswordSerializer
    permission_classes = [permissions.AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "verify"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = User.objects.filter(
            email__iexact=data["email"].strip(), is_active=True
        ).first()
        if user is not None:
            code_obj = (
                PasswordResetCode.objects.filter(
                    user=user,
                    purpose=PasswordResetCode.PURPOSE_RESET,
                    code=data["code"].strip(),
                )
                .order_by("-created_at")
                .first()
            )
            if code_obj is not None and code_obj.is_active_code:
                code_obj.used_at = timezone.now()
                code_obj.save(update_fields=["used_at"])
                tokens = _apply_new_password(user, data["new_password"])
                return Response({"user": UserSerializer(user).data, **tokens})

        return Response(
            {"detail": "کد نامعتبر یا منقضی شده است."},
            status=status.HTTP_400_BAD_REQUEST,
        )


# ---------- تغییر رمز (کاربر واردشده) ----------

class ChangePasswordView(APIView):
    """گام ۱: تأیید رمز فعلی و ارسال کد به ایمیل."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if not request.user.check_password(
            serializer.validated_data["current_password"]
        ):
            return Response(
                {"current_password": ["رمز عبور فعلی اشتباه است."]},
                status=status.HTTP_400_BAD_REQUEST,
            )
        ok, err = create_and_send_code(request.user, PasswordResetCode.PURPOSE_CHANGE)
        if not ok:
            return Response({"detail": err}, status=status.HTTP_502_BAD_GATEWAY)
        return Response({"detail": "کد تأیید به ایمیل شما ارسال شد."})


class ChangePasswordConfirmView(APIView):
    """گام ۲: تأیید کد و تعیین رمز جدید؛ توکن‌های تازه برمی‌گردد."""

    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordConfirmSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        code_obj = (
            PasswordResetCode.objects.filter(
                user=request.user,
                purpose=PasswordResetCode.PURPOSE_CHANGE,
                code=data["code"].strip(),
            )
            .order_by("-created_at")
            .first()
        )
        if code_obj is None or not code_obj.is_active_code:
            return Response(
                {"detail": "کد نامعتبر یا منقضی شده است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        code_obj.used_at = timezone.now()
        code_obj.save(update_fields=["used_at"])
        tokens = _apply_new_password(request.user, data["new_password"])
        return Response(
            {"user": UserSerializer(request.user).data, **tokens}
        )


# ---------- آواتار (بسته پروفایل) ----------

class MeAvatarView(APIView):
    """آپلود (POST) یا حذف (DELETE) عکس پروفایل.

    عکس با Pillow مربع می‌شود، به ۵۱۲×۵۱۲ کوچک می‌شود و به‌صورت JPEG
    ذخیره می‌شود — پسوند و محتوای اصلی هیچ اهمیتی ندارد.
    """

    permission_classes = [permissions.IsAuthenticated]
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        f = request.FILES.get("avatar")
        if f is None:
            return Response({"avatar": ["فایلی ارسال نشد."]}, status=400)
        if f.size > MAX_AVATAR_MB * 1024 * 1024:
            return Response(
                {"avatar": [f"حجم عکس باید کمتر از {MAX_AVATAR_MB} مگابایت باشد."]},
                status=400,
            )
        try:
            img = Image.open(f)
            img.verify()  # مطمئن می‌شود واقعاً عکس است
            f.seek(0)
            img = Image.open(f).convert("RGB")
        except Exception:
            return Response(
                {"avatar": ["فایل ارسالی عکس معتبری نیست."]}, status=400
            )

        # برش مربع از مرکز + کوچک‌سازی
        w, h = img.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side)).resize(
            (AVATAR_SIZE, AVATAR_SIZE), Image.LANCZOS
        )
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=88)
        buf.seek(0)

        request.user.avatar.delete(save=False)  # فایل قبلی پاک شود
        request.user.avatar.save(
            "avatar.jpg", ContentFile(buf.read()), save=False
        )
        request.user.avatar_ts = timezone.now()
        request.user.save(update_fields=["avatar", "avatar_ts"])
        _broadcast_profile_updated(request.user)
        return Response(UserSerializer(request.user).data)

    def delete(self, request):
        if request.user.avatar:
            request.user.avatar.delete(save=False)
            request.user.avatar = None
            request.user.avatar_ts = None
            request.user.save(update_fields=["avatar", "avatar_ts"])
            _broadcast_profile_updated(request.user)
        return Response(UserSerializer(request.user).data)


class UserAvatarServeView(APIView):
    """سرو عمومی عکس پروفایل.

    تگ <img> نمی‌تواند هدر JWT بفرستد؛ مثل CDNهای عمومی دیگران، آواتار
    بدون توکن سرو می‌شود — نام فایل تصادفی است و فقط با دانستن شناسه
    کاربر قابل دسترسی است (مثل واتساپ/تلگرام که آواتار را از CDN می‌گیرند).
    """

    permission_classes = [permissions.AllowAny]
    authentication_classes = []
    throttle_classes = []

    def get(self, request, user_id):
        user = User.objects.filter(id=user_id).first()
        if user is None or not user.avatar:
            return Response(status=404)
        return FileResponse(
            user.avatar.open("rb"), content_type="image/jpeg"
        )