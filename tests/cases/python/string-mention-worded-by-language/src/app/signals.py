def on_saved(order):
    return order


def on_deleted(order):
    return order


def connect(bus):
    bus.subscribe("order_saved", on_saved, uid="on_saved")
    bus.subscribe("order_saved", on_saved, name="on_saved")
    bus.subscribe("order_deleted", on_deleted)
