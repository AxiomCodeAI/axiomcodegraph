import abc
import collections.abc
import enum


class Plain:
    pass


class Derived(Plain):
    pass


class Multi(Plain, collections.abc.Mapping, metaclass=abc.ABCMeta):
    def __getitem__(self, k): ...
    def __iter__(self): ...
    def __len__(self): ...


class Color(enum.Enum):
    RED = 1


class Abstract(abc.ABC):
    @abc.abstractmethod
    def run(self): ...


class MyError(ValueError):
    pass
