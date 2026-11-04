def created(x): pass
def updated(x): pass
def on_created(x): created(x)
def on_updated(x): updated(x)


def wire(bus):
    bus.on(lambda x: created(x))
    bus.on(lambda x: updated(x))
    bus.on(on_created)
    bus.on(on_updated)
