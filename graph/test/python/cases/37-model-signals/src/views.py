"""The code that saves and deletes models, and never names a signal."""
from models import Invoice, Order


def create_order(name):
    return Order.objects.create(name=name)


def rename_order(order: Order, name):
    order.name = name
    order.save()


def drop_order(order: Order):
    order.delete()


def touch_invoice(invoice: Invoice):
    invoice.save()


# ── NOT a model signal, and each would be if one condition were dropped ─────
def save_draft(draft):
    """The receiver's type is unknown: no model, no sender to match."""
    draft.save()


def drop_invoice(invoice: Invoice):
    """Invoice has a post_save receiver and no delete receiver."""
    invoice.delete()


class Cache:
    def save(self):
        return None


def save_cache(cache: Cache):
    """A `save` on a class no receiver names as its sender."""
    cache.save()
