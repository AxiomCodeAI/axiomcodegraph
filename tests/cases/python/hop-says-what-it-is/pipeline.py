"""A chain whose hops are four different relations, so a chain that prints them all the same
is visibly wrong: a decorator application, a construction, an ordinary call, and a closure
written inside a body (which is not a call at all)."""


def audited(fn):
    def wrapper(*a, **kw):
        return fn(*a, **kw)
    return wrapper


class Store:
    def __init__(self, name):
        self.name = name
        self.rows = []

    def put(self, row):
        self.rows.append(row)


class Service:
    def __init__(self):
        self.store = Store("main")

    @audited
    def add(self, row):
        self.store.put(row)


def run():
    svc = Service()
    svc.add("a")
    return svc
