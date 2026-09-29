from app.orders import Order, apply_discount, apply_tax

def checkout(price: float):
    return apply_discount(price)

def checkout_taxed(price: float):
    return apply_tax(price)

def show(order: Order):
    return order.grand_total, order.net_total
