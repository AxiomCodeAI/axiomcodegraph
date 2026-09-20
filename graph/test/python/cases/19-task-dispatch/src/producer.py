"""The cross-module producer, in both spellings a project actually writes.

Neither of these resolves through the decorated def's own binding, which is all the
same-module rule can see, so each is an edge the first version of this rule missed.
"""
from tasks import remote_report, plain_remote_helper
import tasks


def enqueue_imported(key):
    """`from tasks import remote_report` -- the common spelling."""
    remote_report.delay(key)


def enqueue_qualified(key):
    """`import tasks` then the dotted path -- the other common spelling."""
    tasks.remote_purge.apply_async(args=[key])


def not_a_dispatch_imported(key):
    """Imported, but carries no registration decorator. Still nothing."""
    plain_remote_helper.delay(key)
