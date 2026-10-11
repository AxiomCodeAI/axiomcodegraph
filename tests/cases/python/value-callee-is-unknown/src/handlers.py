import os

from pydantic import BaseModel


def alpha():
    return 1


def pure():
    return 2


def direct():
    return alpha()


def joins(parts):
    return os.path.join(*parts)


def invoke(cb):
    return cb()


def run_list(fns):
    for f in fns:
        f()


def dispatch(table, key):
    return table[key]()


def via_local(name):
    fn = globals().get(name)
    return fn()


class Machine:
    def fire(self, event):
        hook = getattr(self, event, None)
        if hook is not None:
            hook()

    def fire_now(self, event):
        return getattr(self, "on_" + event)()

    def on_go(self):
        return 3


class Scoring:
    def __init__(self, scorers):
        self.scorers = scorers

    def assess(self, ctx):
        return [scorer(ctx) for scorer in self.scorers]


class Hooked:
    def __init__(self, cb):
        self.cb = cb

    def run(self):
        return self.cb()


class Money(BaseModel):
    amount: int

    @classmethod
    def of(cls, amount: int) -> "Money":
        return cls(amount=amount)
