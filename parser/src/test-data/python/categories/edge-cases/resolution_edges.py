"""Hard resolution shapes that are nevertheless FULLY LOCAL.

Every callee here is declared in this file, so an unresolved call is a parser
defect and never an argument about analysis scope. These are the shapes that
usually defeat resolution in real code, reduced until nothing external remains.
"""


class Base:
    def name(self) -> str:
        return "base"

    def shared(self) -> str:
        return "shared"


class Left(Base):
    def name(self) -> str:
        return "left"


class Right(Base):
    def name(self) -> str:
        return "right"


class Diamond(Left, Right):
    """C3 puts Left before Right; `shared` comes from Base through both."""

    def resolve(self) -> str:
        return self.name() + self.shared()


class Shadowing(Base):
    def name(self) -> str:
        # Same selector as the base. super() must reach Base.name, not recurse.
        return "shadow" + super().name()


class SelfInClosure:
    def target(self) -> str:
        return "target"

    def outer(self) -> str:
        def inner():
            # `self` is FREE here, not a parameter — the closure case.
            return self.target()

        return inner()


class ClassMethodFactory:
    def __init__(self, tag: str) -> None:
        self.tag = tag

    @classmethod
    def build(cls) -> "ClassMethodFactory":
        # cls() rather than the class name: construction through the receiver.
        return cls("built")

    def read(self) -> str:
        return self.tag


class Chained:
    def __init__(self) -> None:
        self.count = 0

    def step(self) -> "Chained":
        self.count += 1
        return self

    def total(self) -> int:
        return self.count


class Recursive:
    def down(self, n: int) -> int:
        if n <= 0:
            return 0
        return self.down(n - 1)


class Mutual:
    def ping(self, n: int) -> int:
        return self.pong(n - 1) if n > 0 else 0

    def pong(self, n: int) -> int:
        return self.ping(n - 1) if n > 0 else 0


def exercise() -> str:
    return (
        Diamond().resolve()
        + Shadowing().name()
        + SelfInClosure().outer()
        + ClassMethodFactory.build().read()
        + str(Chained().step().step().total())
        + str(Recursive().down(2))
        + str(Mutual().ping(2))
    )
