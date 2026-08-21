from typing import Optional


class Repo:
    registry: dict = {}

    def __init__(self, conn: Optional[str] = None):
        self.conn = conn
        self.cache = {}

    def use(self, other):
        if isinstance(other, Repo):
            self.conn = other.conn
        self.cache["k"] = 1
        return self.conn
