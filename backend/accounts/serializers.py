from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError

from rest_framework import serializers
from rest_framework.validators import UniqueValidator

from .models import InviteCode

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    """نمایش عمومی اطلاعات کاربر."""

    class Meta:
        model = User
        fields = ("id", "username", "email", "first_name", "last_name", "date_joined")
        read_only_fields = fields


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