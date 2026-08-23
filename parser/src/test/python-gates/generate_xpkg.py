"""
Generates a LARGE closed-world Python project for linkage measurement.

Generated rather than hand-written for three reasons. It can be scaled without
re-authoring; every construct appears many times, so one lucky case cannot carry
a percentage; and the expected linkage is a property of the GENERATOR, not of a
human's belief about the output.

Closed world is the point: nothing outside the tree is imported, so every call
site must resolve to something in the corpus. That makes the ceiling 100% by
construction rather than by assertion, and any unlinked call is a defect rather
than a judgement call about an external package.

Every linkage shape the parser has to get right appears here, at scale:

  - cross-package inheritance, several levels deep
  - `import pkg.mod` / `from pkg.mod import X` / `from pkg import mod`
  - aliased imports, re-exports through __init__, relative imports, star imports
  - fluent chains that return self, and chains across package boundaries
  - classmethod factories and alternate constructors
  - annotated parameters and annotated returns driving dispatch
  - properties, staticmethods, classmethods
  - multiple inheritance with mixins
  - module-level singletons dispatched through

The whole project RUNS and terminates, so CPython's tracer can supply the
ground truth for which target each call site actually reaches.
"""
import os
import shutil
import sys

PACKAGES = int(sys.argv[2]) if len(sys.argv) > 2 else 60
IMPLS_PER_PACKAGE = 3


def write(root, relative, text):
    path = os.path.join(root, relative)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as handle:
        handle.write(text)


CHAIN = 6


def gen_base(index):
    prev = index - 1
    # Chains restart every CHAIN packages. A single 60-deep chain is both
    # unrealistic and un-importable -- CPython hits its recursion limit walking
    # it -- while many independent chains of six exercise the same cross-package
    # inheritance resolution far more times.
    if index % CHAIN == 0:
        header = ''
        parent = 'object'
    else:
        # Cross-package inheritance: each package's base extends the previous
        # package's base, producing chains as deep as the package count.
        header = 'from pkg%02d.base import Base%02d\n' % (prev, prev)
        parent = 'Base%02d' % prev
    return '''%sfrom pkg%02d.util import decorate


class Base%02d(%s):
    """Depth %d in a cross-package inheritance chain."""

    kind = "base%02d"

    def __init__(self, value: int):
        %s
        self.value = value

    def describe(self) -> str:
        return decorate(self.kind, self.value)

    def weight(self) -> int:
        return %d

    def combined(self) -> int:
        return self.weight() + self.value

    @property
    def label(self) -> str:
        return self.kind.upper()

    @staticmethod
    def origin() -> str:
        return "pkg%02d"

    @classmethod
    def of(cls, value: int) -> "Base%02d":
        return cls(value)
''' % (
        header, index, index, parent, index, index,
        ('super().__init__(value)' if index % CHAIN else 'self.base = value'),
        index + 1, index, index,
    )


def gen_util(index):
    return '''def decorate(kind: str, value: int) -> str:
    return "[" + kind + ":" + str(value) + "]"


def combine(left: int, right: int) -> int:
    return left + right


class Mixin%02d:
    """Supplies behaviour only when combined with a Base."""

    def boosted(self) -> int:
        return self.weight() * 2
''' % index


def gen_impl(index):
    parts = ['from pkg%02d.base import Base%02d\n' % (index, index),
             'from pkg%02d.util import Mixin%02d, combine\n\n\n' % (index, index)]
    for k in range(IMPLS_PER_PACKAGE):
        parts.append('''class Impl%02d_%d(Mixin%02d, Base%02d):
    kind = "impl%02d_%d"

    def weight(self) -> int:
        return combine(super().weight(), %d)

    def chain(self) -> "Impl%02d_%d":
        self.value = self.value + 1
        return self

    def report(self) -> str:
        return self.describe() + self.label


''' % (index, k, index, index, index, k, k + 1, index, k))
    parts.append('''def build%02d(value: int) -> Impl%02d_0:
    return Impl%02d_0(value)
''' % (index, index, index))
    return ''.join(parts)


def gen_init(index):
    names = ', '.join('Impl%02d_%d' % (index, k) for k in range(IMPLS_PER_PACKAGE))
    return '''from pkg%02d.base import Base%02d
from pkg%02d.impl import %s, build%02d

__all__ = ["Base%02d", %s, "build%02d"]
''' % (
        index, index, index, names, index, index,
        ', '.join('"Impl%02d_%d"' % (index, k) for k in range(IMPLS_PER_PACKAGE)),
        index,
    )


def gen_service(index):
    # Never wrap around: pkg00 importing pkg59 would make the whole corpus one
    # import cycle, which tests the importer rather than the parser.
    prev = index - 1 if index % CHAIN else index
    return '''import pkg%02d.impl
from pkg%02d import build%02d
from pkg%02d.base import Base%02d as Alias%02d
from .util import combine
from pkg%02d.impl import *


class Service%02d:
    def __init__(self):
        self.items = []
        self.primary: Alias%02d = build%02d(%d)

    def add(self, item: Alias%02d) -> "Service%02d":
        self.items.append(item)
        return self

    def seed(self) -> "Service%02d":
        return self.add(pkg%02d.impl.Impl%02d_1(2)).add(build%02d(3))

    def total(self) -> int:
        running = self.primary.combined()
        for item in self.items:
            running = combine(running, item.weight())
        return running

    def fluent(self) -> int:
        return self.seed().add(self.primary).total()

    def via_factory(self) -> str:
        return Alias%02d.of(4).describe()

    def via_property(self) -> str:
        return self.primary.label

    def via_static(self) -> str:
        return Alias%02d.origin()

    def via_mixin(self) -> int:
        return self.primary.boosted()

    def deep_chain(self) -> str:
        return self.primary.chain().chain().report()


SINGLETON = Service%02d()


def run%02d() -> list:
    service = Service%02d()
    return [
        service.fluent(),
        service.via_factory(),
        service.via_property(),
        service.via_static(),
        service.via_mixin(),
        service.deep_chain(),
        SINGLETON.total(),
    ]
''' % (
        index, index, index, prev, prev, prev, index, index,
        prev, index, index + 1, prev, index, index, index, index, index,
        prev, prev, index, index, index,
    )


def main():
    root = sys.argv[1]
    if os.path.isdir(root):
        shutil.rmtree(root)
    for index in range(PACKAGES):
        write(root, 'pkg%02d/__init__.py' % index, gen_init(index))
        write(root, 'pkg%02d/util.py' % index, gen_util(index))
        write(root, 'pkg%02d/base.py' % index, gen_base(index))
        write(root, 'pkg%02d/impl.py' % index, gen_impl(index))
        write(root, 'pkg%02d/service.py' % index, gen_service(index))

    imports = '\n'.join(
        'from pkg%02d.service import run%02d' % (i, i) for i in range(PACKAGES)
    )
    calls = ',\n        '.join('run%02d()' % i for i in range(PACKAGES))
    write(root, 'driver.py', '''%s


def run_all() -> list:
    return [
        %s,
    ]
''' % (imports, calls))
    write(root, 'main.py', '''from driver import run_all

if __name__ == "__main__":
    result = run_all()
    print(len(result))
''')


if __name__ == '__main__':
    main()
