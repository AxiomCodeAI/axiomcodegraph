from django.urls import include, path, re_path

from shop import views
from shop.views import order_settings

report_patterns = [
    path("report/", views.order_report),
]

export_patterns = [
    path("export/", views.order_export),
]

draft_patterns = [
    path("draft/", views.order_draft),
]

status_patterns = [
    path("", views.api_status),
]

api_patterns = [
    path("status/", include(status_patterns)),
]

urlpatterns = [
    path("orders/", views.order_list),
    path("orders/settings/", order_settings),
    path("orders/history/", views.order_history),
    path(
        "orders/cancel/",
        views.order_cancel,
        name="order-cancel",
    ),
    path("orders/extra/", include(report_patterns)),
    path("orders/more/", include((export_patterns, "exports"))),
    path("widgets/", views.WidgetView.as_view()),
    path("catalog/", include("catalog.urls")),
    path("credit/", include([path("notes/", views.order_credit_note)])),
    path("api/v1/", include(api_patterns)),
    path("api/v2/", include(api_patterns)),
    re_path(r"^legacy/(?P<pk>[0-9]+)/$", views.order_legacy),
]
