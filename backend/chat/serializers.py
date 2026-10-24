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


class MessageSerializer(serializers.ModelSerializer):
    sender = UserBriefSerializer(read_only=True)
    conversation = serializers.PrimaryKeyRelatedField(read_only=True)
    reply_to = ReplyBriefSerializer(read_only=True)

    class Meta:
        model = Message
        fields = [
            "id", "conversation", "sender", "text", "created_at", "edited_at",
            "reply_to", "attachment_kind", "attachment_name", "attachment_size",
            "voice_duration",
        ]