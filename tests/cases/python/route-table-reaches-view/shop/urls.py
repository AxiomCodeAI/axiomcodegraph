from django.urls import include, path

from shop import views
from shop.views import order_settings

api_patterns = [
    path("status/", views.api_status),
]

urlpatterns = [
    path("orders/<int:pk>/", views.order_detail, name="order-detail"),
    path("orders/settings/", order_settings, name="order-settings"),
    path("widgets/", views.WidgetView.as_view(), name="widgets"),
    path("api/v1/", include(api_patterns)),
]
