from rest_framework import serializers

from .models import Message


class UserBriefSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    username = serializers.CharField(read_only=True)


class ReplyBriefSerializer(serializers.Serializer):
    id = serializers.IntegerField(read_only=True)
    text = serializers.CharField(read_only=True)
    sender_id = serializers.IntegerField(read_only=True)
    sender_username = serializers.CharField(read_only=True, source="sender.username")


class CallBriefSerializer(serializers.Serializer):
    """خلاصه‌ی گزارش تماس برای ردیف سیستمی تماس داخل چت."""

    status = serializers.CharField(read_only=True)
    call_type = serializers.CharField(read_only=True)
    duration = serializers.IntegerField(read_only=True)
    caller_id = serializers.IntegerField(read_only=True)
    caller_username = serializers.CharField(read_only=True, source="caller.username")
    callee_id = serializers.IntegerField(read_only=True)


class MessageSerializer(serializers.ModelSerializer):
    sender = UserBriefSerializer(read_only=True)
    conversation = serializers.PrimaryKeyRelatedField(read_only=True)
    reply_to = ReplyBriefSerializer(read_only=True)
    call = CallBriefSerializer(read_only=True, source="call_log")

    class Meta:
        model = Message
        fields = [
            "id", "conversation", "sender", "text", "created_at", "edited_at",
            "reply_to", "attachment_kind", "attachment_name", "attachment_size",
            "voice_duration", "kind", "call",
        ]