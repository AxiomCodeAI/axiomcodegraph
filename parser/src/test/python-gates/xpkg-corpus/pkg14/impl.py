from pkg14.base import Base14
from pkg14.util import Mixin14, combine


class Impl14_0(Mixin14, Base14):
    kind = "impl14_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl14_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl14_1(Mixin14, Base14):
    kind = "impl14_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl14_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl14_2(Mixin14, Base14):
    kind = "impl14_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl14_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build14(value: int) -> Impl14_0:
    return Impl14_0(value)
