"""The signal object, in its own module, imported by both ends."""

from django.dispatch import Signal

order_placed = Signal()
