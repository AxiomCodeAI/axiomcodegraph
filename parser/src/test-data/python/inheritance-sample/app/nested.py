"""Nested classes and a class defined inside a function."""


class Outer:
    class Inner:
        class Deepest:
            def ping(self):
                return 'deep'

        def make_deepest(self) -> 'Outer.Inner.Deepest':
            return Outer.Inner.Deepest()          # dotted nested constructor

    def build(self):
        inner = Outer.Inner()                     # nested constructor, NAME receiver
        return inner.make_deepest()               # -> Outer.Inner.make_deepest


def factory():
    class Local:
        def run(self):                            # a method, NOT a nested function
            return self.helper()

        def helper(self):
            return 1

    return Local
