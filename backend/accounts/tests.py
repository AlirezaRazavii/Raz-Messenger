import re
from datetime import timedelta

from django.contrib.auth import get_user_model
from django.core import mail
from django.core.cache import cache
from django.test import TestCase
from django.urls import reverse
from django.utils import timezone

from rest_framework.test import APIClient

from .models import InviteCode

User = get_user_model()

PASSWORD = "StrongPass@123"
NEW_PASSWORD = "NewStrong@456"


class BaseAPITest(TestCase):
    """پایه مشترک: کلاینت API + پاک‌سازی کش (تا شمارنده throttle بین تست‌ها اثر نگذارد)."""

    def setUp(self):
        self.client = APIClient()
        cache.clear()

    def auth(self, access):
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")

    def login_and_get_tokens(self, username="ali", password=PASSWORD):
        resp = self.client.post(
            reverse("accounts:login"),
            {"username": username, "password": password},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        return resp.data["access"], resp.data["refresh"]


class RegistrationTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        self.invite = InviteCode.objects.create(code="TESTCODE1234", max_uses=3)

    def register(self, **overrides):
        payload = {
            "invite_code": self.invite.code,
            "username": "ali",
            "email": "ali@example.com",
            "password": PASSWORD,
            "password2": PASSWORD,
        }
        payload.update(overrides)
        return self.client.post(reverse("accounts:register"), payload, format="json")

    def test_register_success(self):
        resp = self.register()
        self.assertEqual(resp.status_code, 201)
        self.assertTrue(User.objects.filter(username="ali").exists())
        self.assertIn("access", resp.data)
        self.assertIn("refresh", resp.data)
        self.invite.refresh_from_db()
        self.assertEqual(self.invite.used_count, 1)

    def test_register_invalid_code(self):
        resp = self.register(invite_code="NOSUCHCODE99")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("invite_code", resp.data)
        self.assertFalse(User.objects.filter(username="ali").exists())

    def test_register_exhausted_code(self):
        self.invite.used_count = self.invite.max_uses
        self.invite.save()
        self.assertEqual(self.register().status_code, 400)

    def test_register_expired_code(self):
        self.invite.expires_at = timezone.now() - timedelta(minutes=1)
        self.invite.save()
        self.assertEqual(self.register().status_code, 400)

    def test_register_deactivated_code(self):
        self.invite.is_active = False
        self.invite.save()
        self.assertEqual(self.register().status_code, 400)

    def test_code_capacity_enforced(self):
        for i in range(3):
            resp = self.register(username=f"user{i}", email=f"user{i}@example.com")
            self.assertEqual(resp.status_code, 201, f"کاربر {i} ثبت نشد")
        resp = self.register(username="user3", email="user3@example.com")
        self.assertEqual(resp.status_code, 400)

    def test_register_duplicate_username(self):
        User.objects.create_user(username="ali", email="x@example.com", password=PASSWORD)
        resp = self.register()
        self.assertEqual(resp.status_code, 400)
        self.assertIn("username", resp.data)

    def test_register_duplicate_email(self):
        User.objects.create_user(username="other", email="ali@example.com", password=PASSWORD)
        resp = self.register()
        self.assertEqual(resp.status_code, 400)
        self.assertIn("email", resp.data)

    def test_register_password_mismatch(self):
        resp = self.register(password2="Different@123")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("password2", resp.data)

    def test_register_weak_password(self):
        resp = self.register(password="123", password2="123")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("password", resp.data)


class LoginTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="ali", email="ali@example.com", password=PASSWORD
        )

    def login(self, username="ali", password=PASSWORD):
        return self.client.post(
            reverse("accounts:login"),
            {"username": username, "password": password},
            format="json",
        )

    def test_login_success(self):
        resp = self.login()
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.data)
        self.assertEqual(resp.data["user"]["username"], "ali")

    def test_login_wrong_password(self):
        self.assertEqual(self.login(password="Wrong@00000").status_code, 401)

    def test_login_unknown_user(self):
        self.assertEqual(self.login(username="ghost").status_code, 401)

    def test_lockout_after_five_failures(self):
        for i in range(4):
            self.assertEqual(self.login(password="Wrong@00000").status_code, 401)
        # پنجمین تلاش: قفل
        self.assertEqual(self.login(password="Wrong@00000").status_code, 403)
        # حتی رمز درست هم تا پایان قفل کار نمی‌کند
        self.assertEqual(self.login().status_code, 403)
        # رفع قفل (مثل کاری که ادمین می‌کند)
        self.user.refresh_from_db()
        self.user.locked_until = None
        self.user.failed_login_attempts = 0
        self.user.save()
        self.assertEqual(self.login().status_code, 200)

    def test_me_requires_authentication(self):
        self.assertEqual(self.client.get(reverse("accounts:me")).status_code, 401)

    def test_me_returns_user(self):
        access, _ = self.login_and_get_tokens()
        self.auth(access)
        resp = self.client.get(reverse("accounts:me"))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data["username"], "ali")


class PasswordResetTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="ali", email="ali@example.com", password=PASSWORD
        )

    def forgot(self, email="ali@example.com"):
        return self.client.post(
            reverse("accounts:forgot_password"), {"email": email}, format="json"
        )

    def code_from_last_email(self):
        self.assertGreater(len(mail.outbox), 0)
        match = re.search(r"(\d{6})", mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def reset_payload(self, code):
        return {
            "email": "ali@example.com",
            "code": code,
            "new_password": NEW_PASSWORD,
            "new_password2": NEW_PASSWORD,
        }

    def test_forgot_sends_email(self):
        resp = self.forgot()
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("بازیابی", mail.outbox[0].subject)

    def test_forgot_unknown_email_is_silent(self):
        resp = self.forgot(email="ghost@example.com")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(len(mail.outbox), 0)

    def test_reset_success(self):
        self.forgot()
        code = self.code_from_last_email()
        resp = self.client.post(
            reverse("accounts:reset_password"), self.reset_payload(code), format="json"
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        self.assertFalse(self.user.check_password(PASSWORD))

    def test_reset_wrong_code(self):
        self.forgot()
        code = self.code_from_last_email()
        wrong = "000000" if code != "000000" else "111111"
        resp = self.client.post(
            reverse("accounts:reset_password"), self.reset_payload(wrong), format="json"
        )
        self.assertEqual(resp.status_code, 400)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(PASSWORD))

    def test_reset_code_is_single_use(self):
        self.forgot()
        code = self.code_from_last_email()
        first = self.client.post(
            reverse("accounts:reset_password"), self.reset_payload(code), format="json"
        )
        self.assertEqual(first.status_code, 200)
        second = self.client.post(
            reverse("accounts:reset_password"), self.reset_payload(code), format="json"
        )
        self.assertEqual(second.status_code, 400)

    def test_old_refresh_token_blacklisted_after_reset(self):
        _, old_refresh = self.login_and_get_tokens()
        self.forgot()
        code = self.code_from_last_email()
        self.client.post(
            reverse("accounts:reset_password"), self.reset_payload(code), format="json"
        )
        resp = self.client.post(
            reverse("accounts:token_refresh"), {"refresh": old_refresh}, format="json"
        )
        self.assertEqual(resp.status_code, 401)


class ChangePasswordTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        self.user = User.objects.create_user(
            username="ali", email="ali@example.com", password=PASSWORD
        )

    def code_from_last_email(self):
        self.assertGreater(len(mail.outbox), 0)
        match = re.search(r"(\d{6})", mail.outbox[-1].body)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_change_password_flow(self):
        access, _ = self.login_and_get_tokens()
        self.auth(access)

        # رمز فعلی غلط
        resp = self.client.post(
            reverse("accounts:change_password"),
            {"current_password": "Wrong@00000"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)

        # رمز فعلی درست → کد ایمیلی
        resp = self.client.post(
            reverse("accounts:change_password"),
            {"current_password": PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        code = self.code_from_last_email()

        # تأیید کد و رمز جدید
        resp = self.client.post(
            reverse("accounts:change_password_confirm"),
            {"code": code, "new_password": NEW_PASSWORD, "new_password2": NEW_PASSWORD},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIn("access", resp.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))


class LogoutTests(BaseAPITest):
    def setUp(self):
        super().setUp()
        User.objects.create_user(username="ali", email="ali@example.com", password=PASSWORD)

    def test_logout_blacklists_refresh(self):
        access, refresh = self.login_and_get_tokens()
        self.auth(access)
        resp = self.client.post(reverse("accounts:logout"), {"refresh": refresh}, format="json")
        self.assertEqual(resp.status_code, 200)
        resp = self.client.post(
            reverse("accounts:token_refresh"), {"refresh": refresh}, format="json"
        )
        self.assertEqual(resp.status_code, 401)