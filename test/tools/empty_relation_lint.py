#!/usr/bin/env python3
"""Fail if any reader takes the header off a CSV with an unguarded `next()`.

A relation with NO ROWS is written as a ZERO-BYTE file — not a header, zero bytes — so
`h = next(reader)` raises StopIteration. In schema_drift.py that propagated out and the
TypeScript harness reported "refusing to measure against a drifted schema": the one failure
mode that gate exists to catch, and not what had happened. Ten such files appear on a project
small enough to have no enums, no decorators and no type parameters. See issue #244.

WHY AN AST LINT AND NOT A GREP. The safe forms are `next(r, None)` and a `try/except
StopIteration`, and both are ordinary code a text search cannot tell from the unsafe form
without reimplementing Python's grammar. This walks the tree instead: a one-argument `next()`
call, in a file that reads CSVs, not lexically inside a `try`. That is exactly the unsafe shape
and nothing else.

Three sites had it and one (lib_names.py) was already guarded, which is the pattern this whole
area keeps repeating: the same defect in several places, fixed in the one that happened to
crash. #238 was reported in 5 files and was live in 18.

usage: empty_relation_lint.py <root>        exit 0 clean / 1 on an unguarded next()
"""
import ast
import os
import re
import sys


class Finder(ast.NodeVisitor):
    """Collect one-argument next() calls that are not inside a try block."""

    def __init__(self):
        self.hits = []
        self._try_depth = 0

    def visit_Try(self, node):
        self._try_depth += 1
        self.generic_visit(node)
        self._try_depth -= 1

    def visit_Call(self, node):
        if (isinstance(node.func, ast.Name) and node.func.id == 'next'
                and len(node.args) == 1 and not node.keywords
                and self._try_depth == 0):
            self.hits.append(node.lineno)
        self.generic_visit(node)


def main() -> int:
    root = sys.argv[1] if len(sys.argv) > 1 else '.'
    bad = []
    scanned = 0
    for base in ('src', 'test'):
        for dirpath, dirnames, names in os.walk(os.path.join(root, base)):
            dirnames[:] = [d for d in dirnames if d not in ('__pycache__', '.git', 'node_modules')]
            for n in sorted(names):
                if not n.endswith('.py'):
                    continue
                p = os.path.join(dirpath, n)
                src = open(p, encoding='utf-8', errors='replace').read()
                # Only files that actually CALL a csv reader; `next()` on a generator elsewhere
                # is fine. The open paren matters: this file mentions the names in its own
                # detection strings, and so would match itself on a bare-name test.
                if not re.search(r'_?csv\.(reader|DictReader)\(', src):
                    continue
                scanned += 1
                try:
                    tree = ast.parse(src)
                except SyntaxError as e:
                    bad.append(f'{os.path.relpath(p, root)}: will not parse: {e}')
                    continue
                f = Finder()
                f.visit(tree)
                for line in f.hits:
                    bad.append(f'{os.path.relpath(p, root)}:{line}: unguarded next() — a '
                               f'zero-byte relation raises StopIteration here')

    if bad:
        print('EMPTY-RELATION LINT: an unguarded next() takes down a reader on a relation '
              'that simply has no rows')
        for b in bad:
            print(f'    {b}')
        print('  use next(r, None) — or try/except StopIteration, as tools/lib_names.py does.')
        return 1
    print(f'empty-relation lint: ok ({scanned} CSV readers, no unguarded next())')
    return 0


if __name__ == '__main__':
    sys.exit(main())
