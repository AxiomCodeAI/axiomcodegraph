from pkg34.base import Base34
from pkg34.util import Mixin34, combine


class Impl34_0(Mixin34, Base34):
    kind = "impl34_0"

    def weight(self) -> int:
        return combine(super().weight(), 1)

    def chain(self) -> "Impl34_0":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl34_1(Mixin34, Base34):
    kind = "impl34_1"

    def weight(self) -> int:
        return combine(super().weight(), 2)

    def chain(self) -> "Impl34_1":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


class Impl34_2(Mixin34, Base34):
    kind = "impl34_2"

    def weight(self) -> int:
        return combine(super().weight(), 3)

    def chain(self) -> "Impl34_2":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


def build34(value: int) -> Impl34_0:
    return Impl34_0(value)
