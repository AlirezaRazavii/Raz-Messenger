from django.conf import settings
from django.db import models


class Conversation(models.Model):
    """گفتگو — فعلاً خصوصی بین دو نفر؛ گروه‌ها در فاز ۴ روی همین مدل ساخته می‌شوند."""

    participants = models.ManyToManyField(
        settings.AUTH_USER_MODEL,
        through="Participant",
        related_name="conversations",
        verbose_name="افراد",
    )
    title = models.CharField(
        "عنوان", max_length=128, blank=True, default=""
    )  # فقط برای گروه‌ها در فاز ۴
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
    created_at = models.DateTimeField("زمان ارسال", auto_now_add=True)
    edited_at = models.DateTimeField("زمان ویرایش", null=True, blank=True)

    class Meta:
        verbose_name = "پیام"
        verbose_name_plural = "پیام‌ها"
        # جدیدترین اول — صفحه‌بندی تاریخچه با before=<id> انجام می‌شود
        ordering = ["-id"]

    def __str__(self):
        return f"{self.sender} در {self.conversation}: {self.text[:30]}"


class Participant(models.Model):
    """عضویت کاربر در گفتگو — last_read_message مبنای شمارش نخوانده‌ها و تیک خوانده‌شدن است."""

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

    class Meta:
        verbose_name = "عضو گفتگو"
        verbose_name_plural = "اعضای گفتگوها"
        constraints = [
            models.UniqueConstraint(
                fields=["user", "conversation"],
                name="unique_user_conversation",
            )
        ]