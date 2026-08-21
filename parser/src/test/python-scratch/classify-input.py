import abc
import enum
from abc import ABC, ABCMeta
from enum import Enum, EnumMeta


class ClassicABC(metaclass=ABCMeta):
    pass


class ClassicABC2(metaclass=abc.ABCMeta):
    pass


class FunctionalEnum(metaclass=EnumMeta):
    RED = 1


class RealABC(abc.ABC):
    pass


class RealEnum(enum.Enum):
    RED = 1


class Plain:
    pass


class PlainWithMeta(metaclass=type):
    pass
