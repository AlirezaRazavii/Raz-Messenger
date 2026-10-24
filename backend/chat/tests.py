import shutil
import tempfile

from django.contrib.auth import get_user_model
from rest_framework.test import APITestCase, APIClient
from rest_framework_simplejwt.tokens import RefreshToken
from django.core.files.storage import default_storage
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings


from .models import Conversation, Participant, Message

User = get_user_model()

PASSWORD = "Raz-Test-123"


def make_user(username):
    return User.objects.create_user(
        username=username,
        password=PASSWORD,
        email=f"{username}@example.test",
    )


class ChatAPITestBase(APITestCase):
    def setUp(self):
        self.alice = make_user("alice_t")
        self.bob = make_user("bob_t")
        self.carol = make_user("carol_t")

    def auth(self, user):
        self.client.credentials(
            HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}"
        )

    def create_conversation(self, as_user, with_username):
        self.auth(as_user)
        return self.client.post(
            "/api/chat/conversations/", {"username": with_username}, format="json"
        )


class ConversationAPITests(ChatAPITestBase):
    def test_list_requires_authentication(self):
        response = self.client.get("/api/chat/conversations/")
        self.assertEqual(response.status_code, 401)

    def test_empty_list(self):
        self.auth(self.bob)
        response = self.client.get("/api/chat/conversations/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_conversation_creation(self):
        response = self.create_conversation(self.bob, "alice_t")
        self.assertEqual(response.status_code, 201)
        body = response.json()
        self.assertEqual(body["other_user"]["username"], "alice_t")
        conversation = Conversation.objects.get(id=body["id"])
        self.assertEqual(conversation.participants.count(), 2)

    def test_duplicate_returns_the_same_conversation(self):
        first = self.create_conversation(self.bob, "alice_t")
        second = self.create_conversation(self.bob, "alice_t")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.json()["id"], second.json()["id"])

    def test_chat_with_oneself(self):
        response = self.create_conversation(self.bob, "bob_t")
        self.assertEqual(response.status_code, 400)

    def test_unknown_username(self):
        response = self.create_conversation(self.bob, "unknown_user")
        self.assertEqual(response.status_code, 404)

    def test_user_search(self):
        self.auth(self.bob)
        response = self.client.get("/api/chat/users/?q=ali")
        self.assertEqual(response.status_code, 200)
        usernames = [u["username"] for u in response.json()]
        self.assertIn("alice_t", usernames)
        self.assertNotIn("bob_t", usernames)
        response = self.client.get("/api/chat/users/")
        self.assertEqual(response.json(), [])


class MessageAPITests(ChatAPITestBase):
    def setUp(self):
        super().setUp()
        response = self.create_conversation(self.bob, "alice_t")
        self.conversation_id = response.json()["id"]

    def send(self, text):
        return self.client.post(
            f"/api/chat/conversations/{self.conversation_id}/messages/",
            {"text": text},
            format="json",
        )

    def history(self, query=""):
        return self.client.get(
            f"/api/chat/conversations/{self.conversation_id}/messages/{query}"
        )

    def test_sending_and_history(self):
        first = self.send("پیام اول")
        self.assertEqual(first.status_code, 201)
        self.assertEqual(first.json()["text"], "پیام اول")
        self.assertEqual(first.json()["sender"]["username"], "bob_t")
        self.send("پیام دوم")

        response = self.history()
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertFalse(body["has_more"])
        self.assertEqual(
            [m["text"] for m in body["results"]], ["پیام دوم", "پیام اول"]
        )

    def test_pagination_with_before(self):
        sent_ids = [self.send(f"پیام {i}").json()["id"] for i in range(1, 6)]

        response = self.history("?limit=2")
        body = response.json()
        self.assertEqual([m["id"] for m in body["results"]], sent_ids[-1:-3:-1])
        self.assertTrue(body["has_more"])

        response = self.history(f"?limit=2&before={sent_ids[3]}")
        body = response.json()
        self.assertEqual([m["id"] for m in body["results"]], [sent_ids[2], sent_ids[1]])
        self.assertTrue(body["has_more"])

        response = self.history(f"?limit=2&before={sent_ids[1]}")
        body = response.json()
        self.assertEqual([m["id"] for m in body["results"]], [sent_ids[0]])
        self.assertFalse(body["has_more"])

    def test_empty_text(self):
        response = self.send("   ")
        self.assertEqual(response.status_code, 400)

    def test_outsider_access(self):
        self.auth(self.carol)
        response = self.client.get(
            f"/api/chat/conversations/{self.conversation_id}/messages/"
        )
        self.assertEqual(response.status_code, 404)
        response = self.client.post(
            f"/api/chat/conversations/{self.conversation_id}/messages/",
            {"text": "نفوذ"},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_edit_own_message(self):
        message_id = self.send("قبل از ویرایش").json()["id"]
        response = self.client.patch(
            f"/api/chat/messages/{message_id}/", {"text": "بعد از ویرایش"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body["text"], "بعد از ویرایش")
        self.assertIsNotNone(body["edited_at"])

    def test_edit_others_message(self):
        message_id = self.send("پیام باب").json()["id"]
        self.auth(self.alice)
        response = self.client.patch(
            f"/api/chat/messages/{message_id}/", {"text": "جعل"}, format="json"
        )
        self.assertEqual(response.status_code, 403)

    def test_delete_own_message(self):
        message_id = self.send("موقت").json()["id"]
        response = self.client.delete(f"/api/chat/messages/{message_id}/")
        self.assertEqual(response.status_code, 204)
        body = self.history().json()
        self.assertEqual(body["results"], [])
        self.assertFalse(body["has_more"])

    def test_delete_others_message(self):
        message_id = self.send("پیام باب").json()["id"]
        self.auth(self.alice)
        response = self.client.delete(f"/api/chat/messages/{message_id}/")
        self.assertEqual(response.status_code, 403)
        self.auth(self.bob)
        self.assertEqual(len(self.history().json()["results"]), 1)


class ConversationListTests(ChatAPITestBase):
    def test_unread_count_and_read(self):
        conversation_id = self.create_conversation(self.alice, "bob_t").json()["id"]
        message_ids = []
        for text in ["سلام", "خوبی؟"]:
            response = self.client.post(
                f"/api/chat/conversations/{conversation_id}/messages/",
                {"text": text},
                format="json",
            )
            message_ids.append(response.json()["id"])

        # از زاویه باب: دو نخوانده، آخرین پیام دومی است
        self.auth(self.bob)
        response = self.client.get("/api/chat/conversations/")
        item = response.json()[0]
        self.assertEqual(item["unread_count"], 2)
        self.assertEqual(item["last_message"]["text"], "خوبی؟")
        self.assertEqual(item["other_user"]["username"], "alice_t")

        # باب تا آخرین پیام می‌خواند
        Participant.objects.filter(
            conversation_id=conversation_id, user=self.bob
        ).update(last_read_message_id=message_ids[-1])
        response = self.client.get("/api/chat/conversations/")
        self.assertEqual(response.json()[0]["unread_count"], 0)

    def test_ordering_by_latest_activity(self):
        with_alice = self.create_conversation(self.bob, "alice_t").json()["id"]
        with_carol = self.create_conversation(self.bob, "carol_t").json()["id"]

        self.client.post(
            f"/api/chat/conversations/{with_alice}/messages/",
            {"text": "پیام تازه"},
            format="json",
        )
        response = self.client.get("/api/chat/conversations/")
        ids = [c["id"] for c in response.json()]
        self.assertEqual(ids[0], with_alice)
        self.assertEqual(ids[1], with_carol)
        
class MessageActionsTests(APITestCase):
    """تست‌های پاسخ/فوروارد/کپی — قسمت ۲-و"""

    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user(
            username="alice", email="alice@example.test", password="Passw0rd!"
        )
        self.bob = User.objects.create_user(
            username="bob", email="bob@example.test", password="Passw0rd!"
        )
        self.carol = User.objects.create_user(
            username="carol", email="carol@example.test", password="Passw0rd!"
        )
        self.conv_ab = Conversation.objects.create()
        Participant.objects.create(conversation=self.conv_ab, user=self.alice)
        Participant.objects.create(conversation=self.conv_ab, user=self.bob)
        self.conv_ac = Conversation.objects.create()
        Participant.objects.create(conversation=self.conv_ac, user=self.alice)
        Participant.objects.create(conversation=self.conv_ac, user=self.carol)
        self.client = APIClient()

    def test_reply_creates_message_with_reply_info(self):
        self.client.force_authenticate(self.alice)
        first = Message.objects.create(conversation=self.conv_ab, sender=self.bob, text="سلام")
        res = self.client.post(
            f"/api/chat/conversations/{self.conv_ab.id}/messages/",
            {"text": "درود", "reply_to": first.id},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["reply_to"]["id"], first.id)
        self.assertEqual(res.data["reply_to"]["sender_username"], "bob")
        self.assertEqual(res.data["reply_to"]["text"], "سلام")

    def test_reply_from_other_conversation_rejected(self):
        self.client.force_authenticate(self.alice)
        foreign = Message.objects.create(conversation=self.conv_ac, sender=self.carol, text="خارجی")
        res = self.client.post(
            f"/api/chat/conversations/{self.conv_ab.id}/messages/",
            {"text": "درود", "reply_to": foreign.id},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_reply_still_requires_text(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(
            f"/api/chat/conversations/{self.conv_ab.id}/messages/",
            {"reply_to": 123},
            format="json",
        )
        self.assertEqual(res.status_code, 400)

    def test_history_includes_reply_to(self):
        self.client.force_authenticate(self.alice)
        first = Message.objects.create(conversation=self.conv_ab, sender=self.bob, text="پیام اول")
        Message.objects.create(conversation=self.conv_ab, sender=self.alice, text="پاسخ", reply_to=first)
        res = self.client.get(f"/api/chat/conversations/{self.conv_ab.id}/messages/")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["results"][0]["reply_to"]["id"], first.id)

    def test_forward_to_my_conversation(self):
        self.client.force_authenticate(self.alice)
        src = Message.objects.create(conversation=self.conv_ab, sender=self.bob, text="قابل فوروارد")
        res = self.client.post(
            f"/api/chat/messages/{src.id}/forward/",
            {"conversation_id": self.conv_ac.id},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["conversation"], self.conv_ac.id)
        self.assertEqual(res.data["text"], "قابل فوروارد")
        self.assertEqual(res.data["sender"]["id"], self.alice.id)
        self.assertIsNone(res.data["reply_to"])

    def test_forward_to_foreign_conversation_fails(self):
        # bob عضو گفتگوی alice-carol نیست
        self.client.force_authenticate(self.bob)
        src = Message.objects.create(conversation=self.conv_ab, sender=self.alice, text="متن")
        res = self.client.post(
            f"/api/chat/messages/{src.id}/forward/",
            {"conversation_id": self.conv_ac.id},
            format="json",
        )
        self.assertEqual(res.status_code, 404)

    def test_forward_from_foreign_conversation_fails(self):
        # carol عضو گفتگوی alice-bob نیست؛ نباید بتواند پیام آن گفتگو را ببیند
        self.client.force_authenticate(self.carol)
        src = Message.objects.create(conversation=self.conv_ab, sender=self.alice, text="متن")
        res = self.client.post(
            f"/api/chat/messages/{src.id}/forward/",
            {"conversation_id": self.conv_ac.id},
            format="json",
        )
        self.assertEqual(res.status_code, 404)
        
class MessageMediaTests(APITestCase):
    """تست‌های پیوست (عکس/فایل/ویس) — فاز ۳-آ"""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        # فایل‌های تست نباید در media واقعی پروژه بنشینند
        cls._tmp_media = tempfile.mkdtemp(prefix="raz_media_tests_")
        cls._media_override = override_settings(MEDIA_ROOT=cls._tmp_media)
        cls._media_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._media_override.disable()
        shutil.rmtree(cls._tmp_media, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        User = get_user_model()
        self.alice = User.objects.create_user(
            username="alice", email="alice@example.test", password="Passw0rd!"
        )
        self.bob = User.objects.create_user(
            username="bob", email="bob@example.test", password="Passw0rd!"
        )
        self.conv = Conversation.objects.create()
        Participant.objects.create(conversation=self.conv, user=self.alice)
        Participant.objects.create(conversation=self.conv, user=self.bob)
        self.client = APIClient()
        self.url = f"/api/chat/conversations/{self.conv.id}/messages/"

    def _jpeg(self, name="pic.jpg", size=32):
        return SimpleUploadedFile(
            name, b"\xff\xd8\xff\xe0" + b"x" * size, content_type="image/jpeg"
        )

    def test_send_image_without_text(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {"attachment": self._jpeg()}, format="multipart")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["attachment_kind"], "image")
        self.assertEqual(res.data["attachment_name"], "pic.jpg")
        self.assertEqual(res.data["attachment_size"], 36)  # ۴ بایت سرصفحه + ۳۲ بایت
        self.assertEqual(res.data["text"], "")

    def test_send_requires_text_or_attachment(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_upload_size_limit(self):
        self.client.force_authenticate(self.alice)
        with override_settings(CHAT_MAX_UPLOAD_MB=0.001):  # حدود ۱ کیلوبایت
            res = self.client.post(
                self.url, {"attachment": self._jpeg(size=2048)}, format="multipart"
            )
        self.assertEqual(res.status_code, 400)
        self.assertIn("attachment", res.data)

    def test_voice_message(self):
        self.client.force_authenticate(self.alice)
        voice = SimpleUploadedFile("voice.webm", b"WEBMVOICE", content_type="audio/webm")
        res = self.client.post(
            self.url,
            {"attachment": voice, "kind": "voice", "duration": "12"},
            format="multipart",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["attachment_kind"], "voice")
        self.assertEqual(res.data["voice_duration"], 12)

    def test_attachment_download_as_member(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {"attachment": self._jpeg()}, format="multipart")
        res2 = self.client.get(f"/api/chat/messages/{res.data['id']}/attachment/")
        self.assertEqual(res2.status_code, 200)
        self.assertIn("image/jpeg", res2["Content-Type"])

    def test_attachment_download_denied_for_stranger(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {"attachment": self._jpeg()}, format="multipart")
        msg_id = res.data["id"]
        User = get_user_model()
        stranger = User.objects.create_user(
            username="eve", email="eve@example.test", password="Passw0rd!"
        )
        self.client.force_authenticate(stranger)
        res2 = self.client.get(f"/api/chat/messages/{msg_id}/attachment/")
        self.assertEqual(res2.status_code, 404)

    def test_forward_copies_attachment(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {"attachment": self._jpeg()}, format="multipart")
        msg_id = res.data["id"]

        User = get_user_model()
        carol = User.objects.create_user(
            username="carol", email="carol@example.test", password="Passw0rd!"
        )
        conv2 = Conversation.objects.create()
        Participant.objects.create(conversation=conv2, user=self.alice)
        Participant.objects.create(conversation=conv2, user=carol)

        res2 = self.client.post(
            f"/api/chat/messages/{msg_id}/forward/",
            {"conversation_id": conv2.id},
            format="json",
        )
        self.assertEqual(res2.status_code, 201)
        self.assertEqual(res2.data["attachment_kind"], "image")
        self.assertEqual(res2.data["attachment_name"], "pic.jpg")
        new_msg = Message.objects.get(id=res2.data["id"])
        self.assertTrue(default_storage.exists(new_msg.attachment.name))
        # فایل جدیدِ مستقل — نه ارجاع به فایل پیام مبدأ
        self.assertNotEqual(
            new_msg.attachment.name, Message.objects.get(id=msg_id).attachment.name
        )

    def test_delete_message_removes_attachment_file(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(self.url, {"attachment": self._jpeg()}, format="multipart")
        msg_id = res.data["id"]
        path = Message.objects.get(id=msg_id).attachment.name
        self.assertTrue(default_storage.exists(path))

        res2 = self.client.delete(f"/api/chat/messages/{msg_id}/")
        self.assertEqual(res2.status_code, 204)
        self.assertFalse(default_storage.exists(path))