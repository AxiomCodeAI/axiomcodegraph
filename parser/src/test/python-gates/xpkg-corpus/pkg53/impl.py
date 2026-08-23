from pkg53.base import Base53
from pkg53.util import Mixin53, combine


class Impl53_0(Mixin53, Base53):
    kind = "impl53_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl53_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl53_1(Mixin53, Base53):
    kind = "impl53_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl53_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl53_2(Mixin53, Base53):
    kind = "impl53_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl53_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build53(value: int) -> Impl53_0:
    return Impl53_0(value)
