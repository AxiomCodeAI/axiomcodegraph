"""Every documented way to attach a receiver to a signal declared in another module."""
from django.dispatch import receiver

import signals
from signals import order_paid, order_placed, order_shipped


@receiver(order_placed)
def on_placed(sender, **kw):
    return sender


@receiver([order_placed, order_shipped])
def audit(sender, **kw):
    """One receiver, a LIST of signals: it runs for each of them."""
    return sender


@receiver(order_paid)
def on_paid(sender, **kw):
    return sender


@receiver(signals.order_shipped)
def on_shipped_attr(sender, **kw):
    """The signal named through its module."""
    return sender


def on_closed(sender, **kw):
    return sender


signals.order_closed.connect(on_closed)


# ── NOT receivers, and each would be if one condition were dropped ──────────
def remember(items):
    return lambda f: f


@remember([order_placed, order_shipped])
def not_a_receiver(sender, **kw):
    """A list of signals handed to a decorator that is not a receiver decorator."""
    return sender
