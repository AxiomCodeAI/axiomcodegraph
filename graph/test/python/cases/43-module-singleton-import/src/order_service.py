"""A module-level singleton named after its own module — the ordinary idiom.

`from order_service import order_service` must bind the VALUE, not suffix-match
back to this module and report a module import (#1140).
"""


class OrderService:
    def cancel(self, oid):
        return oid

    def refund(self, oid):
        return oid


order_service = OrderService()


def same_module_caller(oid):
    return order_service.cancel(oid)
