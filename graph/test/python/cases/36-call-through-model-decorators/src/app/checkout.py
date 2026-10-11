from app.orders import Order, apply_coupon, apply_discount, apply_tax, replaced


def checkout(price: float):
    return apply_discount(price)


def checkout_coupon(price: float):
    return apply_coupon(price)


def checkout_taxed(price: float):
    return apply_tax(price)


def checkout_replaced(price: float):
    return replaced(price)


def show(order: Order):
    return order.grand_total.hex(), order.tax_due, order.net_total
