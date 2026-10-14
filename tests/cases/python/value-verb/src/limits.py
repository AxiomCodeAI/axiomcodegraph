MAX_ITEMS = 5
API_URL = "https://example.invalid/api"
CONFIG = {"timeout": 30, "retries": 3}


def pick(n):
    return min(n, MAX_ITEMS)


RETRY_LIMIT = pick(3)


class Pager:
    PAGE_SIZE = 50
    MAX_ITEMS = 100

    def fetch(self):
        batch = 10
        return batch * self.PAGE_SIZE
