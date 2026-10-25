import os
import uuid

from django.conf import settings
from django.db import models


def _attachment_upload_to(instance, filename):
    """مسیر ذخیره پیوست: نام تصادفی + پسوند اصلی — نام اصلی هرگز در مسیر فایل نمی‌نشیند."""
    ext = os.path.splitext(filename)[1].lower()[:10]
    return f"attachments/{uuid.uuid4().hex}{ext}"


class Conversation(models.Model):
    """گفتگو — خصوصی بین دو نفر، یا کادر گفتگوی یک گروه (فاز ۴)."""

    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="Participant",
        related_name="conversations",
        verbose_name="افراد",
    )
    title = models.CharField(
        "عنوان", max_length=128, blank=True, default=""
    )  # برای گروه‌ها از Group.name استفاده می‌شود
    created_at = models.DateTimeField("تاریخ ساخت", auto_now_add=True)
    updated_at = models.DateTimeField(
        "آخرین فعالیت", auto_now=True
    )  # با هر پیام جدید به‌روز می‌شود؛ مبنای مرتب‌سازی لیست گفتگوها

    class Meta:
        verbose_name = "گفتگو"
        verbose_name_plural = "گفتگوها"
        ordering = ["-updated_at"]

    def __str__(self):
        return f"گفتگو {self.id}"


class Group(models.Model):
    """گروه — روی گفتگوی خودش سوار است؛ اعضا همان Participantهای گفتگو (با فیلد role)."""

    conversation = models.OneToOneField(
        Conversation,
        verbose_name="گفتگو",
        on_delete=models.CASCADE,
        related_name="group",
    )
    name = models.CharField("نام گروه", max_length=128)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="سازنده",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="created_groups",
    )
    created_at = models.DateTimeField("تاریخ ساخت", auto_now_add=True)

    class Meta:
        verbose_name = "گروه"
        verbose_name_plural = "گروه‌ها"
        ordering = ["-conversation__updated_at"]

    def __str__(self):
        return self.name


class Message(models.Model):
    conversation = models.ForeignKey(
        Conversation,
        verbose_name="گفتگو",
        on_delete=models.CASCADE,
        related_name="messages",
    )
    sender = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="فرستنده",
        on_delete=models.CASCADE,
        related_name="sent_messages",
    )
    text = models.TextField("متن")
    attachment = models.FileField(
        "پیوست",
        upload_to=_attachment_upload_to,
        null=True,
        blank=True,
        max_length=255,
    )
    attachment_kind = models.CharField(
        "نوع پیوست",
        max_length=10,
        choices=[("image", "تصویر"), ("file", "فایل"), ("voice", "ویس")],
        blank=True,
        default="",
    )
    attachment_name = models.CharField("نام پیوست", max_length=255, blank=True, default="")
    attachment_size = models.PositiveIntegerField("حجم پیوست (بایت)", null=True, blank=True)
    voice_duration = models.PositiveIntegerField("مدت ویس (ثانیه)", null=True, blank=True)
    reply_to = models.ForeignKey(
        "self",
        verbose_name="پاسخ به",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="replies",
    )
    created_at = models.DateTimeField("زمان ارسال", auto_now_add=True)
    edited_at = models.DateTimeField("زمان ویرایش", null=True, blank=True)

    class Meta:
        verbose_name = "پیام"
        verbose_name_plural = "پیام‌ها"
        # جدیدترین اول — صفحه‌بندی تاریخچه با before=<id> انجام می‌شود
        ordering = ["-id"]

    def __str__(self):
        return f"{self.sender} در {self.conversation}: {self.text[:30]}"


GROUP_ROLE_CHOICES = [
    ("owner", "مالک"),
    ("admin", "مدیر"),
    ("member", "عضو"),
]


class Participant(models.Model):
    """عضویت کاربر در گفتگو — نقش فقط برای گفتگوهای گروهی معنا دارد."""

    conversation = models.ForeignKey(
        Conversation,
        verbose_name="گفتگو",
        on_delete=models.CASCADE,
        related_name="members",
    )
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        verbose_name="کاربر",
        on_delete=models.CASCADE,
        related_name="memberships",
    )
    joined_at = models.DateTimeField("زمان عضویت", auto_now_add=True)
    last_read_message = models.ForeignKey(
        Message,
        verbose_name="آخرین پیام خوانده‌شده",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="read_by",
    )
    role = models.CharField(
        "نقش در گروه",
        max_length=10,
        choices=GROUP_ROLE_CHOICES,
        blank=True,
        default="",
    )

    class Meta:
        verbose_name = "عضو گفتگو"
        verbose_name_plural = "اعضای گفتگوها"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "conversation"],
                name="unique_user_conversation",
            )
        ]