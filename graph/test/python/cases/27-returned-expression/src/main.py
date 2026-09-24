# A function's result is the expression it RETURNS, not every expression written inside it.
import copy
import functools


class Store:
    pass


class Expr:
    def __init__(self):
        self.store = Store()

    # `self` sits inside the return, but the result is a str, not an Expr
    def label(self):
        return str(self.store)

    def copy(self):
        return copy.copy(self)

    # a decoy: `e.label().upper()` must reach str.upper, never this
    def upper(self):
        return self

    def set_sources(self, xs):
        self.xs = xs

    def relabel(self):
        clone = self.copy()
        clone.set_sources([])
        return clone


def defer_result(*resultclasses):
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            return func(*args, **kwargs)
        return wrapper
    return decorator


# returns what the factory's product returns
def defer_text(func):
    return defer_result(str)(func)


class Library:
    def filter(self, name=None, filter_func=None):
        if name is None and filter_func is None:
            def dec(func):
                return self.filter_function(func)
            return dec
        return filter_func

    # returns its argument through another method that returns it
    def filter_function(self, func):
        return self.filter(func.__name__, func)


register = Library()


@defer_text
def capfirst(x):
    return x


@register.filter()
def lower(x):
    return x


def run():
    e = Expr()
    e.relabel()
    text = e.label()
    text.upper()
    capfirst("a")
    lower("b")


run()
