from app.audit import audited
from app.guards import guarded


def total(xs):
    return sum(xs)


@audited
def summarise(xs):
    return total(xs)


@audited
def tally(xs):
    return len(xs)


@guarded
def top(xs):
    return max(xs)


@guarded
def bottom(xs):
    return min(xs)


def report(xs):
    return summarise(xs)


def count_all(xs):
    return tally(xs)


def best(xs):
    return top(xs) - bottom(xs)
