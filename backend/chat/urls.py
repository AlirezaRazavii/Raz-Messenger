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
        "messages/<int:msg_id>/forward/",
        views.MessageForwardView.as_view(),
        name="message-forward",
    ),
    path(
        "messages/<int:msg_id>/attachment/",
        views.MessageAttachmentView.as_view(),
        name="message-attachment",
    ),
]