from lib import conf


def price(n):
    """A module-level function: it has no owner type, and it reads the field through a variable."""
    return min(n, conf.limit)
