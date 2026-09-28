"""Views in the forms a route table names them. Each routed one is dispatched by the
framework on a request; nothing in this project calls it."""
from django.contrib.auth.decorators import login_required
from django.views import View
from django.views.decorators.http import require_POST

from shop.decorators import audited


def order_list(request):
    return _render("list")


@login_required
def order_settings(request):
    return _render("settings")


@login_required
@require_POST
def order_cancel(request):
    return _render("cancelled")


@audited
def order_history(request):
    return _render("history")


def order_report(request):
    return _render("report")


def order_export(request):
    return _render("export")


def order_credit_note(request):
    return _render("credit")


def api_status(request):
    """Mounted twice, two tables down: served at /api/v1/status/ and /api/v2/status/."""
    return _render("status")


def order_legacy(request, pk):
    """A regular-expression route: routed, but no literal path to name."""
    return _render("legacy")


def order_view_like(request):
    """Named like a view, routed nowhere: not an entry point."""
    return _render("unrouted")


@login_required
def order_audit(request):
    """Decorated like the routed views, routed nowhere: not an entry point."""
    return _render("audit")


def order_draft(request):
    """Only in a list no table mounts: not an entry point."""
    return _render("draft")


class BaseWidgetView(View):
    def get(self, request):
        return _render("widgets")


class WidgetView(BaseWidgetView):
    def post(self, request):
        return _render("created")

    def summarise(self):
        """Not an HTTP verb: the framework never dispatches to it."""
        return _render("summary")


class UnroutedView(View):
    def get(self, request):
        return _render("never")


def _render(key):
    return key
