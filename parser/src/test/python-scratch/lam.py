def outer(items):
    return sorted(items, key=lambda item: compute(item.rank))
