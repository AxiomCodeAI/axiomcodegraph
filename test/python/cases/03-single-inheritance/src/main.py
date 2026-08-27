"""03 -- single inheritance. An override, and the call that reaches the base.

INTENT: `self.step()` inside `Base.run` is NOT a call to `Base.step`. It is a
call to whatever the runtime type provides, and here that is `Derived.step`.
An engine that answers `Base.step` is wrong in a way that looks right, which is
why the oracle's own tier-3 answer for this shape is a dispatch set and tier 4
is what proves which member actually ran.

`Derived.only_here` has no override anywhere, so it is the control: a genuinely
single-target virtual call.
"""


class Base:
    def run(self):
        # Dispatches on the runtime type, not on `Base`.
        return self.step() + self.fixed()

    def step(self):
        return 1

    def fixed(self):
        # No subclass overrides this, so it really does resolve to one target.
        return 100


class Derived(Base):
    def step(self):
        # The override that `Base.run` actually reaches.
        return 2

    def only_here(self):
        return self.run()


def main():
    print(Base().run())
    print(Derived().run())
    print(Derived().only_here())


if __name__ == "__main__":
    main()
