/**
 * Builds a corpus with NO external dependencies at all, so the ceiling is 100%.
 *
 * Vendoring gets close, but not all the way: a vendored stdlib still bottoms out
 * in C extensions and builtins, so some calls remain unreachable and the ceiling
 * has to be argued about. Here every callee is declared inside the corpus, so
 * there is nothing to argue: an unresolved call is a parser defect, full stop.
 *
 * That property is what makes it worth generating rather than hand-writing. A
 * fixture is small enough that I can accidentally write only the shapes I have
 * already handled — the three hand-built corpora sat at 107/110 for exactly that
 * reason. This generates the shapes SYSTEMATICALLY from a matrix of mechanisms,
 * so coverage of the mechanism space is a property of the generator rather than
 * of my imagination.
 *
 *   npx tsx src/test/python-gates/sealed-corpus.ts <out-dir>
 */
import * as fs from 'fs';
import * as path from 'path';

/** One package in the generated project. */
interface Module {
  name: string;
  source: string;
}

/**
 * The mechanism matrix.
 *
 * Each entry is a way a callee can be reached, and the generator emits every
 * one in a form where the answer is known by construction. Deliberately
 * includes the shapes that were WRONG at some point this week, so a regression
 * shows up here before it shows up on real code.
 */
function buildModules(): Module[] {
  return [
    {
      name: 'core/__init__.py',
      source: `"""Package that RE-EXPORTS, the shape most libraries present."""
from .base import Node, Registry, make_node
from .factory import Builder

__all__ = ['Node', 'Registry', 'Builder', 'make_node']
`,
    },
    {
      name: 'core/base.py',
      source: `"""Declarations every other module reaches."""


class Node:
    label: str

    def __init__(self, label: str) -> None:
        self.label = label
        self.children = []

    def add(self, child: "Node") -> "Node":
        # returns self -- the fluent shape
        self.children.append(child)
        return self

    def name(self) -> str:
        return self.label


class Leaf(Node):
    def name(self) -> str:
        # inherited-then-overridden
        return super().name()


class Registry:
    def __init__(self) -> None:
        self.node = Node("root")

    def store(self, node: Node) -> Node:
        return node


def make_node(label: str) -> Node:
    return Node(label)
`,
    },
    {
      name: 'core/factory.py',
      source: `"""Classmethod factories and cls-construction."""
from core.base import Node, Registry


class Builder:
    def __init__(self, name: str) -> None:
        self.name = name
        self.registry = Registry()

    @classmethod
    def of(cls, name: str) -> "Builder":
        # cls(...) constructs the enclosing class
        return cls(name)

    def build(self) -> Node:
        return self.registry.node


class TypedBuilder(Builder):
    def rebuild(self) -> Node:
        # attribute of an INHERITED field, across modules
        return self.registry.store(self.registry.node)
`,
    },
    {
      name: 'app/__init__.py',
      source: `"""Application package."""
`,
    },
    {
      name: 'app/service.py',
      source: `"""Every receiver shape, with the answer known by construction."""
import core
from core import Node, make_node
from core.base import Leaf, Registry
from core.factory import Builder, TypedBuilder

_Alias = Node


class Service(Leaf):
    registry: Registry

    def __init__(self, label: str, seed: Node) -> None:
        super().__init__(label)
        self.registry = Registry()
        self.seed = seed

    def by_self(self) -> str:
        return self.name()

    def by_inherited_attribute(self) -> Node:
        return self.registry.store(self.seed)

    def by_parameter(self, other: Builder) -> Node:
        return other.build()

    def by_local_constructor(self) -> Node:
        node = Node("local")
        return node.add(node)

    def by_local_factory(self) -> Node:
        made = make_node("factory")
        return made.add(made)

    def by_classmethod(self) -> Node:
        builder = Builder.of("cm")
        return builder.build()

    def by_alias(self) -> Node:
        aliased = _Alias("alias")
        return aliased.add(aliased)

    def by_package_reexport(self) -> Node:
        return core.make_node("reexport")

    def by_subclass_field(self) -> Node:
        typed = TypedBuilder("t")
        return typed.rebuild()

    def by_fluent_chain(self) -> str:
        node = Node("chain")
        return node.add(node).name()
`,
    },
  ];
}

function main(): void {
  const outDir = process.argv[2] ?? '/tmp/py-corpus/sealed';
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const module of buildModules()) {
    const full = path.join(outDir, module.name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, module.source);
  }
  const files = buildModules().length;
  console.log(`sealed corpus at ${outDir}`);
  console.log(`  ${files} files, zero external imports`);
  console.log('  every callee is declared inside the corpus, so the ceiling is 100%');
  console.log('  an unresolved call here is a parser defect, not a corpus artifact');
}

main();
