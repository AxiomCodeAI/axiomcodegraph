def limit():
    """A module-level function, and Conf declares an attribute of the same name."""
    return 5


class Conf:
    def __init__(self):
        self.limit = limit()

    def show(self):
        return self.limit
