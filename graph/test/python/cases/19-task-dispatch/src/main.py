"""Task-queue dispatch: the hop from a producer to the worker that runs the body.

A task queue registers a function with a decorator and REPLACES the name with a
proxy object. The producer writes `send_report.delay(key)`, which serialises a
message and returns; a worker process later calls the body. No call site connects
the two, so every rule in call-edge-generation is silent across the hop and
"what breaks if I change send_report" stops at the send.

Three registration spellings are here because the rule must not be fitted to one:

    @shared_task            app-independent registration
    @app.task(...)          bound to a named app, with options
    @queue.task             a module attribute

THE NEGATIVE HALF IS THE POINT. `delay` and `apply_async` are ordinary method
names -- a scheduler, an animation helper and a stub all have a `delay` -- so a
dispatch is recognised only when the RECEIVER resolves to a def carrying a
registration decorator. A `.delay()` on anything else stays exactly as it reads.
"""


class _App:
    """Stands in for the task app object: the corpus has no framework staged."""

    def task(self, *a, **kw):
        return lambda f: f

    def shared_task(self, f):
        return f


app = _App()
queue = _App()


def shared_task(f):
    """Module-level registration, the spelling that takes no app."""
    return f


# ── registered task bodies: a worker invokes these, nothing here calls them ──
@shared_task
def send_report(key):
    return _render(key)


@app.task(queue="reports", retries=3)
def rebuild_index(key):
    return _render(key)


@queue.task
def purge_stale(key):
    return _render(key)


def _render(key):
    """Reached ONLY through a task body: it is the test that the hop carries impact."""
    return key


# ── producers: each of these is a hop the call graph cannot otherwise see ────
def enqueue_report(key):
    send_report.delay(key)


def enqueue_rebuild(key):
    rebuild_index.apply_async(args=[key], countdown=30)


def enqueue_purge(key):
    purge_stale.delay(key)


# ── NOT dispatch, and each would be if a condition were dropped ──────────────
class Animation:
    """A `delay` that is an ordinary method. The receiver is not a registered task."""

    def delay(self, ms):
        return ms


def not_a_dispatch(anim):
    anim.delay(250)


def plain_helper(key):
    return key


def also_not_a_dispatch(key):
    """`plain_helper` carries no registration decorator, so `.delay` means nothing."""
    return plain_helper.delay(key)


def called_directly(key):
    """A task body called DIRECTLY is an ordinary call, already a known_edge.
    It must not also produce a second, framework-mediated edge."""
    return send_report(key)
