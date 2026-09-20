"""A receiver in its own module, attached to an imported signal."""
from signals import shipped, never_shipped


def receiver(signal, **kw):
    return lambda f: f


@receiver(shipped)
def on_shipped(sender, **kw):
    return _record(sender)


@receiver(never_shipped)
def on_never_shipped(sender, **kw):
    """Attached to a signal nothing publishes. Entry point, no inbound edge."""
    return _record(sender)


def _record(sender):
    """Reached only through a receiver, from another module."""
    return sender
