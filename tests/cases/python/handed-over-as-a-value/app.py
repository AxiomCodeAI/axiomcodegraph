"""A callable handed to a framework as a VALUE, which the framework calls later."""


def provider():
    """Passed to Depends(...) and never called by name anywhere."""
    return {"limit": 10}


def receipt(order_id):
    """Handed to a background-task queue, called after the response."""
    return f"receipt for {order_id}"


def unused_helper():
    """Named nowhere: a change here reaches nothing."""
    return 0


class Depends:
    def __init__(self, fn):
        self.fn = fn


class Tasks:
    def __init__(self):
        self.queued = []

    def add_task(self, fn, *args):
        self.queued.append((fn, args))


def create_order(order_id, conf=Depends(provider)):
    tasks = Tasks()
    tasks.add_task(receipt, order_id)
    return {"id": order_id, "limit": conf.fn()["limit"], "queued": len(tasks.queued)}
