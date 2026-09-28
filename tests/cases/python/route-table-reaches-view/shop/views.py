from django.contrib.auth.decorators import login_required
from django.views import View


def order_detail(request, pk):
    return describe(pk)


@login_required
def order_settings(request):
    return "settings"


def api_status(request):
    return "ok"


def order_archive(request):
    return "archive"


class WidgetView(View):
    def get(self, request):
        return "widgets"


def describe(pk):
    return str(pk)
