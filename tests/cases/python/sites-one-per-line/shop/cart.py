from shop.pricing import total


def checkout(items):
    return total(items)


def receipt(items):
    return "paid " + str(checkout(items))
