class Base:
    def describe(self):
        return "base"


class Child(Base):
    def describe(self):
        return "child"


class Sibling:
    def describe(self):
        return "sibling"


class Mixed(Child, Sibling):
    def describe(self):
        return super().describe()


class A:
    def m(self):
        return "A"


class B(A):
    pass


class C(A):
    def m(self):
        return "C"


class D(B, C):
    def m(self):
        return super().m()
