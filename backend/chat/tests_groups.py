"""تست‌های فاز ۴-آ — گروه‌ها. فایل مستقل تا با تست‌های فاز ۲ تداخل نکند."""

from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework.test import APITestCase

from .models import Conversation, Group, Participant

User = get_user_model()


def make_user(username):
    return User.objects.create_user(
        username=username, email=f"{username}@test.local", password="Passw0rd!"
    )


class GroupTestsBase(APITestCase):
    def setUp(self):
        self.owner = make_user("gh-owner")
        self.alice = make_user("gh-alice")
        self.bob = make_user("gh-bob")
        self.outsider = make_user("gh-outsider")
        self.client.force_authenticate(self.owner)

    def create_group(self, name="گروه تست", members=()):
        return self.client.post(
            reverse("chat:group-list"),
            {"name": name, "members": list(members)},
            format="json",
        )


class GroupCreateTests(GroupTestsBase):
    def test_create_group_with_members(self):
        res = self.create_group(members=[self.alice.username, self.bob.username])
        self.assertEqual(res.status_code, 201)
        group = Group.objects.get(id=res.data["id"])
        self.assertEqual(res.data["member_count"], 3)
        roles = {
            p.user_id: p.role
            for p in Participant.objects.filter(conversation=group.conversation)
        }
        self.assertEqual(roles[self.owner.id], "owner")
        self.assertEqual(roles[self.alice.id], "member")
        self.assertEqual(roles[self.bob.id], "member")
        self.assertEqual(len(res.data["members"]), 3)

    def test_create_group_unknown_member(self):
        res = self.create_group(members=["nobody"])
        self.assertEqual(res.status_code, 404)

    def test_create_group_empty_name(self):
        res = self.create_group(name="   ")
        self.assertEqual(res.status_code, 400)

    def test_group_list_shows_only_my_groups(self):
        self.create_group(members=[self.alice.username])
        self.client.force_authenticate(self.outsider)
        res = self.client.get(reverse("chat:group-list"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, [])


class GroupAccessTests(GroupTestsBase):
    def setUp(self):
        super().setUp()
        res = self.create_group(members=[self.alice.username])
        self.group_id = res.data["id"]
        self.conv_id = res.data["conversation_id"]

    def test_non_member_cannot_see_group(self):
        self.client.force_authenticate(self.outsider)
        res = self.client.get(reverse("chat:group-detail", args=[self.group_id]))
        self.assertEqual(res.status_code, 404)

    def test_member_can_send_message_to_group(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(
            reverse("chat:message-list", args=[self.conv_id]), {"text": "سلام گروه"}
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["sender"]["id"], self.alice.id)

    def test_outsider_cannot_send_message_to_group(self):
        self.client.force_authenticate(self.outsider)
        res = self.client.post(
            reverse("chat:message-list", args=[self.conv_id]), {"text": "مخفی"}
        )
        self.assertEqual(res.status_code, 404)


class GroupMemberManagementTests(GroupTestsBase):
    def setUp(self):
        super().setUp()
        res = self.create_group(members=[self.alice.username])
        self.group_id = res.data["id"]
        self.conv_id = res.data["conversation_id"]

    def test_member_cannot_add_member(self):
        self.client.force_authenticate(self.alice)
        res = self.client.post(
            reverse("chat:group-members", args=[self.group_id]),
            {"username": self.bob.username},
            format="json",
        )
        self.assertEqual(res.status_code, 403)

    def test_owner_adds_and_removes_member(self):
        res = self.client.post(
            reverse("chat:group-members", args=[self.group_id]),
            {"username": self.bob.username},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        res = self.client.delete(
            reverse("chat:group-member-detail", args=[self.group_id, self.bob.id])
        )
        self.assertEqual(res.status_code, 204)
        self.assertFalse(
            Participant.objects.filter(
                conversation_id=self.conv_id, user=self.bob
            ).exists()
        )

    def test_owner_cannot_be_removed(self):
        res = self.client.delete(
            reverse("chat:group-member-detail", args=[self.group_id, self.owner.id])
        )
        self.assertEqual(res.status_code, 403)

    def test_member_leaves_group(self):
        self.client.force_authenticate(self.alice)
        res = self.client.delete(
            reverse("chat:group-member-detail", args=[self.group_id, self.alice.id])
        )
        self.assertEqual(res.status_code, 204)
        # بعد از خروج، دیگر نمی‌تواند پیام بفرستد
        res = self.client.post(
            reverse("chat:message-list", args=[self.conv_id]), {"text": "بای"}
        )
        self.assertEqual(res.status_code, 404)

    def test_rename_requires_admin(self):
        self.client.force_authenticate(self.alice)
        res = self.client.patch(
            reverse("chat:group-detail", args=[self.group_id]), {"name": "نام جدید"}
        )
        self.assertEqual(res.status_code, 403)
        self.client.force_authenticate(self.owner)
        res = self.client.patch(
            reverse("chat:group-detail", args=[self.group_id]), {"name": "نام جدید"}
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["name"], "نام جدید")

    def test_delete_group_requires_owner(self):
        self.client.force_authenticate(self.alice)
        res = self.client.delete(reverse("chat:group-detail", args=[self.group_id]))
        self.assertEqual(res.status_code, 403)
        self.client.force_authenticate(self.owner)
        res = self.client.delete(reverse("chat:group-detail", args=[self.group_id]))
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Group.objects.filter(id=self.group_id).exists())
        self.assertFalse(Conversation.objects.filter(id=self.conv_id).exists())


class PrivateChatGroupSeparationTests(GroupTestsBase):
    def test_two_member_group_is_not_returned_as_private_chat(self):
        # گروه دونفره نباید وقتی چت خصوصی شروع می‌شود، به‌عنوان چت خصوصی برگردد
        self.create_group(members=[self.alice.username])
        res = self.client.post(
            reverse("chat:conversation-list"),
            {"username": self.alice.username},
            format="json",
        )
        self.assertEqual(res.status_code, 201)  # 200 یعنی گروه را اشتباه برگردانده
        self.assertIsNone(res.data["group"])
        group_conv = Conversation.objects.filter(group__isnull=False).first()
        self.assertNotEqual(res.data["id"], group_conv.id)