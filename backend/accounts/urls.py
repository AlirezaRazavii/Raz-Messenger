from django.urls import path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

app_name = "accounts"

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="register"),
    path("login/", views.LoginView.as_view(), name="login"),
    path("logout/", views.LogoutView.as_view(), name="logout"),
    path("refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    path("me/", views.MeView.as_view(), name="me"),
    path("me/avatar/", views.MeAvatarView.as_view(), name="me-avatar"),
    path("users/<int:user_id>/avatar/", views.UserAvatarServeView.as_view(), name="user-avatar"),
    path("forgot-password/", views.ForgotPasswordView.as_view(), name="forgot_password"),
    path("reset-password/", views.ResetPasswordView.as_view(), name="reset_password"),
    path("change-password/", views.ChangePasswordView.as_view(), name="change_password"),
    path(
        "change-password/confirm/",
        views.ChangePasswordConfirmView.as_view(),
        name="change_password_confirm",
    ),
]