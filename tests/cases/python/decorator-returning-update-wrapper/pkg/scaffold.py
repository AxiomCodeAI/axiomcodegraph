import typing as t
from functools import update_wrapper

F = t.TypeVar("F", bound=t.Callable[..., t.Any])


def setupmethod(f: F) -> F:
    f_name = f.__name__

    def wrapper_func(self, *args, **kwargs):
        self._check(f_name)
        return f(self, *args, **kwargs)

    return t.cast(F, update_wrapper(wrapper_func, f))


def plain(f):
    def inner(self, *args):
        return f(self, *args)

    return update_wrapper(inner, f)


class Scaffold:
    def _check(self, n):
        return n

    @setupmethod
    def route(self, rule):
        return self.add(rule)

    @plain
    def other(self, x):
        return x

    def add(self, rule):
        return rule


class App(Scaffold):
    def get(self, rule):
        return self.route(rule)

    def use(self):
        return self.other(1)
