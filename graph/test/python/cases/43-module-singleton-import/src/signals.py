"""A module-level value whose name does NOT collide with the module name."""


class Signal:
    def send(self, sender):
        return sender


order_placed = Signal()
