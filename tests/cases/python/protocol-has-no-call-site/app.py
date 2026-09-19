"""Methods a language construct runs, which no call site names."""


class Audit:
    def __init__(self, name):
        self.name = name
        self.events = []

    def __enter__(self):
        self.events.append("open")
        return self

    def __exit__(self, *exc):
        self.events.append("close")

    def __iter__(self):
        return iter(self.events)

    def __eq__(self, other):
        return isinstance(other, Audit) and other.name == self.name


class Plain:
    """Constructed too, but it has no protocol members: nothing to reach."""

    def __init__(self, n):
        self.n = n

    def double(self):
        return self.n * 2


def record(name):
    with Audit(name) as a:
        return list(a)


def plain(n):
    return Plain(n).double()
