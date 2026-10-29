from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import RegexValidator

from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import InviteCode

User = get_user_model()


def avatar_url_of(user):
    """نشانی عمومی آواتار — فقط اگر عکس داشته باشد؛ نسخه برای cache-busting."""
    if not user or not user.avatar:
        return None
    v = int(user.avatar_ts.timestamp()) if user.avatar_ts else 0
    return f"/api/auth/users/{user.id}/avatar/?v={v}"


class UserSerializer(serializers.ModelSerializer):
    """نمایش عمومی اطلاعات کاربر."""

    display_name = serializers.CharField(read_only=True)
    bio = serializers.CharField(read_only=True)
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id", "username", "email", "first_name", "last_name", "date_joined",
            "display_name", "bio", "avatar_url",
        )
        read_only_fields = fields

    def get_avatar_url(self, obj):
        return avatar_url_of(obj)


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """ویرایش پروفایل خود — نام نمایشی، بایو و نام کاربری (اختیاری هر کدام).

    نام کاربری شناسه یکتاست: فقط حروف کوچک لاتین، رقم و _ (مثل تلگرام).
    """

    display_name = serializers.CharField(
        required=False, allow_blank=True, max_length=64, label="نام نمایشی", trim_whitespace=True
    )
    bio = serializers.CharField(
        required=False, allow_blank=True, max_length=160, label="درباره من", trim_whitespace=True
    )
    username = serializers.CharField(
        required=False,
        min_length=4,
        max_length=32,
        validators=[
            RegexValidator(
                regex=r"^[a-z0-9_]+$",
                message="نام کاربری فقط حروف کوچک انگلیسی، رقم و _ می‌تواند باشد.",
            ),
            UniqueValidator(
                queryset=User.objects.all(),
                message="این نام کاربری قبلاً ثبت شده است.",
            ),
        ],
    )

    class Meta:
        model = User
        fields = ("display_name", "bio", "username")

    def validate_username(self, value):
        value = value.strip().lower()
        if value in ("me", "admin", "root", "api", "null", "undefined"):
            raise serializers.ValidationError("این نام کاربری قابل استفاده نیست.")
        return value


class RegisterSerializer(serializers.ModelSerializer):
    invite_code = serializers.CharField(write_only=True, label="کد دعوت")
    username = serializers.CharField(
        max_length=150,
        validators=[
            UnicodeUsernameValidator(),
            UniqueValidator(
                queryset=User.objects.all(),
                message="این نام کاربری قبلاً ثبت شده است.",
            ),
        ],
    )
    email = serializers.EmailField(
        validators=[
            UniqueValidator(
                queryset=User.objects.all(),
                message="این ایمیل قبلاً ثبت شده است.",
            )
        ],
    )
    password = serializers.CharField(
        write_only=True, label="رمز عبور", style={"input_type": "password"}
    )
    password2 = serializers.CharField(
        write_only=True, label="تکرار رمز عبور", style={"input_type": "password"}
    )

    class Meta:
        model = User
        fields = ("invite_code", "username", "email", "password", "password2")

    def validate_invite_code(self, value):
        code = value.strip().upper()
        try:
            invite = InviteCode.objects.get(code=code)
        except InviteCode.DoesNotExist:
            raise serializers.ValidationError("کد دعوت نامعتبر است.")
        if not invite.is_valid:
            raise serializers.ValidationError(
                "این کد دعوت معتبر نیست (منقضی شده یا ظرفیتش تکمیل شده است)."
            )
        return code

    def validate(self, attrs):
        if attrs["password"] != attrs["password2"]:
            raise serializers.ValidationError(
                {"password2": "رمز عبور و تکرار آن یکسان نیستند."}
            )
        try:
            validate_password(attrs["password"])
        except DjangoValidationError as e:
            raise serializers.ValidationError({"password": list(e.messages)})
        return attrs

    def create(self, validated_data):
        validated_data.pop("invite_code")
        validated_data.pop("password2")
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user


class LoginSerializer(serializers.Serializer):
    username = serializers.CharField(label="نام کاربری")
    password = serializers.CharField(label="رمز عبور", style={"input_type": "password"})


class ForgotPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField(label="ایمیل")


class ResetPasswordSerializer(serializers.Serializer):
    email = serializers.EmailField(label="ایمیل")
    code = serializers.CharField(max_length=6, min_length=6, label="کد تأیید")
    new_password = serializers.CharField(
        write_only=True, label="رمز عبور جدید", style={"input_type": "password"}
    )
    new_password2 = serializers.CharField(
        write_only=True, label="تکرار رمز عبور جدید", style={"input_type": "password"}
    )

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password2"]:
            raise serializers.ValidationError(
                {"new_password2": ["رمز عبور و تکرار آن یکسان نیستند."]}
            )
        try:
            validate_password(attrs["new_password"])
        except DjangoValidationError as e:
            raise serializers.ValidationError({"new_password": list(e.messages)})
        return attrs


class ChangePasswordRequestSerializer(serializers.Serializer):
    current_password = serializers.CharField(
        write_only=True, label="رمز عبور فعلی", style={"input_type": "password"}
    )


class ChangePasswordConfirmSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=6, min_length=6, label="کد تأیید")
    new_password = serializers.CharField(
        write_only=True, label="رمز عبور جدید", style={"input_type": "password"}
    )
    new_password2 = serializers.CharField(
        write_only=True, label="تکرار رمز عبور جدید", style={"input_type": "password"}
    )

    def validate(self, attrs):
        if attrs["new_password"] != attrs["new_password2"]:
            raise serializers.ValidationError(
                {"new_password2": ["رمز عبور و تکرار آن یکسان نیستند."]}
            )
        try:
            validate_password(attrs["new_password"])
        except DjangoValidationError as e:
            raise serializers.ValidationError({"new_password": list(e.messages)})
        return attrs