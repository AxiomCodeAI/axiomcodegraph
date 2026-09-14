"""Support module for FAMILY 38 — three classes called `Inner` in one module, one of
them at top level and two nested. The collision is the point: a bare `Inner` can only
mean the top-level one, and `Outer.Inner` can only mean the nested one."""


class Inner:
    def run(self) -> str:
        return "module-level Inner"


class Outer:
    class Inner:
        def run(self) -> str:
            return "Outer.Inner"

    class Middle:
        class Deep:
            def run(self) -> str:
                return "Outer.Middle.Deep"

    def make_nested(self) -> str:
        return Outer.Inner().run()


class Other:
    class Inner:
        def run(self) -> str:
            return "Other.Inner"


class Config:
    """The `class Meta:` shape — the commonest nested class in the wild. One project in
    the measured corpus declares `Meta` 1,107 times, so a module with several models has
    several `Meta`s and a bare `Meta` lookup returned all of them."""

    class Meta:
        def label(self) -> str:
            return "Config.Meta"


class Profile:
    class Meta:
        def label(self) -> str:
            return "Profile.Meta"


try:                       # a class in a TRY block is not nested in anything
    class Conditional:
        def run(self) -> str:
            return "Conditional"
except ImportError:        # pragma: no cover
    Conditional = None     # type: ignore[assignment]


if True:                   # nor is one inside an `if`
    class Guarded:
        def run(self) -> str:
            return "Guarded"
