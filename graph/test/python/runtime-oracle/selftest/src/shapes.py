"""Every construct the folds in normalize.py exist for, in one file.

Line numbers matter here: the expectations in expected.tsv name them.
"""
import functools


def trace(fn):
    @functools.wraps(fn)
    def wrapper(*a, **kw):
        return fn(*a, **kw)
    return wrapper


class Greeter:
    salutation = 'hello'

    def greet(self, who):
        return self.render(who)

    def render(self, who):
        return '%s %s' % (self.salutation, who)

    @property
    def name(self):
        return 'greeter'

    @staticmethod
    def shout(text):
        return text.upper()

    @classmethod
    def of(cls):
        return cls()


class Loud(Greeter):
    def render(self, who):
        return Greeter.shout(super().render(who))


@trace
def decorated(who):
    return Greeter().greet(who)


def squares(n):
    return [double(i) for i in range(n)]


def double(i):
    return i * 2


def each(items, fn):
    return [fn(i) for i in items]


def run():
    out = []
    out.append(Greeter().greet('world'))
    out.append(Loud().greet('world'))
    out.append(decorated('world'))
    out.append(squares(3))
    out.append(each([1, 2], lambda i: double(i)))
    out.append(Greeter.of().name)
    return out
