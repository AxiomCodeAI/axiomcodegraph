"""
Ground truth for py_scope and py_binding, from CPython's own symtable.

Reads a newline-delimited list of file paths on stdin, writes one JSON object
per file to stdout.

WHY THIS IS NOT A PLAIN symtable DUMP
-------------------------------------
symtable is authoritative for the scope TREE and for every symbol flag, but on
3.10 a SymbolTable carries only `lineno` -- there is no column offset (checked:
`_table` exposes children/id/lineno/name/nested/symbols/type/varnames and
nothing else). Two lambdas or two comprehensions on one line are therefore
indistinguishable by symtable alone, and those collisions are common in real
code.

So columns have to come from a separate `ast` walk, and the two walks have to
be zipped. The trap is that CPython does NOT create comprehension blocks in
source order:

    [a for a in [b for b in q]]

`symtable_handle_comprehension` visits the OUTERMOST ITERABLE in the enclosing
scope before entering the comprehension's own block, so the inner listcomp's
block is created FIRST and both are children of the enclosing function -- they
are siblings, not parent and child. A zip that assumed source order would pair
every such scope with its neighbour's position and report a mirror-image pair
of BIND_MISSING/BIND_SPURIOUS against a parser that was right. This walk
mirrors symtable.c's visit order instead, and asserts the zip agrees on kind
and name at every position (GATE_DESYNC) rather than trusting it.
"""
import ast
import json
import symtable
import sys

SYM_KIND = {
    'listcomp': 'COMPREHENSION_LIST',
    'setcomp': 'COMPREHENSION_SET',
    'dictcomp': 'COMPREHENSION_DICT',
    'genexpr': 'GENERATOR_EXPRESSION',
    'lambda': 'LAMBDA',
}
COMPS = (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
COMP_KIND = {
    ast.ListComp: 'COMPREHENSION_LIST',
    ast.SetComp: 'COMPREHENSION_SET',
    ast.DictComp: 'COMPREHENSION_DICT',
    ast.GeneratorExp: 'GENERATOR_EXPRESSION',
}
COMP_NAME = {
    ast.ListComp: 'listcomp',
    ast.SetComp: 'setcomp',
    ast.DictComp: 'dictcomp',
    ast.GeneratorExp: 'genexpr',
}
FUNCS = (ast.FunctionDef, ast.AsyncFunctionDef)


def scope_kind(table):
    """symtable's type/name pair -> PythonScopeKind."""
    t = table.get_type()
    if t == 'module':
        return 'MODULE'
    if t == 'class':
        return 'CLASS'
    return SYM_KIND.get(table.get_name(), 'FUNCTION')


class PositionWalk:
    """
    Emits (kind, name, line, col) in CPython's block-creation order.

    Only the ordering rules that MOVE a block relative to source order are
    reproduced in detail; everything else is a plain recursive descent.
    """

    def __init__(self):
        self.out = []

    def block(self, kind, name, node):
        self.out.append((kind, name, node.lineno, node.col_offset))

    # -- expressions -------------------------------------------------------
    def expr(self, node):
        if node is None:
            return
        if isinstance(node, ast.Lambda):
            # Defaults are evaluated in the ENCLOSING scope, before the block.
            for d in node.args.defaults:
                self.expr(d)
            for d in node.args.kw_defaults:
                self.expr(d)
            self.block('LAMBDA', 'lambda', node)
            self.expr(node.body)
            return
        if isinstance(node, COMPS):
            # The outermost iterable is evaluated in the enclosing scope and so
            # is visited BEFORE this block exists. This is the whole reason the
            # walk cannot be source-ordered.
            gens = node.generators
            self.expr(gens[0].iter)
            self.block(COMP_KIND[type(node)], COMP_NAME[type(node)], node)
            self.expr(gens[0].target)
            for cond in gens[0].ifs:
                self.expr(cond)
            for gen in gens[1:]:
                self.expr(gen.iter)
                self.expr(gen.target)
                for cond in gen.ifs:
                    self.expr(cond)
            if isinstance(node, ast.DictComp):
                self.expr(node.key)
                self.expr(node.value)
            else:
                self.expr(node.elt)
            return
        for child in ast.iter_child_nodes(node):
            self.expr(child) if isinstance(child, ast.expr) else self.stmt(child)

    # -- statements --------------------------------------------------------
    def stmt(self, node):
        if node is None:
            return
        if isinstance(node, FUNCS):
            for d in node.decorator_list:
                self.expr(d)
            for d in node.args.defaults:
                self.expr(d)
            for d in node.args.kw_defaults:
                self.expr(d)
            for a in ast.walk(node.args):
                if isinstance(a, ast.arg) and a.annotation is not None:
                    self.expr(a.annotation)
            self.expr(node.returns)
            self.block('FUNCTION', node.name, node)
            for s in node.body:
                self.stmt(s)
            return
        if isinstance(node, ast.ClassDef):
            for d in node.decorator_list:
                self.expr(d)
            for b in node.bases:
                self.expr(b)
            for k in node.keywords:
                self.expr(k.value)
            self.block('CLASS', node.name, node)
            for s in node.body:
                self.stmt(s)
            return
        if isinstance(node, ast.Try) or type(node).__name__ == 'TryStar':
            # symtable.c visits body, ORELSE, HANDLERS, finalbody -- the else
            # clause before the except clauses, which is neither source order
            # nor AST field order. `try: ... except NameError: def f() ...
            # else: class f: ...` creates the class block before the function
            # block, and a field-order walk pairs each with the other's
            # position.
            for s in node.body:
                self.stmt(s)
            for s in node.orelse:
                self.stmt(s)
            for handler in node.handlers:
                self.expr(handler.type)
                for s in handler.body:
                    self.stmt(s)
            for s in node.finalbody:
                self.stmt(s)
            return
        for child in ast.iter_child_nodes(node):
            self.stmt(child) if isinstance(child, ast.stmt) else self.expr(child)


def symtable_order(table, qual, depth, out):
    """symtable children, in creation order, with qualnames."""
    for ordinal, child in enumerate(table.get_children()):
        kind = scope_kind(child)
        name = child.get_name()
        sep = '.' if scope_kind(table) == 'CLASS' or depth == 0 else '.<locals>.'
        cq = qual + sep + name
        out.append({
            'kind': kind,
            'name': name,
            'qual': cq,
            'ordinal': ordinal,
            'depth': depth + 1,
            'symbols': {
                s.get_name(): [
                    s.is_parameter(), s.is_local(), s.is_global(), s.is_free(),
                    s.is_imported(), s.is_assigned(), s.is_namespace(),
                    s.is_annotated(), s.is_declared_global(), s.is_nonlocal(),
                ]
                for s in child.get_symbols()
            },
        })
        symtable_order(child, cq, depth + 1, out)


def run(path, modname):
    src = open(path, 'rb').read()
    top = symtable.symtable(src, path, 'exec')
    scopes = []
    symtable_order(top, modname, 0, scopes)

    walk = PositionWalk()
    tree = ast.parse(src)
    for s in tree.body:
        walk.stmt(s)

    # symtable_order is depth-first over children; PositionWalk is depth-first
    # over the same blocks in the same creation order, so the two sequences
    # must correspond element for element.
    if len(walk.out) != len(scopes):
        return {'file': path, 'desync': f'{len(walk.out)} positions vs {len(scopes)} scopes'}
    for pos, sc in zip(walk.out, scopes):
        if pos[0] != sc['kind'] or (pos[1] != sc['name'] and sc['kind'] != 'FUNCTION'):
            return {'file': path, 'desync': f'{pos[0]}/{pos[1]} vs {sc["kind"]}/{sc["name"]}'}
        sc['line'], sc['col'] = pos[2], pos[3]

    scopes.insert(0, {
        'kind': 'MODULE', 'name': modname, 'qual': modname, 'ordinal': 0, 'depth': 0,
        'line': 0, 'col': 0,
        'symbols': {
            s.get_name(): [
                s.is_parameter(), s.is_local(), s.is_global(), s.is_free(),
                s.is_imported(), s.is_assigned(), s.is_namespace(),
                s.is_annotated(), s.is_declared_global(), s.is_nonlocal(),
            ]
            for s in top.get_symbols()
        },
    })
    return {'file': path, 'scopes': scopes}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        path, _, modname = line.partition('\t')
        try:
            sys.stdout.write(json.dumps(run(path, modname or 'm')) + '\n')
        except Exception as exc:  # oracle refusal is data, not a crash
            sys.stdout.write(json.dumps({'file': path, 'error': f'{type(exc).__name__}: {exc}'}) + '\n')


if __name__ == '__main__':
    main()
