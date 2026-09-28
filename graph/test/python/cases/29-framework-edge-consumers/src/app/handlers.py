"""The receiver of order_placed, and `audit`, an ordinary callee beside it (the control
that keeps its resolved edge and gains no framework row)."""

from django.dispatch import receiver

from .signals import order_placed


@receiver(order_placed)
def on_placed(sender, **kwargs):
    return sender


def audit(order):
    return order
