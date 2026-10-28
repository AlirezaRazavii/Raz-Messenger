from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("chat", "0005_message_kind_calllog_message_call_log"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="deleted_for",
            field=models.ManyToManyField(
                blank=True,
                related_name="hidden_messages",
                to=settings.AUTH_USER_MODEL,
                verbose_name="حذف‌شده برای",
            ),
        ),
    ]