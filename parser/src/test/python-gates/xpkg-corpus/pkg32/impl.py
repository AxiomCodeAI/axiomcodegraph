from pkg32.base import Base32
from pkg32.util import Mixin32, combine


class Impl32_0(Mixin32, Base32):
    kind = "impl32_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl32_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl32_1(Mixin32, Base32):
    kind = "impl32_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl32_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl32_2(Mixin32, Base32):
    kind = "impl32_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl32_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build32(value: int) -> Impl32_0:
    return Impl32_0(value)
