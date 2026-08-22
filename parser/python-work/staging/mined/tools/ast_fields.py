#!/usr/bin/env python3.10
"""CPython side of the py_field differential.

Compares the SET OF FIELD NAMES per class, not A3's origin/modifier taxonomy:
`fieldOrigin` and `fieldModifier` are derived classifications that ast cannot
adjudicate, and encoding A4's own taxonomy would be scoring one opinion against
another. What ast CAN decide is which names are attributes of which class:

  - class-body Assign / AnnAssign targets that are plain names
  - the string entries of a `__slots__` assignment
  - `self.X = ...` / `self.X: T = ...` / `self.X += ...` anywhere in a method,
    using the method's FIRST parameter name as the receiver, not the literal
    word `self`

Key: the class's "line:col_offset".
"""
import ast, json, sys

def mangle(cls, name):
    """CPython mangles a class-private name at COMPILE time, so the attribute
    that actually exists is `_Cls__x`, and symtable reports the mangled form.
    The parser emits the mangled name; an oracle that reports the source
    spelling manufactures a disagreement that is not one."""
    if name.startswith("__") and not name.endswith("__"):
        return "_" + cls.lstrip("_") + name
    return name


def attr_targets(t, out):
    """Unpacking targets nest: `self.a, self.b = x` is a Tuple of Attributes,
    and `self.a, (self.b, self.c) = y` nests further."""
    if isinstance(t, (ast.Tuple, ast.List)):
        for e in t.elts:
            attr_targets(e, out)
    elif isinstance(t, ast.Starred):
        attr_targets(t.value, out)
    elif isinstance(t, ast.Attribute):
        out.append(t)


def slots_names(node):
    out = []
    for st in node.body:
        tgts = st.targets if isinstance(st, ast.Assign) else ([st.target] if isinstance(st, ast.AnnAssign) else [])
        if not any(getattr(t, "id", None) == "__slots__" for t in tgts):
            continue
        v = st.value
        if isinstance(v, (ast.Tuple, ast.List, ast.Set)):
            out += [e.value for e in v.elts if isinstance(e, ast.Constant) and isinstance(e.value, str)]
        elif isinstance(v, ast.Constant) and isinstance(v.value, str):
            out.append(v.value)
    return out

def main():
    p = sys.argv[1]
    try:
        tree = ast.parse(open(p, encoding="utf-8", errors="surrogateescape").read())
    except Exception as e:
        print(json.dumps({"error": str(e)[:100]})); return
    classes = {}
    for n in ast.walk(tree):
        if not isinstance(n, ast.ClassDef):
            continue
        names = set()
        # A class body is not a flat list: `if sys.platform == ...:` at class
        # level still declares class attributes. Walk the body's control flow,
        # but NOT into nested classes or functions, whose assignments belong to
        # someone else.
        def body_stmts(stmts):
            for st in stmts:
                if isinstance(st, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                yield st
                for attr in ("body", "orelse", "finalbody"):
                    yield from body_stmts(getattr(st, attr, []) or [])
                for h in getattr(st, "handlers", []) or []:
                    yield from body_stmts(h.body)
        for st in body_stmts(n.body):
            tg = []
            if isinstance(st, ast.Assign): tg = st.targets
            elif isinstance(st, (ast.AnnAssign, ast.AugAssign)): tg = [st.target]
            for t in tg:
                stack = [t]
                while stack:
                    x = stack.pop()
                    if isinstance(x, (ast.Tuple, ast.List)): stack += list(x.elts)
                    elif isinstance(x, ast.Starred): stack.append(x.value)
                    elif isinstance(x, ast.Name): names.add(mangle(n.name, x.id))
        names |= {mangle(n.name, x) for x in slots_names(n)}
        names.discard("__slots__")
        # self.X writes in this class's own methods (not nested classes)
        for st in n.body:
            if not isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            a = st.args
            first = (a.posonlyargs + a.args)[0].arg if (a.posonlyargs + a.args) else None
            if first is None:
                continue
            # Descend into nested FUNCTIONS (a closure still writes the outer
            # instance's attribute) but stop at nested CLASSES, where `self`
            # rebinds to the inner class's instance.
            def own_nodes(node):
                for ch in ast.iter_child_nodes(node):
                    if isinstance(ch, ast.ClassDef):
                        continue
                    yield ch
                    yield from own_nodes(ch)
            for ch in own_nodes(st):
                tgts = []
                if isinstance(ch, ast.Assign): tgts = ch.targets
                elif isinstance(ch, (ast.AnnAssign, ast.AugAssign)): tgts = [ch.target]
                attrs = []
                for t in tgts:
                    attr_targets(t, attrs)
                for t in attrs:
                    if isinstance(t.value, ast.Name) and t.value.id == first:
                        names.add(mangle(n.name, t.attr))
        classes[f"{n.lineno}:{n.col_offset}"] = {"name": n.name, "fields": sorted(names)}
    print(json.dumps({"classes": classes}))

main()
