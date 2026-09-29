def price(amount):
    return round(amount * 1.2, 2)


def discount(amount):
    return round(price(amount) * 0.9, 2)
