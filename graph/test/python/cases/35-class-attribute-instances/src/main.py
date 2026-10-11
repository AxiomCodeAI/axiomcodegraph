from shop.models import Order, list_via_class


def run():
    list_via_class()
    return Order.objects.open_orders()
