from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import OuterRef, Q, Subquery
from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Conversation, Message, Participant
from .presence import get_presence
from .push import push_to_users
from .serializers import MessageSerializer

User = get_user_model()

TEXT_MAX_LENGTH = 4096
HISTORY_PAGE_DEFAULT = 30
HISTORY_PAGE_MAX = 50


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
            .order_by("-id")
            .values("id")[:1]
        ),
    )


def _serialize_conversations(user, conversations):
    """ساخت خروجی لیست گفتگو: طرف مقابل + وضعیت او + آخرین پیام + شمارنده نخوانده."""
    convs = list(conversations)
    ids = [c.id for c in convs]

    # طرف مقابل هر گفتگو (در فاز خصوصی: دقیقاً یک نفر)
    other_by_conv = {}
    if ids:
        for p in (
            Participant.objects.filter(conversation_id__in=ids)
            .exclude(user=user)
            .select_related("user")
        ):
            other_by_conv.setdefault(p.conversation_id, p.user)

    # آخرین پیام هر گفتگو
    last_msg_by_conv = {}
    msg_ids = [c.last_message_id for c in convs if c.last_message_id]
    if msg_ids:
        for m in Message.objects.filter(id__in=msg_ids).select_related("sender"):
            last_msg_by_conv[m.conversation_id] = m

    presence = get_presence([u.id for u in other_by_conv.values()])

    data = []
    for c in convs:
        other = other_by_conv.get(c.id)
        lm = last_msg_by_conv.get(c.id)
        pres = presence.get(other.id, {}) if other else {}
        last_read_id = c.last_read_id or 0
        unread = (
            Message.objects.filter(conversation_id=c.id, id__gt=last_read_id)
            .exclude(sender=user)
            .count()
        )
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
                "last_message": (
                    {
                        "id": lm.id,
                        "text": lm.text,
                        "sender_id": lm.sender_id,
                        "created_at": lm.created_at,
                    }
                    if lm
                    else None
                ),
                "unread_count": unread,
                "other_last_read_id": c.other_last_read_id or 0,
                "updated_at": c.updated_at,
            }
        )
    return data


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
        for conv in Conversation.objects.filter(participants=user).filter(participants=other):
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

        qs = Message.objects.filter(conversation=conv).select_related(
            "sender", "reply_to", "reply_to__sender"
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
        if not text:
            return Response({"text": ["متن پیام نمی‌تواند خالی باشد."]}, status=400)
        if len(text) > TEXT_MAX_LENGTH:
            return Response(
                {"text": [f"متن پیام نمی‌تواند بیش از {TEXT_MAX_LENGTH} نویسه باشد."]},
                status=400,
            )

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
            msg = Message.objects.create(
                conversation=conv, sender=request.user, text=text, reply_to=reply_to
            )
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
        if not text:
            return Response({"text": ["متن پیام نمی‌تواند خالی باشد."]}, status=400)
        if len(text) > TEXT_MAX_LENGTH:
            return Response(
                {"text": [f"متن پیام نمی‌تواند بیش از {TEXT_MAX_LENGTH} نویسه باشد."]},
                status=400,
            )

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
        if msg.sender_id != request.user.id:
            return Response({"detail": "فقط فرستنده می‌تواند پیام را حذف کند."}, status=403)

        conv = msg.conversation
        message_id = msg.id
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
        if not text:
            return Response({"detail": "این پیام قابل فوروارد نیست."}, status=400)

        with transaction.atomic():
            msg = Message.objects.create(conversation=target, sender=request.user, text=text)
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