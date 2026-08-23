from pkg18.base import Base18
from pkg18.util import Mixin18, combine


class Impl18_0(Mixin18, Base18):
    kind = "impl18_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl18_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl18_1(Mixin18, Base18):
    kind = "impl18_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl18_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl18_2(Mixin18, Base18):
    kind = "impl18_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl18_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build18(value: int) -> Impl18_0:
    return Impl18_0(value)
