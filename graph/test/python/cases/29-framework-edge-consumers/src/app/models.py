"""The publisher: `place` sends the signal, `archive` calls `audit` directly."""

from .handlers import audit
from .signals import order_placed


class Order:
    def place(self):
        order_placed.send(sender=self.__class__)

    def archive(self):
        audit(self)
