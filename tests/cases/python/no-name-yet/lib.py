def clamp(n):
    return max(n, 0)


def apply_discount(total, pct):
    return clamp(total - (total * pct) // 100)


def price_order(total, pct):
    return apply_discount(total, pct)


def unrelated(x):
    return x
