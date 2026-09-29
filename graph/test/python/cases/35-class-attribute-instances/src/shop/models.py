"""35 -- a class attribute holding an instance, reached on the CLASS (#1518).

INTENT: `objects = OrderManager()` in a class body puts one OrderManager on the
class object, so `Order.objects.open_orders()` calls OrderManager.open_orders
exactly as `Order().objects.open_orders()` does. The instance spelling was typed
and the class spelling was not.

Controls:
  audit        written through `self` in __init__: it exists on instances only,
               so `Order.audit` names nothing the class holds and stays untyped
  SpecialOrder inherits `objects`, so the class spelling on the subclass reaches
               the same manager through the MRO
  kind         a class-body assignment of a string: no construction, no type
"""


class OrderManager:
    def open_orders(self):
        return []


class AuditLog:
    def entries(self):
        return []


class Order:
    objects = OrderManager()
    kind = "order"

    def __init__(self):
        self.audit = AuditLog()


class SpecialOrder(Order):
    pass


def list_via_class():
    return Order.objects.open_orders()


def list_via_instance():
    return Order().objects.open_orders()


def list_via_subclass():
    return SpecialOrder.objects.open_orders()


def audit_via_class():
    # Near miss: an instance-only attribute read on the class.
    return Order.audit.entries()


def kind_via_class():
    # Near miss: a class-body value that is not a construction.
    return Order.kind.upper()
