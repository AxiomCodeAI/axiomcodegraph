"""Four `.delay` / `.apply_async` sites. Two join a registered task. `anim.delay` is an
ordinary method call, and `plain.delay` names a def no task decorator registered: neither
may produce a framework_edge row."""

from .tasks import Animation, plain, retry_report, send_report


def enqueue(key):
    send_report.delay(key)


def reschedule(key):
    retry_report.apply_async(args=[key], countdown=30)


def pause(anim: Animation):
    anim.delay(10)


def run_plain(key):
    plain.delay(key)
