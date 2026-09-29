from gateway import Gateway, Mailer


class Billing:
    def __init__(self, gw: Gateway):
        self.gw = gw

    def bill(self, amount):
        return self.gw.charge(amount)


class Router:
    def __init__(self, handlers):
        self.handlers = handlers

    def on_refund(self, event):
        return event

    def route(self, event):
        kind = event["kind"]
        return getattr(self, f"on_{kind}")(event)


def settle(m: Mailer):
    return m.charge(5)


class Refunds:
    def __init__(self, gw):
        self.gw = gw

    def undo(self, amount):
        return self.gw.charge(-amount)
