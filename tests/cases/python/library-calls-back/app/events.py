from hooks import fire, keep


class Listener:
    def on_event(self, e):
        return e


class Kept:
    def on_event(self, e):
        return e


class Other:
    def on_event(self, e):
        return e


def emit():
    fire(Listener())
    keep(Kept())
    return Other()
