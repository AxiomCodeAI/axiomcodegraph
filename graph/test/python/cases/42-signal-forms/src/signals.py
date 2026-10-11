"""Signals declared in their own module, which every publisher and receiver imports.

The stand-in class keeps the case self-contained: nothing from the framework is staged.
"""


class Signal:
    def send(self, sender, **kw):
        return sender

    def send_robust(self, sender, **kw):
        return sender

    async def asend(self, sender, **kw):
        return sender

    def connect(self, fn, sender=None, **kw):
        return fn


order_placed = Signal()
order_shipped = Signal()
order_paid = Signal()
order_closed = Signal()
order_voided = Signal()
