"""The publishers, in a third module: a name, a module attribute, and the async form."""
import signals
from signals import order_paid, order_placed, order_voided


def place(order):
    order_placed.send(sender=order)


def ship(order):
    signals.order_shipped.send(sender=order)


async def pay(order):
    await order_paid.asend(sender=order)


def close(order):
    signals.order_closed.send_robust(sender=order)


def void(order):
    """A send nothing is attached to: unjoined, as is the Outbox control below."""
    order_voided.send(sender=order)


class Outbox:
    async def asend(self, sender, **kw):
        return sender


async def not_a_signal(outbox: Outbox, order):
    """An ordinary `asend`: the receiver is not a signal, so no edge (it is listed unjoined)."""
    await outbox.asend(sender=order)
