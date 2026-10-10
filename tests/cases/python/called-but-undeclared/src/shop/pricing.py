from shop.rates import vat_rate


def total(items):
    net = sum(i.price for i in items)
    return apply_discount(net) * (1 + vat_rate())


def invoice(items):
    return {"total": total(items), "net": apply_discount(sum(i.price for i in items))}
