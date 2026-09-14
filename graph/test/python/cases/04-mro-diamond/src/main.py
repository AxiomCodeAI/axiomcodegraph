"""04 -- a diamond where DEPTH-FIRST AND C3 DISAGREE. The divergence IS the test.

    class A:            who -> "A"
    class B(A):         (no who)
    class C(A):         who -> "C"
    class D(B, C):      (no who)

  depth-first, left to right:   D, B, A, C      -> D().who() finds A.who
  C3 (what CPython does):       D, B, C, A      -> D().who() finds C.who

A resolver that walks bases naively answers `A.who` here and is wrong. The two
orders differ ONLY because C3 defers a class until every subclass of it has been
placed, which is precisely the rule being scored. `cls.__mro__` is pinned as the
ground truth rather than re-derived -- a bug in a re-derivation of C3 would
become a bug in the answer.
"""


class A:
    def who(self):
        return "A"

    def shared(self):
        return "A.shared"


class B(A):
    def shared(self):
        return "B.shared"


class C(A):
    def who(self):
        # C3 reaches this; depth-first reaches A.who instead.
        return "C"

    def shared(self):
        return "C.shared"


class D(B, C):
    def report(self):
        # Both of these are decided by D's C3 linearisation, not by D's bases.
        return self.who() + "/" + self.shared()


def main():
    print(D.__mro__)
    print(D().who())
    print(D().report())


if __name__ == "__main__":
    main()
