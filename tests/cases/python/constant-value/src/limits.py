MAX_ITEMS = 5
TIER_NAME = 'gold'
ENABLED = True


def pick(n):
    return min(n, MAX_ITEMS)


RETRY_LIMIT = pick(3)

WINDOW = (
    60)
