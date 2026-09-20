"""Registered task bodies in their own module, which is where real projects put them.

A producer and the task it enqueues almost never share a file: the task lives here and
the caller imports it. A single-file case cannot exercise that, so this module exists to
make the import path an assertion rather than an assumption.
"""


def shared_task(f):
    return f


@shared_task
def remote_report(key):
    return _remote_render(key)


@shared_task
def remote_purge(key):
    return _remote_render(key)


def _remote_render(key):
    """Reached only through an imported task body: the impact test across a module."""
    return key


def plain_remote_helper(key):
    """No registration decorator. `.delay` on this means nothing, from any module."""
    return key
