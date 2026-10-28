import mimetypes
from datetime import timedelta

from django.conf import settings
from django.contrib.auth import get_user_model
from django.core.files.base import File
from django.db import transaction
from django.db.models import Min, OuterRef, Q, Subquery
from django.http import FileResponse
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import CallLog, Conversation, Group, Message, Participant
from .presence import get_presence
from .push import push_to_users
from .serializers import MessageSerializer

User = get_user_model()

TEXT_MAX_LENGTH = 4096
HISTORY_PAGE_DEFAULT = 30
HISTORY_PAGE_MAX = 50
ATTACHMENT_KINDS = {"image", "file", "voice"}
GROUP_NAME_MAX = 128
GROUP_MAX_MEMBERS = 200


def _get_my_conversation(user, conv_id):
    """فقط اگر کاربر عضو گفتگو باشد برمی‌گرداند؛ وگرنه None (404 — بدون لو دادن وجود گفتگو)."""
    return Conversation.objects.filter(id=conv_id, participants=user).first()


def _conversation_participant_ids(conv):
    return list(
        Participant.objects.filter(conversation=conv).values_list("user_id", flat=True)
    )


def _clean_text(raw):
    return raw.strip() if isinstance(raw, str) else ""


def _annotated_conversations(user):
    return Conversation.objects.filter(participants=user).annotate(
        last_read_id=Subquery(
            Participant.objects.filter(conversation=OuterRef("pk"), user=user).values(
                "last_read_message_id"
            )[:1]
        ),
        other_last_read_id=Subquery(
            Participant.objects.filter(conversation=OuterRef("pk"))
            .exclude(user=user)
            .values("last_read_message_id")[:1]
        ),
        last_message_id=Subquery(
            Message.objects.filter(conversation=OuterRef("pk"))
            .exclude(deleted_for=user)  # حذفِ «برای من» در پیش‌نمایش سایدبار هم اعمال شود
            .order_by("-id")
            .values("id")[:1]
        ),
    )


def _serialize_conversations(user, conversations):
    """ساخت خروجی لیست گفتگو — خصوصی: طرف مقابل؛ گروه: نام و شمار اعضا."""
    convs = list(conversations)
    ids = [c.id for c in convs]

    # گروه‌های این گفتگوها
    group_by_conv = {}
    if ids:
        for g in Group.objects.filter(conversation_id__in=ids):
            group_by_conv[g.conversation_id] = g

    # طرف مقابل فقط برای گفتگوهای خصوصی
    other_by_conv = {}
    private_ids = [c.id for c in convs if c.id not in group_by_conv]
    if private_ids:
        for p in (
            Participant.objects.filter(conversation_id__in=private_ids)
            .exclude(user=user)
            .select_related("user")
        ):
            other_by_conv.setdefault(p.conversation_id, p.user)

    # آخرین پیام هر گفتگو
    last_msg_by_conv = {}
    msg_ids = [c.last_message_id for c in convs if c.last_message_id]
    if msg_ids:
        for m in Message.objects.filter(id__in=msg_ids).select_related("sender", "call_log"):
            last_msg_by_conv[m.conversation_id] = m

    presence = get_presence([u.id for u in other_by_conv.values()])

    data = []
    for c in convs:
        g = group_by_conv.get(c.id)
        lm = last_msg_by_conv.get(c.id)
        last_read_id = c.last_read_id or 0
        unread = (
            Message.objects.filter(conversation_id=c.id, id__gt=last_read_id)
            .exclude(sender=user)
            .exclude(deleted_for=user)
            .count()
        )
        last_message = (
            {
                "id": lm.id,
                "text": lm.text,
                "sender_id": lm.sender_id,
                "sender_username": lm.sender.username,
                "created_at": lm.created_at,
                "kind": lm.kind,
                "call": (
                    {
                        "status": lm.call_log.status,
                        "call_type": lm.call_log.call_type,
                        "duration": lm.call_log.duration,
                    }
                    if lm.kind == "call" and lm.call_log
                    else None
                ),
            }
            if lm
            else None
        )

        if g is not None:
            # گفتگوی گروهی — تیک دوتایی یعنی همه‌ی اعضای دیگر خوانده باشند
            all_others_read = (
                Participant.objects.filter(conversation_id=c.id)
                .exclude(user=user)
                .aggregate(v=Min("last_read_message_id"))["v"]
                or 0
            )
            data.append(
                {
                    "id": c.id,
                    "other_user": None,
                    "group": {
                        "id": g.id,
                        "name": g.name,
                        "member_count": Participant.objects.filter(
                            conversation_id=c.id
                        ).count(),
                    },
                    "last_message": last_message,
                    "unread_count": unread,
                    "other_last_read_id": all_others_read,
                    "updated_at": c.updated_at,
                }
            )
            continue

        other = other_by_conv.get(c.id)
        pres = presence.get(other.id, {}) if other else {}
        data.append(
            {
                "id": c.id,
                "other_user": (
                    {
                        "id": other.id,
                        "username": other.username,
                        "online": pres.get("online", False),
                        "last_seen": pres.get("last_seen"),
                    }
                    if other
                    else None
                ),
                "group": None,
                "last_message": last_message,
                "unread_count": unread,
                "other_last_read_id": c.other_last_read_id or 0,
                "updated_at": c.updated_at,
            }
        )
    return data


# ---------- گروه‌ها (فاز ۴) ----------

def _get_my_group(user, group_id):
    """گروه فقط برای اعضایش برگردد — بدون لو دادن وجود گروه به غریبه‌ها."""
    return (
        Group.objects.select_related("conversation")
        .filter(id=group_id, conversation__participants=user)
        .first()
    )


def _group_member_ids(conv):
    return list(
        Participant.objects.filter(conversation=conv).values_list("user_id", flat=True)
    )


def _my_role(user, conv):
    return (
        Participant.objects.filter(conversation=conv, user=user)
        .values_list("role", flat=True)
        .first()
        or ""
    )


def _serialize_group(user, group, include_members=False):
    conv = group.conversation
    members_qs = Participant.objects.filter(conversation=conv).select_related("user")
    me = members_qs.filter(user=user).first()
    last_read_id = (me.last_read_message_id if me else 0) or 0
    unread = (
        Message.objects.filter(conversation_id=conv.id, id__gt=last_read_id)
        .exclude(sender=user)
        .exclude(deleted_for=user)
        .count()
    )
    lm = (
        Message.objects.filter(conversation=conv)
        .exclude(deleted_for=user)
        .select_related("sender")
        .order_by("-id")
        .first()
    )
    data = {
        "id": group.id,
        "conversation_id": conv.id,
        "name": group.name,
        "member_count": members_qs.count(),
        "unread_count": unread,
        "my_role": me.role if me else "",
        "created_by": group.created_by_id,
        "created_at": group.created_at,
        "last_message": (
            {
                "id": lm.id,
                "text": lm.text,
                "sender_id": lm.sender_id,
                "sender_username": lm.sender.username,
                "created_at": lm.created_at,
            }
            if lm
            else None
        ),
        "updated_at": conv.updated_at,
    }
    if include_members:
        presence = get_presence([p.user_id for p in members_qs])
        data["members"] = [
            {
                "id": p.user_id,
                "username": p.user.username,
                "role": p.role,
                "online": presence.get(p.user_id, {}).get("online", False),
                "joined_at": p.joined_at,
            }
            for p in members_qs.order_by("joined_at")
        ]
    return data


class GroupListCreateView(APIView):
    def get(self, request):
        groups = (
            Group.objects.filter(conversation__participants=request.user)
            .select_related("conversation")
            .order_by("-conversation__updated_at")
        )
        return Response([_serialize_group(request.user, g) for g in groups])

    def post(self, request):
        user = request.user
        raw_name = request.data.get("name")
        name = _clean_text(raw_name)[:GROUP_NAME_MAX] if isinstance(raw_name, str) else ""
        if not name:
            return Response({"name": ["نام گروه را وارد کن."]}, status=400)

        raw_members = request.data.get("members")
        if raw_members in (None, ""):
            raw_members = []
        if not isinstance(raw_members, list) or any(
            not isinstance(m, str) for m in raw_members
        ):
            return Response(
                {"members": ["فهرست اعضا باید آرایه‌ای از نام‌های کاربری باشد."]},
                status=400,
            )
        usernames = []
        for m in raw_members:
            m = m.strip()
            if m and m != user.username and m not in usernames:
                usernames.append(m)
        users = list(User.objects.filter(username__in=usernames))
        found = {u.username for u in users}
        missing = [u for u in usernames if u not in found]
        if missing:
            return Response(
                {"members": [f"این کاربرها پیدا نشدند: {', '.join(missing)}"]},
                status=404,
            )
        if 1 + len(users) > GROUP_MAX_MEMBERS:
            return Response(
                {"members": [f"گروه حداکثر {GROUP_MAX_MEMBERS} نفر می‌تواند داشته باشد."]},
                status=400,
            )

        with transaction.atomic():
            conv = Conversation.objects.create()
            group = Group.objects.create(conversation=conv, name=name, created_by=user)
            Participant.objects.create(conversation=conv, user=user, role="owner")
            for m in users:
                Participant.objects.create(conversation=conv, user=m, role="member")

        push_to_users(
            _group_member_ids(conv),
            {"type": "group.new", "group_id": group.id, "conversation_id": conv.id},
        )
        return Response(_serialize_group(user, group, include_members=True), status=201)


class GroupDetailView(APIView):
    def get(self, request, group_id):
        group = _get_my_group(request.user, group_id)
        if group is None:
            return Response({"detail": "گروه پیدا نشد."}, status=404)
        return Response(_serialize_group(request.user, group, include_members=True))

    def patch(self, request, group_id):
        group = _get_my_group(request.user, group_id)
        if group is None:
            return Response({"detail": "گروه پیدا نشد."}, status=404)
        if _my_role(request.user, group.conversation) not in ("owner", "admin"):
            return Response(
                {"detail": "فقط سازنده یا مدیر گروه می‌تواند نام گروه را تغییر دهد."},
                status=403,
            )
        raw = request.data.get("name")
        name = _clean_text(raw)[:GROUP_NAME_MAX] if isinstance(raw, str) else ""
        if not name:
            return Response({"name": ["نام گروه را وارد کن."]}, status=400)
        group.name = name
        group.save(update_fields=["name"])
        push_to_users(
            _group_member_ids(group.conversation),
            {
                "type": "group.updated",
                "group_id": group.id,
                "conversation_id": group.conversation_id,
                "reason": "renamed",
            },
        )
        return Response(_serialize_group(request.user, group, include_members=True))

    def delete(self, request, group_id):
        group = _get_my_group(request.user, group_id)
        if group is None:
            return Response({"detail": "گروه پیدا نشد."}, status=404)
        if _my_role(request.user, group.conversation) != "owner":
            return Response(
                {"detail": "فقط سازنده گروه می‌تواند آن را حذف کند."}, status=403
            )
        conv = group.conversation
        member_ids = _group_member_ids(conv)
        group_id = group.id
        conv_id = conv.id
        with transaction.atomic():
            for m in Message.objects.filter(conversation=conv):
                if m.attachment:
                    m.attachment.delete(save=False)
            conv.delete()  # گروه و اعضا و پیام‌ها آبشاری پاک می‌شوند
        push_to_users(
            member_ids,
            {"type": "group.deleted", "group_id": group_id, "conversation_id": conv_id},
        )
        return Response(status=204)


class GroupMemberView(APIView):
    def post(self, request, group_id):
        group = _get_my_group(request.user, group_id)
        if group is None:
            return Response({"detail": "گروه پیدا نشد."}, status=404)
        conv = group.conversation
        if _my_role(request.user, conv) not in ("owner", "admin"):
            return Response(
                {"detail": "فقط سازنده یا مدیر گروه می‌تواند عضو اضافه کند."}, status=403
            )

        raw = request.data.get("username")
        username = raw.strip() if isinstance(raw, str) else ""
        if not username:
            return Response({"username": ["یک نام کاربری وارد کن."]}, status=400)
        other = User.objects.filter(username=username).first()
        if other is None:
            return Response({"username": ["کاربری با این نام پیدا نشد."]}, status=404)
        if Participant.objects.filter(conversation=conv, user=other).exists():
            return Response({"username": ["این کاربر قبلاً عضو گروه است."]}, status=400)
        if Participant.objects.filter(conversation=conv).count() >= GROUP_MAX_MEMBERS:
            return Response(
                {"detail": [f"گروه پر است (حداکثر {GROUP_MAX_MEMBERS} نفر)."]},
                status=400,
            )

        Participant.objects.create(conversation=conv, user=other, role="member")
        push_to_users(
            _group_member_ids(conv),
            {
                "type": "group.updated",
                "group_id": group.id,
                "conversation_id": conv.id,
                "reason": "member_added",
                "user_id": other.id,
            },
        )
        presence = get_presence([other.id])
        return Response(
            {
                "id": other.id,
                "username": other.username,
                "role": "member",
                "online": presence.get(other.id, {}).get("online", False),
            },
            status=201,
        )


class GroupMemberDetailView(APIView):
    def delete(self, request, group_id, user_id):
        group = _get_my_group(request.user, group_id)
        if group is None:
            return Response({"detail": "گروه پیدا نشد."}, status=404)
        conv = group.conversation
        target = Participant.objects.filter(conversation=conv, user_id=user_id).first()
        if target is None:
            return Response({"detail": "این کاربر عضو گروه نیست."}, status=404)

        my_role = _my_role(request.user, conv)
        if user_id == request.user.id:
            # خروج خود از گروه — سازنده نمی‌تواند خارج شود
            if target.role == "owner":
                return Response(
                    {"detail": "سازنده گروه نمی‌تواند آن را ترک کند؛ گروه را حذف کن."},
                    status=403,
                )
        else:
            if my_role not in ("owner", "admin"):
                return Response(
                    {"detail": "فقط سازنده یا مدیر گروه می‌تواند عضو را حذف کند."},
                    status=403,
                )
            if target.role == "owner":
                return Response(
                    {"detail": "سازنده گروه را نمی‌توان حذف کرد."}, status=403
                )
            if my_role == "admin" and target.role == "admin":
                return Response(
                    {"detail": "مدیر نمی‌تواند مدیر دیگر را حذف کند."}, status=403
                )

        target.delete()
        push_to_users(
            _group_member_ids(conv) + [user_id],
            {
                "type": "group.updated",
                "group_id": group.id,
                "conversation_id": conv.id,
                "reason": "member_removed",
                "user_id": user_id,
            },
        )
        return Response(status=204)


class UserSearchView(APIView):
    def get(self, request):
        q = (request.query_params.get("q") or "").strip()
        if not q:
            return Response([])
        users = list(
            User.objects.filter(
                Q(username__icontains=q)
                | Q(first_name__icontains=q)
                | Q(last_name__icontains=q)
            )
            .exclude(id=request.user.id)
            .order_by("username")[:10]
        )
        presence = get_presence([u.id for u in users])
        return Response(
            [
                {
                    "id": u.id,
                    "username": u.username,
                    "first_name": u.first_name,
                    "last_name": u.last_name,
                    "online": presence.get(u.id, {}).get("online", False),
                }
                for u in users
            ]
        )


class ConversationListCreateView(APIView):
    def get(self, request):
        conversations = _annotated_conversations(request.user).order_by("-updated_at")
        return Response(_serialize_conversations(request.user, conversations))

    def post(self, request):
        user = request.user
        raw = request.data.get("username")
        username = raw.strip() if isinstance(raw, str) else ""
        if not username:
            return Response({"username": ["یک نام کاربری وارد کن."]}, status=400)
        if username == user.username:
            return Response({"username": ["نمی‌توانی با خودت گفتگو شروع کنی."]}, status=400)
        other = User.objects.filter(username=username).first()
        if other is None:
            return Response({"username": ["کاربری با این نام پیدا نشد."]}, status=404)

        # اگر قبلاً گفتگوی خصوصیِ دقیقاً همین دو نفر وجود دارد، همان را برگردان
        # (فاز ۴) — فقط گفتگوهای بدون گروه؛ گروه دونفره چت خصوصی نیست
        for conv in (
            Conversation.objects.filter(participants=user, group__isnull=True)
            .filter(participants=other)
        ):
            if conv.participants.count() == 2:
                serialized = _serialize_conversations(
                    user, _annotated_conversations(user).filter(id=conv.id)
                )
                return Response(serialized[0], status=200)

        with transaction.atomic():
            conv = Conversation.objects.create()
            Participant.objects.create(conversation=conv, user=user)
            Participant.objects.create(conversation=conv, user=other)

        push_to_users(
            [user.id, other.id],
            {"type": "conversation.new", "conversation_id": conv.id},
        )
        serialized = _serialize_conversations(
            user, _annotated_conversations(user).filter(id=conv.id)
        )
        return Response(serialized[0], status=201)


class MessageListCreateView(APIView):
    def get(self, request, conv_id):
        conv = _get_my_conversation(request.user, conv_id)
        if conv is None:
            return Response({"detail": "گفتگو پیدا نشد."}, status=404)

        try:
            before = int(request.query_params.get("before") or 0)
        except (TypeError, ValueError):
            before = 0
        try:
            limit = int(request.query_params.get("limit") or HISTORY_PAGE_DEFAULT)
        except (TypeError, ValueError):
            limit = HISTORY_PAGE_DEFAULT
        limit = max(1, min(limit, HISTORY_PAGE_MAX))

        qs = (
            Message.objects.filter(conversation=conv)
            .exclude(deleted_for=request.user)  # پیام‌های حذف‌شده «برای من» نمی‌آیند
            .select_related("sender", "reply_to", "reply_to__sender")
        )
        if before > 0:
            qs = qs.filter(id__lt=before)
        msgs = list(qs.order_by("-id")[: limit + 1])
        has_more = len(msgs) > limit
        msgs = msgs[:limit]

        return Response(
            {"results": MessageSerializer(msgs, many=True).data, "has_more": has_more}
        )

    def post(self, request, conv_id):
        conv = _get_my_conversation(request.user, conv_id)
        if conv is None:
            return Response({"detail": "گفتگو پیدا نشد."}, status=404)

        text = _clean_text(request.data.get("text"))
        if len(text) > TEXT_MAX_LENGTH:
            return Response(
                {"text": [f"متن پیام نمی‌تواند بیش از {TEXT_MAX_LENGTH} نویسه باشد."]},
                status=400,
            )

        # ----- پیوست (اختیاری) — فاز ۳ -----
        upload = request.FILES.get("attachment")
        kind = (request.data.get("kind") or "").strip()
        if upload is not None:
            max_bytes = settings.CHAT_MAX_UPLOAD_MB * 1024 * 1024
            if upload.size > max_bytes:
                return Response(
                    {
                        "attachment": [
                            f"حجم پیوست نمی‌تواند بیش از {settings.CHAT_MAX_UPLOAD_MB} مگابایت باشد."
                        ]
                    },
                    status=400,
                )
            if not kind:
                ctype = (upload.content_type or "").lower()
                kind = "image" if ctype.startswith("image/") else "file"
            if kind not in ATTACHMENT_KINDS:
                return Response({"kind": ["نوع پیوست نامعتبر است."]}, status=400)
        elif kind:
            return Response({"attachment": ["فایلی برای این نوع ارسال نشده است."]}, status=400)

        if not text and upload is None:
            return Response({"text": ["متن پیام نمی‌تواند خالی باشد."]}, status=400)

        voice_duration = None
        if kind == "voice":
            try:
                voice_duration = max(0, min(int(request.data.get("duration") or 0), 7200))
            except (TypeError, ValueError):
                voice_duration = None

        # پاسخ به پیام (اختیاری) — باید متعلق به همین گفتگو باشد
        reply_to = None
        raw_reply = request.data.get("reply_to")
        if raw_reply not in (None, ""):
            try:
                reply_id = int(raw_reply)
            except (TypeError, ValueError):
                return Response({"reply_to": ["شناسه پیام نامعتبر است."]}, status=400)
            reply_to = Message.objects.filter(id=reply_id, conversation=conv).first()
            if reply_to is None:
                return Response({"reply_to": ["پیام موردنظر در این گفتگو پیدا نشد."]}, status=400)

        with transaction.atomic():
            msg = Message(
                conversation=conv, sender=request.user, text=text, reply_to=reply_to
            )
            if upload is not None:
                msg.attachment = upload
                msg.attachment_kind = kind
                msg.attachment_name = (upload.name or "file")[:255]
                msg.attachment_size = upload.size
                msg.voice_duration = voice_duration
            msg.save()
            # گفتگو به بالای لیست برود + پیام خودمان طبیعتاً خوانده‌شده است
            conv.save(update_fields=["updated_at"])
            Participant.objects.filter(conversation=conv, user=request.user).update(
                last_read_message_id=msg.id
            )

        # روابط پاسخ برای سریالایز یک‌جا لود شوند
        msg = Message.objects.select_related(
            "sender", "reply_to", "reply_to__sender"
        ).get(pk=msg.pk)

        push_to_users(
            _conversation_participant_ids(conv),
            {"type": "message.new", "message": MessageSerializer(msg).data},
        )
        return Response(MessageSerializer(msg).data, status=201)


class MessageDetailView(APIView):
    def patch(self, request, msg_id):
        msg = (
            Message.objects.select_related(
                "sender", "conversation", "reply_to", "reply_to__sender"
            )
            .filter(id=msg_id)
            .first()
        )
        if msg is None:
            return Response({"detail": "پیام پیدا نشد."}, status=404)
        if msg.sender_id != request.user.id:
            return Response({"detail": "فقط فرستنده می‌تواند پیام را ویرایش کند."}, status=403)

        text = _clean_text(request.data.get("text"))
        if len(text) > TEXT_MAX_LENGTH:
            return Response(
                {"text": [f"متن پیام نمی‌تواند بیش از {TEXT_MAX_LENGTH} نویسه باشد."]},
                status=400,
            )
        if not text:
            return Response({"text": ["متن پیام نمی‌تواند خالی باشد."]}, status=400)

        msg.text = text
        msg.edited_at = timezone.now()
        msg.save(update_fields=["text", "edited_at"])

        push_to_users(
            _conversation_participant_ids(msg.conversation),
            {"type": "message.edited", "message": MessageSerializer(msg).data},
        )
        return Response(MessageSerializer(msg).data)

    def delete(self, request, msg_id):
        msg = (
            Message.objects.select_related("conversation")
            .filter(id=msg_id)
            .first()
        )
        if msg is None:
            return Response({"detail": "پیام پیدا نشد."}, status=404)
        if _get_my_conversation(request.user, msg.conversation_id) is None:
            return Response({"detail": "پیام پیدا نشد."}, status=404)

        # scope=me → فقط برای خودِ کاربر مخفی می‌شود (حتی پیام طرف مقابل)؛
        # scope=everyone → حذف قطعی برای هر دو طرف، فقط برای پیام‌های خودش
        scope = (
            "me"
            if isinstance(request.data, dict) and request.data.get("scope") == "me"
            else "everyone"
        )

        if scope == "me":
            msg.deleted_for.add(request.user)
            return Response(status=204)

        if msg.sender_id != request.user.id:
            return Response(
                {"detail": "حذف برای همه فقط برای پیام‌های خودت ممکن است."}, status=403
            )

        conv = msg.conversation
        message_id = msg.id
        if msg.attachment:
            msg.attachment.delete(save=False)  # فایل پیوست هم پاک شود
        msg.delete()  # حذف قطعی (تصمیم تأییدشده)

        push_to_users(
            _conversation_participant_ids(conv),
            {
                "type": "message.deleted",
                "conversation_id": conv.id,
                "message_id": message_id,
            },
        )
        return Response(status=204)


class MessageBulkDeleteView(APIView):
    """حذف دسته‌ای — «برای من» (هر پیامی از گفتگو) یا «برای همه» (فقط پیام‌های خودم)."""

    MAX_IDS = 100

    def post(self, request, conv_id):
        conv = _get_my_conversation(request.user, conv_id)
        if conv is None:
            return Response({"detail": "گفتگو پیدا نشد."}, status=404)

        scope = (
            request.data.get("scope") if isinstance(request.data, dict) else None
        ) or "me"
        ids_raw = request.data.get("ids") if isinstance(request.data, dict) else None
        if not isinstance(ids_raw, list) or not ids_raw:
            return Response({"ids": ["فهرست پیام‌ها خالی است."]}, status=400)
        try:
            ids = [int(x) for x in ids_raw][: self.MAX_IDS]
        except (TypeError, ValueError):
            return Response({"ids": ["شناسه پیام‌ها نامعتبر است."]}, status=400)

        msgs = list(Message.objects.filter(conversation=conv, id__in=ids))
        if scope == "everyone":
            if any(m.sender_id != request.user.id for m in msgs):
                return Response(
                    {"detail": "حذف برای همه فقط برای پیام‌های خودت ممکن است."}, status=403
                )
            found_ids = [m.id for m in msgs]
            for m in msgs:
                if m.attachment:
                    m.attachment.delete(save=False)
                m.delete()
            participant_ids = _conversation_participant_ids(conv)
            for mid in found_ids:
                push_to_users(
                    participant_ids,
                    {
                        "type": "message.deleted",
                        "conversation_id": conv.id,
                        "message_id": mid,
                    },
                )
            return Response(status=204)

        # «برای من» — مخفی‌سازی هر پیامی از این گفتگو برای خودِ کاربر
        for m in msgs:
            m.deleted_for.add(request.user)
        return Response(status=204)


class MessageForwardView(APIView):
    """فوروارد پیام به گفتگوی دیگر — متن کپی می‌شود و فرستنده‌ی جدید، خودِ کاربر است."""

    def post(self, request, msg_id):
        src = Message.objects.select_related("conversation").filter(id=msg_id).first()
        if src is None or _get_my_conversation(request.user, src.conversation_id) is None:
            return Response({"detail": "پیام پیدا نشد."}, status=404)

        try:
            target_id = int(request.data.get("conversation_id"))
        except (TypeError, ValueError):
            return Response({"conversation_id": ["شناسه گفتگو نامعتبر است."]}, status=400)
        target = _get_my_conversation(request.user, target_id)
        if target is None:
            return Response({"conversation_id": ["گفتگو مقصد پیدا نشد."]}, status=404)

        text = _clean_text(src.text)
        # پیام بدون متن هم قابل فوروارد است، به شرطی که پیوست داشته باشد (فاز ۳)
        if not text and not src.attachment:
            return Response({"detail": "این پیام قابل فوروارد نیست."}, status=400)

        with transaction.atomic():
            msg = Message(conversation=target, sender=request.user, text=text)
            if src.attachment:
                # کپی فیزیکی فایل — پیام فورواردشده باید مستقل از پیام مبدأ باشد
                with src.attachment.open("rb") as src_file:
                    msg.attachment.save(src.attachment.name, File(src_file), save=False)
                msg.attachment_kind = src.attachment_kind
                msg.attachment_name = src.attachment_name
                msg.attachment_size = src.attachment_size
                msg.voice_duration = src.voice_duration
            msg.save()
            target.save(update_fields=["updated_at"])
            Participant.objects.filter(conversation=target, user=request.user).update(
                last_read_message_id=msg.id
            )

        msg = Message.objects.select_related(
            "sender", "reply_to", "reply_to__sender"
        ).get(pk=msg.pk)

        push_to_users(
            _conversation_participant_ids(target),
            {"type": "message.new", "message": MessageSerializer(msg).data},
        )
        return Response(MessageSerializer(msg).data, status=201)


class MessageAttachmentView(APIView):
    """دریافت پیوست — فقط اعضای همان گفتگو؛ URL حدسی برای غریبه کار نمی‌کند."""

    def get(self, request, msg_id):
        msg = (
            Message.objects.select_related("conversation")
            .filter(id=msg_id, conversation__participants=request.user)
            .first()
        )
        if msg is None or not msg.attachment:
            return Response({"detail": "پیام پیدا نشد."}, status=404)

        content_type, _ = mimetypes.guess_type(msg.attachment_name or "")
        return FileResponse(
            msg.attachment.open("rb"),
            content_type=content_type or "application/octet-stream",
            filename=msg.attachment_name or "file",
            as_attachment=False,
        )
        
class CallLogListView(APIView):
    """پنل «تماس‌های اخیر» — گزارش تماس‌هایی که با من بوده (فاز ۵، بسته ۱)."""

    def get(self, request):
        # زنگِ واقعی حداکثر ۴۶ ثانیه TTL دارد؛ ringingای که بیشتر از
        # یک دقیقه از شروعش گذشته دیگر در جریان نیست → «بی‌پاسخ» دیده شود
        stale_before = timezone.now() - timedelta(seconds=60)
        logs = list(
            CallLog.objects.filter(Q(caller=request.user) | Q(callee=request.user))
            .select_related("caller", "callee")
            .order_by("-id")[:50]
        )
        peer_ids = {l.caller_id for l in logs} | {l.callee_id for l in logs}
        peer_ids.discard(request.user.id)
        presence = get_presence(list(peer_ids))

        data = []
        for log in logs:
            peer = log.callee if log.caller_id == request.user.id else log.caller
            pres = presence.get(peer.id, {}) if peer else {}
            data.append(
                {
                    "id": log.id,
                    "conversation_id": log.conversation_id,
                    "peer": {
                        "id": peer.id,
                        "username": peer.username,
                        "online": pres.get("online", False),
                    },
                    "outgoing": log.caller_id == request.user.id,
                    "call_type": log.call_type,
                    "status": (
                        "missed"
                        if log.status == "ringing" and log.started_at < stale_before
                        else log.status
                    ),
                    "duration": log.duration,
                    "created_at": log.started_at,
                }
            )
        return Response(data)