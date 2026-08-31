"""FAMILY 13 — a receiver known only by DECLARATION.

declared_dispatch widens a declared type over its subclasses, but only those CONSTRUCTED
in the analysed code. That bound is right for an application and wrong for a library
analysed on its own: subclasses are DEFINED here and constructed by callers, so the
instantiation set is empty for exactly the classes that matter and the answer collapses to
the base — which, for a base that only raises, is the one method that provably never runs.

Nothing below constructs Impl through a path RTA can see; `main` passes them in, which is
how a framework is actually used.
"""


class Loader:
    def load(self, name: str) -> str:
        raise NotImplementedError

    def describe(self) -> str:
        return "loader"


class FileLoader(Loader):
    def load(self, name: str) -> str:
        return "file:" + name


class DictLoader(Loader):
    def load(self, name: str) -> str:
        return "dict:" + name


class Engine:
    """`self.loader` carries a declared annotation and is assigned from a parameter, so
    nothing pins it to a concrete class."""
    def __init__(self, loader: "Loader") -> None:
        self.loader: Loader = loader

    def run(self, name: str) -> str:
        return self.loader.load(name)          # field typed by annotation


def via_parameter(loader: Loader, name: str) -> str:
    return loader.load(name)                   # parameter typed by annotation


def via_parameter_inherited(loader: Loader) -> str:
    return loader.describe()                   # NOT overridden — must stay a single target


class Base:
    def run(self) -> str:
        return self.step()                     # SELF call, overridden below

    def step(self) -> str:
        raise NotImplementedError


class StepA(Base):
    def step(self) -> str:
        return "A"


class StepB(Base):
    def step(self) -> str:
        return "B"


def exact_receiver_is_not_widened() -> str:
    """A construction flows into `f`, so the exact type wins and this must NOT fan."""
    f = FileLoader()
    return f.load("x")
