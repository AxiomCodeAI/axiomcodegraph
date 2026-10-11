from signals import order_placed


def publish(sender):
    return order_placed.send(sender)
