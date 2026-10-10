from loader import load

tools = load()


@tools.registered("order-created")
def on_order_created(order):
    return order


def dispatch(kind, payload):
    return tools.REGISTRY[kind](payload)
