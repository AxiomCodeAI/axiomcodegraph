"""Two hops a web framework performs that no call site expresses.

URL DISPATCH. A routing table names a view as a VALUE -- `path("items/<id>/",
detail)` -- and the framework calls it on a request. The table entry is a
reference, not a call, so the view has zero callers and `impact detail` is blind
to every URL that reaches it.

SIGNAL DISPATCH. A publisher writes `order_placed.send(sender=Order)`; a receiver
is attached with `@receiver(order_placed)` or by `connect()`. The two ends are
joined by the SIGNAL OBJECT, never by a call, so a change to a receiver looks
unreachable and a change to the sender looks harmless.

THE NEGATIVE HALF IS THE POINT. `path` and `send` are ordinary names. A routing
entry is recognised only where a route TABLE holds it; a receiver only where the
decorator names a signal that something actually sends.
"""


class Signal:
    """Stands in for the framework's signal object: nothing is staged."""

    def send(self, sender, **kw):
        return sender

    def connect(self, fn, **kw):
        return fn


def path(route, view, name=None):
    return (route, view, name)


def re_path(regex, view, name=None):
    return (regex, view, name)


def receiver(signal, **kw):
    return lambda f: f


order_placed = Signal()
never_sent = Signal()


# ── views: the framework calls these, nothing here does ─────────────────────
def detail(request, key):
    return _load(key)


def index(request):
    return _load("all")


def legacy(request, key):
    return _load(key)


def _load(key):
    """Reached ONLY through a view: the test that the hop carries impact."""
    return key


# ── the routing table: entries are references, not calls ────────────────────
urlpatterns = [
    path("items/<key>/", detail, name="detail"),
    path("", index, name="index"),
    re_path(r"^old/(?P<key>[0-9]+)/$", legacy),
]


# ── signal receivers ────────────────────────────────────────────────────────
@receiver(order_placed)
def on_order_placed(sender, **kw):
    return _audit(sender)


def on_order_connected(sender, **kw):
    return _audit(sender)


order_placed.connect(on_order_connected)


@receiver(never_sent)
def on_never_sent(sender, **kw):
    """Attached to a signal nothing sends. It is still an entry point, and it has
    no inbound dispatch edge, because no send reaches it."""
    return _audit(sender)


def _audit(sender):
    return sender


def place_order(order):
    order_placed.send(sender=order)


# ── NOT dispatch, and each would be if a condition were dropped ─────────────
def not_a_route_table(key):
    """A `path(...)` call outside a route table is an ordinary call."""
    return path("x", detail)


class Mailer:
    """An ordinary `send`. The receiver is not a signal."""

    def send(self, sender, **kw):
        return sender


def not_a_signal_send(mailer, order):
    mailer.send(sender=order)
