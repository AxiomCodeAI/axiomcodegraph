"""05 -- super(), zero-argument and two-argument, inside a diamond.

INTENT: this is the highest-value construct in the whole suite. In the engine
prototype, 7 of the 10 unresolved sites were `super()`.

The thing that makes it hard: `super()` in class X does NOT mean "X's base". It
means "the class after X in the MRO of type(self)", and type(self) is not X. In
the diamond below, `super().greet()` written inside `Left` reaches `Right.greet`
when self is a `Both` -- Right is not a base of Left and does not appear
anywhere in Left's own bases. Any rule that reads `super()` as "my base class"
gets this wrong.

The two-argument form `super(Left, self)` is the same lookup written explicitly,
so the two must resolve identically; if they do not, the rule is keying on syntax
rather than on the MRO.
"""


class Root:
    def greet(self):
        return "root"


class Left(Root):
    def greet(self):
        # Zero-arg. With self a Both, this reaches Right.greet, NOT Root.greet.
        return "left>" + super().greet()

    def greet_explicit(self):
        # Two-arg: the identical lookup, spelled out.
        return "left>" + super(Left, self).greet()


class Right(Root):
    def greet(self):
        return "right>" + super().greet()


class Both(Left, Right):
    def greet(self):
        return "both>" + super().greet()


def main():
    print(Both.__mro__)
    print(Both().greet())
    print(Left().greet())
    print(Both().greet_explicit())


if __name__ == "__main__":
    main()
