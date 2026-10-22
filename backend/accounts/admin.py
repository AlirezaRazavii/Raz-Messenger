from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as DjangoUserAdmin

from .models import InviteCode, PasswordResetCode, User

admin.site.site_header = "مدیریت پیام‌رسان"
admin.site.site_title = "مدیریت پیام‌رسان"
admin.site.index_title = "پنل مدیریت"


@admin.register(User)
class UserAdmin(DjangoUserAdmin):
    list_display = ("username", "email", "is_active", "date_joined", "used_invite")
    search_fields = ("username", "email")
    list_filter = ("is_active", "date_joined")
    fieldsets = DjangoUserAdmin.fieldsets + (
        ("اطلاعات پیام‌رسان", {"fields": ("used_invite",)}),
    )


class InviteCodeForm(forms.ModelForm):
    class Meta:
        model = InviteCode
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["code"].required = False
        self.fields["code"].help_text = "خالی بگذارید تا خودکار ساخته شود."

    def clean_code(self):
        code = self.cleaned_data.get("code")
        if not code:
            while True:
                candidate = InviteCode.generate()
                if not InviteCode.objects.filter(code=candidate).exists():
                    return candidate
        return code


@admin.register(InviteCode)
class InviteCodeAdmin(admin.ModelAdmin):
    form = InviteCodeForm
    list_display = (
        "code",
        "max_uses",
        "used_count",
        "remaining_display",
        "expires_at",
        "is_active",
        "is_valid_display",
        "created_at",
    )
    search_fields = ("code",)
    list_filter = ("is_active",)
    readonly_fields = ("used_count", "created_at")
    actions = ("deactivate_codes", "activate_codes")

    @admin.display(description="ظرفیت باقی‌مانده")
    def remaining_display(self, obj):
        return max(obj.max_uses - obj.used_count, 0)

    @admin.display(boolean=True, description="معتبر")
    def is_valid_display(self, obj):
        return obj.is_valid

    def save_model(self, request, obj, form, change):
        if not change and obj.created_by_id is None:
            obj.created_by = request.user
        super().save_model(request, obj, form, change)

    @admin.action(description="غیرفعال کردن کدهای انتخاب‌شده")
    def deactivate_codes(self, request, queryset):
        queryset.update(is_active=False)

    @admin.action(description="فعال کردن کدهای انتخاب‌شده")
    def activate_codes(self, request, queryset):
        queryset.update(is_active=True)
        
@admin.register(PasswordResetCode)
class PasswordResetCodeAdmin(admin.ModelAdmin):
    list_display = ("user", "purpose", "created_at", "expires_at", "used_at", "is_active_display")
    search_fields = ("user__username", "user__email")
    list_filter = ("purpose",)
    readonly_fields = ("user", "purpose", "code", "created_at", "expires_at", "used_at")

    @admin.display(boolean=True, description="فعال")
    def is_active_display(self, obj):
        return obj.is_active_code

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False