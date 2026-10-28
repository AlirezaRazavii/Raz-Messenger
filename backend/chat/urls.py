from django.urls import path

from . import views

app_name = "chat"

urlpatterns = [
    path("users/", views.UserSearchView.as_view(), name="user-search"),
    path("conversations/", views.ConversationListCreateView.as_view(), name="conversation-list"),
    path(
        "conversations/<int:conv_id>/messages/",
        views.MessageListCreateView.as_view(),
        name="message-list",
    ),
    path("messages/<int:msg_id>/", views.MessageDetailView.as_view(), name="message-detail"),
    path(
        "conversations/<int:conv_id>/messages/bulk-delete/",
        views.MessageBulkDeleteView.as_view(),
        name="message-bulk-delete",
    ),
    path(
        "messages/<int:msg_id>/forward/",
        views.MessageForwardView.as_view(),
        name="message-forward",
    ),
    path(
        "messages/<int:msg_id>/attachment/",
        views.MessageAttachmentView.as_view(),
        name="message-attachment",
    ),
    # فاز ۵ (بسته ۱) — تاریخچه‌ی تماس‌ها
    path("calls/", views.CallLogListView.as_view(), name="call-logs"),

    # فاز ۴ — گروه‌ها
    path("groups/", views.GroupListCreateView.as_view(), name="group-list"),
    path("groups/<int:group_id>/", views.GroupDetailView.as_view(), name="group-detail"),
    path(
        "groups/<int:group_id>/members/",
        views.GroupMemberView.as_view(),
        name="group-members",
    ),
    path(
        "groups/<int:group_id>/members/<int:user_id>/",
        views.GroupMemberDetailView.as_view(),
        name="group-member-detail",
    ),
]