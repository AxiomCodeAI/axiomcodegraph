import functools
from typing import overload


def module_fn(a, b=1):
    return a + b


class Service:
    @property
    def name(self):
        return self._name

    @name.setter
    def name(self, value):
        self._name = value

    @name.deleter
    def name(self):
        del self._name

    @staticmethod
    def helper(x):
        return x

    @classmethod
    def build(cls, spec):
        return cls()

    @functools.lru_cache(maxsize=None)
    def cached(self, key):
        return key

    @overload
    def get(self, k: int) -> int: ...

    def get(self, k):
        return k

    def __init__(self, name):
        self._name = name

    def __class_getitem__(cls, item):
        return cls

    async def fetch(self, url):
        return url

    def gen(self):
        yield 1

    def outer(self):
        def inner():
            return 1
        return inner


f = lambda x: x + 1
pair = (lambda: 1, lambda: 2)
