"""FAMILY: inheritance, MRO, super(). Every override sits at a known depth."""


class Base:
    def name(self) -> str:
        return "Base"

    def only_base(self) -> str:
        return "Base.only_base"

    def template(self) -> str:
        return "T(" + self.name() + ")"


class Mid(Base):
    def name(self) -> str:
        return "Mid"


class Skip(Mid):
    pass


class Leaf(Skip):
    def name(self) -> str:
        return "Leaf"

    def via_super(self) -> str:
        return "Leaf/" + super().name()


class Square(Base):
    def name(self) -> str:
        return "Square"


class Circle(Base):
    def name(self) -> str:
        return "Circle"


class DiamondL(Base):
    def name(self) -> str:
        return "DiamondL"


class DiamondR(Base):
    def name(self) -> str:
        return "DiamondR"


class Diamond(DiamondL, DiamondR):
    def both(self) -> str:
        return "D/" + super().name()
