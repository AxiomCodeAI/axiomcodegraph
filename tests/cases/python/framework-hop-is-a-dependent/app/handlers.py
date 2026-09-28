from django.dispatch import receiver

from .signals import order_placed


@receiver(order_placed)
def on_placed(sender, **kwargs):
    return sender


def audit(order):
    return order
