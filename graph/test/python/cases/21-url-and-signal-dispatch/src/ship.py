"""The publisher, in a third module, importing the same signal."""
from signals import shipped


def ship_order(order):
    shipped.send(sender=order)
