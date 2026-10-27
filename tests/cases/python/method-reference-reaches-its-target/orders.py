"""Methods and functions handed over as REFERENCES: named as a value, called later by whoever holds them."""
import functools
import signal
import threading
from concurrent.futures import ThreadPoolExecutor


class OrderService:
    def cancel(self, oid):
        return oid

    def rank(self, x):
        return x

    def convert(self, row):
        return row

    def on_event(self, e):
        return e

    def handle(self, sig, frame):
        return sig

    def run_job(self):
        return 1

    def index(self):
        return "ok"

    def audit(self, oid):
        return oid


class LedgerService:
    """Same method names as OrderService, and no relation to it."""

    def cancel(self, oid):
        return oid

    def rank(self, x):
        return x


def top_level_job(item):
    return item


class Worker:
    def __init__(self):
        self.pool = ThreadPoolExecutor()

    def _do_work(self, item):
        return item

    def _rank(self, x):
        return x

    def _handle(self, e):
        return e

    def submit_bound_self(self, item):
        return self.pool.submit(self._do_work, item)

    def sort_by_self_key(self, xs):
        return sorted(xs, key=self._rank)

    def escapes(self):
        return self._handle


def submit_plain_function(pool, item):
    return pool.submit(top_level_job, item)


def executor_svc(loop, svc: OrderService, oid):
    return loop.run_in_executor(None, svc.cancel, oid)


def thread_target(svc: OrderService):
    t = threading.Thread(target=svc.run_job)
    t.start()
    return t


def callback_list(handler: OrderService):
    callbacks = [handler.on_event]
    return callbacks


def register(handler):
    return handler


def keyword_register(svc: OrderService):
    return register(handler=svc.cancel)


def sort_key(svc: OrderService, xs):
    return sorted(xs, key=svc.rank)


def map_convert(svc: OrderService, rows):
    return list(map(svc.convert, rows))


def unbound_reference(rows):
    return list(map(OrderService.convert, rows))


def partial_cancel(svc: OrderService, oid):
    return functools.partial(svc.cancel, oid)


def signal_connect(svc: OrderService):
    signal.signal(signal.SIGTERM, svc.handle)


def url_rule(app, views: OrderService):
    app.add_url_rule("/x", view_func=views.index)


def constructed_receiver(oid):
    svc = OrderService()
    return functools.partial(svc.cancel, oid)


def lambda_holder(svc: OrderService, xs):
    return sorted(xs, key=lambda x: svc.rank)


# ── near-miss controls ───────────────────────────────────────────────────────
def untyped_receiver(executor, thing, oid):
    """`thing` has no type: `thing.cancel` may be any class's cancel, so it resolves to none."""
    return executor.submit(thing.cancel, oid)


def ledger_rank(ledger: LedgerService, xs):
    """LedgerService.rank, not OrderService.rank."""
    return sorted(xs, key=ledger.rank)


def by_string(svc: OrderService):
    """The method's NAME in a string is not a reference to it."""
    return getattr_name("audit")


def getattr_name(n):
    return n


def reads_its_name(svc: OrderService):
    """Reading an attribute OF the method object does not run it."""
    return svc.audit.__name__


def prints_it(svc: OrderService):
    """str() of the method object runs the function object's __str__, not the method."""
    return str(svc.audit)


def compares_it(svc: OrderService, cb):
    """An identity test on the method object does not run it."""
    return cb is svc.audit
