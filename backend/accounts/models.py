import os
import secrets
import string
import uuid

from django.contrib.auth.models import AbstractUser
from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone


def _avatar_upload_to(instance, filename):
    """مسیر ذخیره آواتار: نام تصادفی — همیشه JPEG چون با Pillow نرمال می‌شود."""
    return f"avatars/{uuid.uuid4().hex}.jpg"


class User(AbstractUser):
    """کاربر پیام‌رسان — ورود فقط با نام کاربری و رمز، ثبت‌نام فقط با کد دعوت."""

    email = models.EmailField("ایمیل", unique=True)
    used_invite = models.ForeignKey(
        "accounts.InviteCode",
        verbose_name="کد دعوت استفاده‌شده",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="registered_users",
    )
    failed_login_attempts = models.PositiveIntegerField("تلاش‌های ناموفق ورود", default=0)
    locked_until = models.DateTimeField("قفل تا", null=True, blank=True)

    class Meta:
        verbose_name = "کاربر"
        verbose_name_plural = "کاربرها"

    def __str__(self):
        return self.username


class InviteCode(models.Model):
    """کد دعوت — فقط ادمین می‌سازد؛ بدون کد معتبر هیچ‌کس نمی‌تواند ثبت‌نام کند."""

    code = models.CharField(
        "کد",
        max_length=16,
        unique=True,
        validators=[
            RegexValidator(
                regex=r"^[A-Z0-9]{8,16}$",
                message="کد فقط شامل حروف بزرگ انگلیسی و رقم، بین ۸ تا ۱۶ کاراکتر است.",
            )
        ],
    )
    max_uses = models.PositiveIntegerField("حداکثر استفاده", default=1)
    used_count = models.PositiveIntegerField("تعداد استفاده‌شده", default=0)
    expires_at = models.DateTimeField("تاریخ انقضا", null=True, blank=True)
    is_active = models.BooleanField("فعال", default=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="سازنده",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_invites",
    )
    created_at = models.DateTimeField("تاریخ ساخت", auto_now_add=True)

    class Meta:
        verbose_name = "کد دعوت"
        verbose_name_plural = "کدهای دعوت"
        ordering = ["-created_at"]

    def __str__(self):
        return self.code

    @property
    def is_valid(self):
        """فعال باشد، منقضی نشده باشد و ظرفیت آزاد داشته باشد."""
        if not self.is_active:
            return False
        if self.expires_at is not None and timezone.now() >= self.expires_at:
            return False
        return self.used_count < self.max_uses

    @staticmethod
    def generate(length=12):
        """ساخت کد تصادفی امن از حروف بزرگ و رقم."""
        alphabet = string.ascii_uppercase + string.digits
        return "".join(secrets.choice(alphabet) for _ in range(length))
    
    
class PasswordResetCode(models.Model):
    """کد یک‌بارمصرف تأیید ایمیل برای بازیابی یا تغییر رمز عبور."""

    PURPOSE_RESET = "reset"
    PURPOSE_CHANGE = "change"
    PURPOSE_CHOICES = [
        (PURPOSE_RESET, "بازیابی رمز"),
        (PURPOSE_CHANGE, "تغییر رمز"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="کاربر",
        on_delete=models.CASCADE,
        related_name="email_codes",
    )
    purpose = models.CharField("نوع", max_length=10, choices=PURPOSE_CHOICES)
    code = models.CharField("کد", max_length=6)
    created_at = models.DateTimeField("تاریخ ساخت", auto_now_add=True)
    expires_at = models.DateTimeField("انقضا")
    used_at = models.DateTimeField("استفاده‌شده", null=True, blank=True)

    class Meta:
        verbose_name = "کد تأیید ایمیل"
        verbose_name_plural = "کدهای تأیید ایمیل"
        ordering = ["-created_at"]

    def __str__(self):
        return f"{self.user} — {self.get_purpose_display()}"

    @property
    def is_active_code(self):
        return self.used_at is None and timezone.now() < self.expires_at

    @staticmethod
    def generate_code():
        """کد ۶ رقمی تصادفی امن."""
        return "".join(secrets.choice(string.digits) for _ in range(6))