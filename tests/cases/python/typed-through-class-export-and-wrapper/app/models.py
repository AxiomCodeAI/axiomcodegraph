class OrderManager:
    def open_orders(self):
        return []


class AuditLog:
    def entries(self):
        return []


class Order:
    objects = OrderManager()

    def __init__(self):
        self.audit = AuditLog()


def list_via_class():
    return Order.objects.open_orders()


def list_via_instance():
    return Order().objects.open_orders()


def audit_via_class():
    return Order.audit.entries()
