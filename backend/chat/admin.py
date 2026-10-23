from django.contrib import admin

from .models import Conversation, Message, Participant


class ParticipantInline(admin.TabularInline):
    model = Participant
    extra = 0
    fields = ("user", "joined_at", "last_read_message")
    readonly_fields = ("joined_at",)

    def has_add_permission(self, request, obj=None):
        return False


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    list_display = ("id", "title", "created_at", "updated_at")
    inlines = [ParticipantInline]

    def has_add_permission(self, request):
        return False  # ساخت گفتگو فقط از داخل اپ؛ ساخت دستی می‌تواند نامعتبر باشد


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    list_display = ("id", "conversation", "sender", "short_text", "created_at", "edited_at")
    list_filter = ("conversation",)
    search_fields = ("text", "sender__username", "sender__email")
    readonly_fields = ("conversation", "sender", "text", "created_at", "edited_at")

    @admin.display(description="متن")
    def short_text(self, obj):
        return obj.text[:50]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        # حذف پیام از ادمین هم ممکن است؛ ولی به‌جای آن از اپ یا دستورات پاکسازی فاز ۶ استفاده کنید
        return False