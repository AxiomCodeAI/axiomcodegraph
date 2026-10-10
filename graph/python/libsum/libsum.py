#!/usr/bin/env python3
"""libsum.py -- what an installed Python library does with the objects a client hands it.

    libsum.py --src <repo> --out <client IR dir for python> [--site <dir>[,<dir>...]] [--cache <dir>]

THE GAP THIS CLOSES. The engine reads a dependency's signatures, never its bodies, so a hop the
LIBRARY makes back into client code is invisible: a test client's `get()` calls the `open()` a
client subclass overrides, a CLI runner calls `main()` on the command it was handed, a test client
built around an application calls `app(environ, start_response)` on it. Every one of those is a
library frame between two client frames, and the call graph stops at the first.

WHAT A SUMMARY SAYS. One row per hand-back a library callable is known to make, rooted at one of
its parameters (or at `self`, the object it was called on):

    py-lib-callback.csv   callee  root  pos  path  member  via  type
        callee  the library callable, canonical dotted name: `pkg.mod.func`, `pkg.mod.Class.method`
                (one row per method a class HAS, its inherited ones included), `pkg.mod.Class` for
                constructing it
        root    the parameter the object arrives in, or `self`
        pos     where the CLIENT writes that argument: the index among the positional arguments of
                the call as written (an instance method's `self` is not written), -1 for `self`
        path    the attribute chain the library follows from that object first ("" for the object
                itself, `application` for `self.application`), at most two long
        member  the method the library invokes on what it reached: a name it calls, or the dunder a
                syntax runs (`__call__` for `x()`, `__enter__` for `with x`, `__iter__` for `for`...)
        via     the library function in which that invocation is written
        type    the class the LIBRARY declares that object to be (a parameter annotation, a field's), "" when it
                declares none: when the client's own object cannot be told, a client subclass of it is the answer
    py-lib-field-init.csv class  field  param  pos
        constructing `class` stores the argument `param` (written at `pos`) on the new object as
        `field`, so a later `self.<field>` hand-back reaches what the client passed
    py-lib-ancestor.csv   class  ancestor
        a library class's library ancestors, for the classes the client can name
    py-lib-alias.csv      alias  canonical
        a name a package re-exports (`clikit.Command` is `clikit.core.Command`)
    py-lib-decorates.csv  decorator  form  class  field
        applying the library callable as a decorator -- `@decorator` (DIRECT) or `@decorator(...)` (FACTORY) --
        to a function f yields a new `class` whose `field` holds f; class "" when f itself comes back

HOW, AND WHY NOT IN THE SOLVE. Library source is just Python, so the facts are DERIVED from it by a
small flow-insensitive pass over each function body (which parameter-rooted value meets which call or
protocol syntax), composed to a fixpoint across the library's own calls: `Client.get` calls
`self.open`, `open` calls `run_app(self.application, ...)`, `run_app` calls `app(...)`, so
`Client.get` hands back `__call__` on `self.application`. Nothing is solved over library bodies at
index time: the pass reads only the packages the client imports (and what they import), is cached by
package and version, and writes three small tables. A library written in C has no body to read and
yields nothing; that is a declared blind spot, not a guess.

WHERE THE LIBRARY IS. The project's own virtual environment (`.venv`, `venv`, `env` in the repository,
else $VIRTUAL_ENV), its stdlib through pyvenv.cfg, or AXIOMCODE_PY_SITE (a comma list of directories)
when set. No environment found means no summaries: the engine then behaves exactly as before.
"""
import argparse, ast, csv, hashlib, json, os, re, sys

VERSION = '1'
MAXPATH = 2
DUNDER_BUILTIN = {'len': '__len__', 'str': '__str__', 'repr': '__repr__', 'iter': '__iter__', 'next': '__next__',
                  'hash': '__hash__', 'bool': '__bool__', 'format': '__format__', 'reversed': '__reversed__',
                  'abs': '__abs__', 'aiter': '__aiter__', 'anext': '__anext__'}
SKIP_DIRS = {'__pycache__', 'tests', 'test', 'testing_support', 'docs', 'examples', 'benchmarks'}


# ─────────────────────────────────────────────────────────────────────────────
# where the library is
# ─────────────────────────────────────────────────────────────────────────────
def find_sites(src):
    if os.environ.get('AXIOMCODE_PY_SITE'):
        return [d for d in os.environ['AXIOMCODE_PY_SITE'].split(',') if os.path.isdir(d)], None
    envs = [os.path.join(src, n) for n in ('.venv', 'venv', 'env', '.env')]
    if os.environ.get('VIRTUAL_ENV'):
        envs.append(os.environ['VIRTUAL_ENV'])
    for e in envs:
        cfg = os.path.join(e, 'pyvenv.cfg')
        if not os.path.isfile(cfg):
            continue
        sites = []
        for root in (os.path.join(e, 'lib'), os.path.join(e, 'Lib')):
            if not os.path.isdir(root):
                continue
            if os.path.isdir(os.path.join(root, 'site-packages')):
                sites.append(os.path.join(root, 'site-packages'))
            for d in sorted(os.listdir(root)):
                sp = os.path.join(root, d, 'site-packages')
                if d.startswith('python') and os.path.isdir(sp):
                    sites.append(sp)
        stdlib = None
        try:
            kv = dict(l.split('=', 1) for l in open(cfg, encoding='utf-8') if '=' in l)
            kv = {k.strip(): v.strip() for k, v in kv.items()}
            home, ver = kv.get('home', ''), (kv.get('version_info') or kv.get('version') or '')
            mm = '.'.join(ver.split('.')[:2])
            for cand in (os.path.join(os.path.dirname(home), 'lib', f'python{mm}'), os.path.join(home, 'Lib'),
                         os.path.join(os.path.dirname(home), 'Lib')):
                if mm and os.path.isfile(os.path.join(cand, 'contextlib.py')):
                    stdlib = cand; break
        except Exception:
            pass
        if sites:
            return sites, stdlib
    return [], None


# ─────────────────────────────────────────────────────────────────────────────
# which modules: the client's imports, then what those import, transitively
# ─────────────────────────────────────────────────────────────────────────────
IMPORT_RE = re.compile(r'^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import|import\s+([A-Za-z_][\w.]*(?:\s*,\s*[A-Za-z_][\w.]*)*))', re.M)


def client_imports(src, ir):
    """every dotted path the client imports: `from a.b import C` gives a.b.C, `import a.b` gives a.b. From the
    parser's import table when the IR is there, else from the source"""
    paths = set()
    p = os.path.join(ir, 'all-python-imports.csv') if ir else ''
    if p and os.path.isfile(p):
        try:
            with open(p, newline='', encoding='utf-8') as fh:
                r = csv.reader(fh, delimiter='\t')
                head = next(r)
                if 'importedPath' in head:
                    col = head.index('importedPath')
                    for row in r:
                        if len(row) > col and row[col]:
                            paths.add(row[col])
                    return paths
        except Exception:
            pass
    skip = {'.venv', 'venv', 'env', '.env', '.git', 'node_modules', '.tox', '__pycache__', '.axiomcode'}
    for d, ds, fs in os.walk(src):
        ds[:] = [x for x in ds if x not in skip]
        for f in fs:
            if not f.endswith('.py'):
                continue
            try:
                tree = ast.parse(open(os.path.join(d, f), encoding='utf-8', errors='replace').read())
            except Exception:
                continue
            for n in ast.walk(tree):
                if isinstance(n, ast.Import):
                    paths.update(a.name for a in n.names)
                elif isinstance(n, ast.ImportFrom) and n.module and not n.level:
                    paths.update(f'{n.module}.{a.name}' for a in n.names if a.name != '*')
                    paths.add(n.module)
    return paths


class Package:
    """one importable top-level name: a directory package or a single module file"""
    def __init__(self, name, path, base):
        self.name, self.path, self.base = name, path, base

    def files(self):
        if os.path.isfile(self.path):
            yield self.name, self.path
            return
        for d, ds, fs in os.walk(self.path):
            ds[:] = sorted(x for x in ds if x not in SKIP_DIRS and not x.startswith('.'))
            for f in sorted(fs):
                if not f.endswith('.py'):
                    continue
                rel = os.path.relpath(os.path.join(d, f), self.base)[:-3].replace(os.sep, '.')
                if rel.endswith('.__init__'):
                    rel = rel[:-9]
                yield rel, os.path.join(d, f)


def locate(name, sites, stdlib):
    for base in list(sites) + ([stdlib] if stdlib else []):
        p = os.path.join(base, name)
        if os.path.isdir(p) and (os.path.isfile(os.path.join(p, '__init__.py')) or base != stdlib):
            return Package(name, p, base)
        if os.path.isfile(p + '.py'):
            return Package(name, p + '.py', base)
    return None


# ─────────────────────────────────────────────────────────────────────────────
# one module: its namespace, its classes, and the events in each function body
# ─────────────────────────────────────────────────────────────────────────────
class Fn:
    __slots__ = ('q', 'params', 'pos', 'kind', 'events', 'cls', 'stores', 'ptypes', 'rets', 'local')

    def __init__(self, q, cls):
        self.q, self.cls, self.ptypes, self.rets, self.local = q, cls, {}, [], False
        self.params, self.pos, self.kind = [], {}, 'function'
        self.events = []       # ('use', val, member) | ('call', callee, selfval, {param: [vals]}, [posvals], {kw: [vals]})
        self.stores = []       # (field, val) written on self


class Cls:
    __slots__ = ('q', 'bases', 'methods', 'mod', 'ftypes')

    def __init__(self, q, mod):
        self.q, self.mod, self.bases, self.methods, self.ftypes = q, mod, [], {}, {}


def resolve_rel(mod, is_pkg, level, name):
    parts = mod.split('.')
    if not is_pkg:
        parts = parts[:-1]
    if level > 1:
        parts = parts[:len(parts) - (level - 1)]
    return '.'.join([p for p in parts if p] + ([name] if name else []))


class Module:
    def __init__(self, name, path, is_pkg):
        self.name, self.path, self.is_pkg = name, path, is_pkg
        self.ns = {}            # local name -> qualified name (a def, a class, an imported thing)
        self.fns, self.classes = {}, {}
        self.imports = set()

    def load(self):
        try:
            tree = ast.parse(open(self.path, encoding='utf-8', errors='replace').read())
        except Exception:
            return False
        self.tree = tree
        for st in tree.body:
            self._ns_stmt(st)
        return True

    def _ns_stmt(self, st):
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            self.ns[st.name] = f'{self.name}.{st.name}'
        elif isinstance(st, ast.ImportFrom):
            base = resolve_rel(self.name, self.is_pkg, st.level, st.module or '') if st.level else (st.module or '')
            if base:
                self.imports.add(base)
            for a in st.names:
                if a.name != '*':
                    self.ns[a.asname or a.name] = f'{base}.{a.name}' if base else a.name
        elif isinstance(st, ast.Import):
            for a in st.names:
                self.imports.add(a.name)
                if a.asname:
                    self.ns[a.asname] = a.name
                else:
                    self.ns.setdefault(a.name.split('.')[0], a.name.split('.')[0])
        elif isinstance(st, ast.Assign) and len(st.targets) == 1 and isinstance(st.targets[0], ast.Name):
            v = dotted(st.value)
            if v and v.split('.')[0] in self.ns:
                self.ns.setdefault(st.targets[0].id, self.ns[v.split('.')[0]] + v[len(v.split('.')[0]):])
        elif isinstance(st, (ast.If, ast.Try)):
            for b in [st.body, getattr(st, 'orelse', []), getattr(st, 'finalbody', [])] + [h.body for h in getattr(st, 'handlers', [])]:
                for s in b:
                    self._ns_stmt(s)

    def qual(self, n):
        return self.ns.get(n)

    def analyse(self):
        for st in self.tree.body:
            if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self._fn(st, None)
            elif isinstance(st, ast.ClassDef):
                c = Cls(f'{self.name}.{st.name}', self)
                c.bases = [b for b in (self.qual_expr(x) for x in st.bases) if b]
                self.classes[c.q] = c
                for s in st.body:
                    if isinstance(s, ast.AnnAssign) and isinstance(s.target, ast.Name):
                        t = self.ann_qual(s.annotation)
                        if t:
                            c.ftypes[s.target.id] = t
                for s in st.body:
                    if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef)):
                        f = self._fn(s, c)
                        c.methods[s.name] = f.q

    def ann_qual(self, ann):
        """the class an annotation names: `T`, `pkg.T`, `"T"`, `Optional[T]`, `T | None`"""
        if isinstance(ann, ast.Constant) and isinstance(ann.value, str):
            try:
                ann = ast.parse(ann.value, mode='eval').body
            except SyntaxError:
                return None
        if isinstance(ann, ast.BinOp):
            return self.ann_qual(ann.left)
        if isinstance(ann, ast.Subscript) and (dotted(ann.value) or '').split('.')[-1] == 'Optional':
            return self.ann_qual(ann.slice)
        return self.qual_expr(ann) if ann is not None else None

    def qual_expr(self, e):
        d = dotted(e.value if isinstance(e, ast.Subscript) else e)
        if not d:
            return None
        head, _, rest = d.partition('.')
        q = self.qual(head)
        return (q + ('.' + rest if rest else '')) if q else None

    def _fn(self, node, cls):
        q = f'{cls.q}.{node.name}' if cls else f'{self.name}.{node.name}'
        f = self.signature(node, q, cls)
        self.fns[q] = f
        Body(self, f, f.params[0] if f.kind in ('method', 'classmethod', 'property') and f.params else None, cls).run(node)
        return f

    def signature(self, node, q, cls):
        f = Fn(q, cls.q if cls else None)
        decos = {dotted(d.func if isinstance(d, ast.Call) else d) for d in node.decorator_list}
        a = node.args
        names = [x.arg for x in a.posonlyargs + a.args]
        if cls is not None:
            if 'staticmethod' in decos:
                f.kind = 'static'
            elif 'classmethod' in decos:
                f.kind = 'classmethod'
            elif 'property' in decos or any(d and d.endswith(('.setter', '.getter', 'cached_property')) for d in decos):
                f.kind = 'property'
            else:
                f.kind = 'method'
        f.params = names + [x.arg for x in a.kwonlyargs]
        skip = 1 if f.kind in ('method', 'classmethod', 'property') and names else 0
        for i, n in enumerate(names):
            f.pos[n] = i - skip if i >= skip else -1
        for x in a.kwonlyargs:
            f.pos[x.arg] = -2                   # keyword only: matched by name
        for x in a.posonlyargs + a.args + a.kwonlyargs:
            if x.annotation is not None:
                t = self.ann_qual(x.annotation)
                if t:
                    f.ptypes[x.arg] = t
        return f


def dotted(e):
    if isinstance(e, ast.Name):
        return e.id
    if isinstance(e, ast.Attribute):
        d = dotted(e.value)
        return f'{d}.{e.attr}' if d else None
    return None


class Body:
    """a flow-insensitive pass over one function body (nested defs and lambdas included: a closure the
    library builds around a parameter is how a decorator or a callback wrapper hands it back)"""
    def __init__(self, mod, fn, selfname, cls):
        self.mod, self.fn, self.selfname, self.cls = mod, fn, selfname, cls
        self.env = {}
        self.params = set(fn.params)

    def run(self, node):
        for _ in range(2):                        # twice: a local assigned below its first use
            self.fn.events = []; self.fn.stores = []; self.fn.rets = []
            for st in node.body:
                self.stmt(st)
        return self

    # values: ('p', root, path) | ('ref', qname) | ('new', class, argvals) | ('self', ...) is ('p', 'self', ())
    def val(self, e):
        if isinstance(e, ast.Name):
            if e.id in self.env:
                return self.env[e.id]
            if e.id in self.params:
                return [('p', 'self' if e.id == self.selfname else e.id, ())]
            q = self.mod.qual(e.id)
            return [('ref', q)] if q else []
        if isinstance(e, ast.Attribute):
            out = []
            for v in self.val(e.value):
                if v[0] == 'p' and len(v[2]) < MAXPATH:
                    out.append(('p', v[1], v[2] + (e.attr,)))
                elif v[0] == 'ref':
                    out.append(('ref', f'{v[1]}.{e.attr}'))
                elif v[0] == 'new':
                    out.append(('field', v, e.attr))
            return out
        if isinstance(e, ast.Call):
            return self.call(e)
        if isinstance(e, (ast.IfExp,)):
            self.val(e.test)
            return self.val(e.body) + self.val(e.orelse)
        if isinstance(e, ast.BoolOp):
            out = []
            for x in e.values:
                out += self.val(x)
            return out
        if isinstance(e, ast.NamedExpr):
            v = self.val(e.value)
            if isinstance(e.target, ast.Name):
                self.env[e.target.id] = v
            return v
        if isinstance(e, ast.Await):
            return self.val(e.value)
        if isinstance(e, ast.Subscript):
            for v in self.val(e.value):
                self.use(v, '__getitem__')
            self.val(e.slice)
            return []
        if isinstance(e, ast.Compare):
            self.val(e.left)
            for op, c in zip(e.ops, e.comparators):
                cv = self.val(c)
                if isinstance(op, (ast.In, ast.NotIn)):
                    for v in cv:
                        self.use(v, '__contains__')
            return []
        if isinstance(e, ast.JoinedStr):
            for x in e.values:
                if isinstance(x, ast.FormattedValue):
                    m = {115: '__str__', 114: '__repr__', 97: '__repr__'}.get(x.conversion, '__format__')
                    for v in self.val(x.value):
                        self.use(v, m)
            return []
        if isinstance(e, ast.Lambda):
            self.nested(e.body if isinstance(e.body, list) else [ast.Expr(e.body)], e.args)
            return []
        if isinstance(e, (ast.ListComp, ast.SetComp, ast.GeneratorExp, ast.DictComp)):
            for g in e.generators:
                for v in self.val(g.iter):
                    self.use(v, '__iter__')
                for c in g.ifs:
                    self.val(c)
            for x in ([e.key, e.value] if isinstance(e, ast.DictComp) else [e.elt]):
                self.val(x)
            return []
        for ch in ast.iter_child_nodes(e):
            if isinstance(ch, ast.expr):
                self.val(ch)
        return []

    def use(self, v, member):
        if member == '__call__' and v == ('p', 'self', ()) and self.fn.kind == 'classmethod':
            member = '__init__'                 # cls(...) constructs the class the method was called on
        if v[0] == 'p' or v[0] == 'field':
            # what the library itself declares the object to be, where it says: a parameter's annotation, a field's
            hint = None
            if v[0] == 'p':
                base = self.cls.q if v[1] == 'self' and self.cls else self.fn.ptypes.get(v[1])
                if base and not v[2]:
                    hint = ('t', base)
                elif base and len(v[2]) == 1:
                    hint = ('f', base, v[2][0])
            self.fn.events.append(('use', v, member, hint))

    def call(self, e):
        f = e.func
        posv = [self.val(a) if not isinstance(a, ast.Starred) else None for a in e.args]
        kwv = {k.arg: self.val(k.value) for k in e.keywords if k.arg}
        for k in e.keywords:
            if not k.arg:
                self.val(k.value)
        if isinstance(f, ast.Name) and f.id in DUNDER_BUILTIN and f.id not in self.env and not self.mod.qual(f.id) and posv and posv[0]:
            for v in posv[0]:
                self.use(v, DUNDER_BUILTIN[f.id])
            return []
        if isinstance(f, ast.Name) and f.id == 'super' and not e.args:
            return [('super',)]
        fd = dotted(f) or ''
        if fd.split('.')[-1] == 'cast' and len(posv) == 2 and posv[1]:
            return posv[1]                       # typing.cast(T, x) is x
        if fd == 'type' and len(posv) == 1 and posv[0]:
            return posv[0]                       # type(x).__enter__ is looked up on x's class: x's member
        if isinstance(f, ast.Attribute):
            out = []
            for rv in self.val(f.value):
                if rv[0] in ('p', 'field'):
                    self.use(rv, f.attr)
                    self.fn.events.append(('call', ('method', rv, f.attr), posv, kwv))
                elif rv[0] == 'super':
                    self.fn.events.append(('call', ('super', self.cls.q if self.cls else None, f.attr), posv, kwv))
                elif rv[0] == 'new':
                    self.fn.events.append(('call', ('method', rv, f.attr), posv, kwv))
                elif rv[0] == 'ref':
                    self.fn.events.append(('call', ('ref', f'{rv[1]}.{f.attr}'), posv, kwv))
            return out
        out = []
        for cv in self.val(f):
            if cv[0] in ('p', 'field'):
                self.use(cv, '__call__')
                if cv[0] == 'p' and cv[2]:
                    # a member read first and called later (`_enter = type(cm).__enter__; _enter(cm)`)
                    self.use(('p', cv[1], cv[2][:-1]), cv[2][-1])
            elif cv[0] == 'ref':
                self.fn.events.append(('call', ('ref', cv[1]), posv, kwv))
                out.append(('new', cv[1], self.args(posv, kwv)))
            elif cv[0] == 'closure':
                self.fn.events.append(('call', ('ref', cv[1]), posv, kwv))
                out.append(('res', cv[1], self.args(posv, kwv)))
            elif cv[0] in ('new', 'res', 'res2'):
                out.append(('res2', cv, self.args(posv, kwv)))       # calling what a call returned: `command(...)(f)`
        return out

    @staticmethod
    def args(posv, kwv):
        return (tuple(tuple(p) if p is not None else None for p in posv), tuple(sorted((k, tuple(v)) for k, v in kwv.items())))

    def nested(self, body, args):
        saved = set(self.params)
        for a in args.posonlyargs + args.args + args.kwonlyargs + [x for x in (args.vararg, args.kwarg) if x]:
            self.params.discard(a.arg); self.env.pop(a.arg, None)
        for st in body:
            self.stmt(st)
        self.params = saved

    def assign(self, t, vals):
        if isinstance(t, ast.Name):
            # flow-insensitive: a parameter rebound keeps what it arrived as (`callback = other.callback`)
            base = self.env.get(t.id) or ([('p', 'self' if t.id == self.selfname else t.id, ())] if t.id in self.params else [])
            self.env[t.id] = list(dict.fromkeys(base + vals))
        elif isinstance(t, ast.Attribute):
            for ov in self.val(t.value):
                if ov == ('p', 'self', ()):
                    for v in vals:
                        self.fn.stores.append((t.attr, v))
                        if self.cls and v[0] == 'p' and not v[2] and v[1] in self.fn.ptypes:
                            self.cls.ftypes.setdefault(t.attr, self.fn.ptypes[v[1]])
        elif isinstance(t, (ast.Tuple, ast.List)):
            for x in t.elts:
                self.assign(x, [])
        elif isinstance(t, ast.Subscript):
            for v in self.val(t.value):
                self.use(v, '__setitem__')

    def stmt(self, st):
        if isinstance(st, (ast.FunctionDef, ast.AsyncFunctionDef)):
            self.nested(st.body, st.args)
            # and as a callable of its own, so what it RETURNS is known: a decorator factory returns this closure,
            # and the closure returns the object it wrapped the decorated function in
            sq = f'{self.fn.q}.<locals>.{st.name}'
            sub = self.mod.signature(st, sq, None)
            sub.local = True
            self.mod.fns[sq] = sub
            b = Body(self.mod, sub, None, None)
            b.env = {k: list(v) for k, v in self.env.items() if k not in set(sub.params)}
            b.run(st)
            self.env[st.name] = [('closure', sq)]
            return
        if isinstance(st, ast.Return):
            if st.value is not None:
                self.fn.rets.extend(self.val(st.value))
            return
        if isinstance(st, ast.ClassDef):
            return
        if isinstance(st, ast.Assign):
            v = self.val(st.value)
            for t in st.targets:
                self.assign(t, v)
            return
        if isinstance(st, ast.AnnAssign) and isinstance(st.target, ast.Attribute) and self.cls \
                and isinstance(st.target.value, ast.Name) and st.target.value.id == self.selfname:
            t = self.mod.ann_qual(st.annotation)
            if t:
                self.cls.ftypes[st.target.attr] = t
        if isinstance(st, (ast.AnnAssign, ast.AugAssign)):
            if st.value is not None:
                v = self.val(st.value)
                self.assign(st.target, v if isinstance(st, ast.AnnAssign) else [])
            return
        if isinstance(st, (ast.For, ast.AsyncFor)):
            for v in self.val(st.iter):
                self.use(v, '__aiter__' if isinstance(st, ast.AsyncFor) else '__iter__')
            self.assign(st.target, [])
        if isinstance(st, (ast.With, ast.AsyncWith)):
            a = isinstance(st, ast.AsyncWith)
            for it in st.items:
                vs = self.val(it.context_expr)
                for v in vs:
                    self.use(v, '__aenter__' if a else '__enter__'); self.use(v, '__aexit__' if a else '__exit__')
                if it.optional_vars is not None:
                    self.assign(it.optional_vars, [])
        if isinstance(st, ast.Delete):
            for t in st.targets:
                if isinstance(t, ast.Subscript):
                    for v in self.val(t.value):
                        self.use(v, '__delitem__')
            return
        for fld, ch in ast.iter_fields(st):
            if fld in ('target', 'targets', 'iter', 'items') and isinstance(st, (ast.For, ast.AsyncFor, ast.With, ast.AsyncWith)):
                continue
            for c in (ch if isinstance(ch, list) else [ch]):
                if isinstance(c, ast.stmt):
                    self.stmt(c)
                elif isinstance(c, ast.expr):
                    self.val(c)
                elif isinstance(c, ast.excepthandler):
                    for s in c.body:
                        self.stmt(s)
                elif isinstance(c, ast.match_case) if hasattr(ast, 'match_case') else False:
                    for s in c.body:
                        self.stmt(s)


# ─────────────────────────────────────────────────────────────────────────────
# the program: every analysed module, then the fixpoint across the library's own calls
# ─────────────────────────────────────────────────────────────────────────────
class Program:
    def __init__(self):
        self.mods, self.fns, self.classes = {}, {}, {}

    def add(self, m):
        self.mods[m.name] = m
        self.fns.update(m.fns); self.classes.update(m.classes)

    def canon(self, q, seen=None):
        """follow a module re-export to the declaration: clikit.Command -> clikit.core.Command"""
        if q in self.fns or q in self.classes:
            return q
        seen = seen or set()
        if q in seen or not q:
            return None
        seen.add(q)
        parts = q.split('.')
        for i in range(len(parts) - 1, 0, -1):
            m = self.mods.get('.'.join(parts[:i]))
            if m is None:
                continue
            nxt = m.qual(parts[i])
            if nxt and nxt != '.'.join(parts[:i + 1]):
                return self.canon('.'.join([nxt] + parts[i + 1:]), seen)
            if i + 1 < len(parts):                   # Class.method
                c = self.canon('.'.join(parts[:i + 1]), seen)
                if c in self.classes:
                    r = self.lookup(c, parts[i + 1])
                    return r if len(parts) == i + 2 else None
            return None
        return None

    def type_of(self, hint):
        """the canonical library class a use hint names: ('t', T) the object's own declared type, ('f', B, f) the
        declared type of field f on B (annotated in the class, or assigned from an annotated parameter)"""
        if not hint:
            return ''
        if hint[0] == 't':
            c = self.canon(hint[1])
            return c if c in self.classes else ''
        b = self.canon(hint[1])
        if b not in self.classes:
            return ''
        for k in self.mro(b):
            t = self.classes[k].ftypes.get(hint[2])
            if t:
                c = self.canon(t) or self.canon(f'{self.classes[k].mod.name}.{t}')
                return c if c in self.classes else ''
        return ''

    def mro(self, c, seen=None):
        seen = seen if seen is not None else set()
        if c in seen:
            return []
        seen.add(c)
        out = [c]
        k = self.classes.get(c)
        for b in (k.bases if k else []):
            bc = self.canon(b)
            if bc in self.classes:
                for x in self.mro(bc, seen):
                    if x not in out:
                        out.append(x)
        return out

    def lookup(self, c, name):
        for k in self.mro(c):
            m = self.classes[k].methods.get(name)
            if m:
                return m
        return None

    def solve(self):
        S = {q: set() for q in self.fns}          # (root, path, member, via)
        ST = {c: set() for c in self.classes}     # class -> (field, init param)
        for f in self.fns.values():
            for ev in f.events:
                if ev[0] == 'use' and ev[1][0] == 'p' and (ev[1][1] == 'self' or ev[1][1] in f.pos):
                    S[f.q].add((ev[1][1], ev[1][2], ev[2], f.q, self.type_of(ev[3])))
            if f.cls and f.q.endswith('.__init__'):
                for fld, v in f.stores:
                    if v[0] == 'p' and v[2] == () and v[1] in f.pos:
                        ST[f.cls].add((fld, v[1]))

        def init_of(c):
            return self.lookup(c, '__init__')

        def stores(c):
            out = set()
            for k in self.mro(c):
                out |= ST.get(k, set())
            return out

        def bind(callee, posv, kwv):
            """callee parameter -> the caller's values"""
            g = self.fns.get(callee)
            if not g:
                return {}
            out = {}
            byp = {i: n for n, i in g.pos.items() if i >= 0}
            for i, vs in enumerate(posv):
                if vs is not None and i in byp:
                    out.setdefault(byp[i], []).extend(vs)
            for k, vs in kwv.items():
                if k in g.pos:
                    out.setdefault(k, []).extend(vs)
            return out

        def lift(v, path, depth=0):
            """a value reached in the caller, followed down `path`: param-rooted values only"""
            if v[0] == 'p':
                p = v[2] + tuple(path)
                return [(v[1], p)] if len(p) <= MAXPATH else []
            if v[0] == 'field' and depth < 3:
                return [x for w in field_vals(v[1], v[2]) for x in lift(w, path, depth + 1)]
            if v[0] == 'new' and path and depth < 3:
                return [x for w in field_vals(v, path[0]) for x in lift(w, path[1:], depth + 1)]
            return []

        def field_vals(newv, fld):
            c = self.canon(newv[1])
            if c not in self.classes:
                return []
            ini = init_of(c)
            if not ini:
                return []
            posv = [list(x) if x is not None else None for x in newv[2][0]]
            kwv = {k: list(v) for k, v in newv[2][1]}
            b = bind(ini, posv, kwv)
            return [w for f, pn in stores(c) if f == fld for w in b.get(pn, [])]

        changed, rounds = True, 0
        while changed and rounds < 12:
            changed, rounds = False, rounds + 1
            for f in self.fns.values():
                acc = S[f.q]; n0 = len(acc)
                for ev in f.events:
                    if ev[0] == 'use' and ev[1][0] == 'field':
                        for root, path in lift(ev[1], ()):
                            if root == 'self' or root in f.pos:
                                acc.add((root, path, ev[2], f.q, ''))
                        continue
                    if ev[0] != 'call':
                        continue
                    tgt, posv, kwv = ev[1], ev[2], ev[3]
                    targets = []                     # (callee, selfvals)
                    if tgt[0] == 'ref':
                        q = self.canon(tgt[1])
                        if q in self.fns:
                            targets.append((q, []))
                        elif q in self.classes and init_of(q):
                            targets.append((init_of(q), []))
                    elif tgt[0] == 'method':
                        rv, name = tgt[1], tgt[2]
                        if rv == ('p', 'self', ()) and f.cls:
                            m = self.lookup(f.cls, name)
                            if m:
                                targets.append((m, [rv]))
                        elif rv[0] == 'p' and rv[2] == () and rv[1] in f.ptypes:
                            c = self.canon(f.ptypes[rv[1]])
                            m = self.lookup(c, name) if c in self.classes else None
                            if m:
                                targets.append((m, [rv]))
                        elif rv[0] == 'p' and len(rv[2]) == 1:
                            # `self.loader.load(...)`: the field's declared type says whose `load` runs
                            base = f.cls if rv[1] == 'self' else f.ptypes.get(rv[1])
                            c = self.type_of(('f', base, rv[2][0])) if base else ''
                            m = self.lookup(c, name) if c else None
                            if m:
                                targets.append((m, [rv]))
                        elif rv[0] == 'new':
                            c = self.canon(rv[1])
                            if c in self.classes and self.lookup(c, name):
                                targets.append((self.lookup(c, name), [rv]))
                    elif tgt[0] == 'super' and tgt[1]:
                        for k in self.mro(tgt[1])[1:]:
                            m = self.classes[k].methods.get(tgt[2])
                            if m:
                                targets.append((m, [('p', 'self', ())])); break
                    for callee, selfv in targets:
                        b = bind(callee, posv, kwv)
                        for (r, p, mem, via, ty) in list(S.get(callee, ())):
                            src = selfv if r == 'self' else b.get(r, [])
                            for v in src:
                                for root, path in lift(v, p):
                                    if root == 'self' or root in f.pos:
                                        acc.add((root, path, mem, via, ty))
                        if callee.endswith('.__init__'):
                            g = self.fns[callee]
                            # super().__init__(x) / Base.__init__(self, x): what the base stores, this class stores
                            if f.cls and f.q.endswith('.__init__') and (selfv == [('p', 'self', ())] or tgt[0] == 'super'):
                                for fld, pn in stores(g.cls):
                                    for v in b.get(pn, []):
                                        if v[0] == 'p' and v[2] == () and v[1] in f.pos and (fld, v[1]) not in ST[f.cls]:
                                            ST[f.cls].add((fld, v[1])); changed = True
                if len(acc) != n0:
                    changed = True
        self.S, self.ST = S, ST
        return rounds

    def returns(self):
        """R[f]: what f's return value is, as far as a decorator needs it --
            ('obj', C, field, param)   a new C whose `field` holds f's parameter `param`
            ('closure', D)             the nested function D (a decorator factory's decorator)
            ('param', param)           f's own parameter, unchanged (an identity / registering decorator)"""
        R = {q: set() for q in self.fns}

        def bindv(g, args):
            posv = [list(x) if x is not None else None for x in args[0]]
            return self._bind(g, posv, {k: list(v) for k, v in args[1]})

        def own(f, w):
            return w[0] == 'p' and w[2] == () and w[1] in f.pos and w[1] != 'self'

        def apply(f, g, args, out):
            b = bindv(g, args)
            for d in list(R.get(g, ())):
                if d[0] == 'closure':
                    out.add(d)
                elif d[0] in ('obj', 'param'):
                    for w in b.get(d[-1], []):
                        if own(f, w):
                            out.add(d[:-1] + (w[1],))
                        elif w[0] == 'closure' and d[0] == 'param':
                            out.add(w)

        def resolve(f, v, out, depth=0):
            if depth > 4:
                return
            if v[0] == 'closure':
                out.add(v)
            elif own(f, v):
                out.add(('param', v[1]))
            elif v[0] == 'new':
                c = self.canon(v[1])
                if c in self.classes:
                    ini = self.lookup(c, '__init__')
                    if ini:
                        b = bindv(ini, v[2])
                        for fld, pn in self._stores(c):
                            for w in b.get(pn, []):
                                if own(f, w):
                                    out.add(('obj', c, fld, w[1]))
                elif c in self.fns:
                    apply(f, c, v[2], out)
            elif v[0] == 'res':
                apply(f, v[1], v[2], out)
            elif v[0] == 'res2':
                inner = set()
                resolve(f, v[1], inner, depth + 1)
                for d in inner:
                    if d[0] == 'closure':
                        apply(f, d[1], v[2], out)

        for _ in range(8):
            changed = False
            for f in self.fns.values():
                acc = R[f.q]; n0 = len(acc)
                for v in f.rets:
                    resolve(f, v, acc)
                changed |= len(acc) != n0
            if not changed:
                break
        self.R = R

    def _bind(self, callee, posv, kwv):
        g = self.fns.get(callee)
        if not g:
            return {}
        out = {}
        byp = {i: n for n, i in g.pos.items() if i >= 0}
        for i, vs in enumerate(posv):
            if vs is not None and i in byp:
                out.setdefault(byp[i], []).extend(vs)
        for k, vs in kwv.items():
            if k in g.pos:
                out.setdefault(k, []).extend(vs)
        return out

    def _stores(self, c):
        out = set()
        for k in self.mro(c):
            out |= self.ST.get(k, set())
        return out

    def decorates(self, g):
        """what applying the callable g as a decorator to a function f yields: (form, class, field) -- DIRECT for
        `@g`, FACTORY for `@g(...)`; class '' when f itself comes back (a registering decorator)"""
        f = self.fns[g]
        first = lambda h: next((n for n, i in self.fns[h].pos.items() if i == 0), None)
        out = set()
        p0 = first(g)
        for d in self.R.get(g, ()):
            if d[0] == 'obj' and d[3] == p0:
                out.add(('DIRECT', d[1], d[2]))
            elif d[0] == 'param' and d[1] == p0:
                out.add(('DIRECT', '', ''))
            elif d[0] == 'closure':
                q0 = first(d[1])
                for e in self.R.get(d[1], ()):
                    if e[0] == 'obj' and e[3] == q0:
                        out.add(('FACTORY', e[1], e[2]))
                    elif e[0] == 'param' and e[1] == q0:
                        out.add(('FACTORY', '', ''))
        return out

    def named(self, imports, lib_pkgs):
        """the library classes and functions the client can name: what it imports, what a module it imports
        (and that module's direct submodules) declares, and the class a decorator it imports wraps a function
        in. Summaries are emitted for these only -- the solve reads what the client can reach, not the venv."""
        out = set()
        def add(q):
            c = self.canon(q)
            if c and c.split('.')[0] in lib_pkgs and '<locals>' not in c:
                out.add(c)
        for p in imports:
            add(p)
            if p in self.mods:
                for m in [p] + [x for x in self.mods if x.startswith(p + '.') and '.' not in x[len(p) + 1:]]:
                    for local in self.mods[m].ns:
                        add(f'{m}.{local}')
        for q in list(out):
            if q in self.fns:
                for _, c, _ in self.decorates(q):
                    if c:
                        out.add(c)
            elif q in self.classes:
                for n in {n for k in self.mro(q) for n in self.classes[k].methods}:
                    m = self.lookup(q, n)
                    if m:
                        for _, c, _ in self.decorates(m):
                            if c:
                                out.add(c)
        return out

    def rows(self, keep):
        """flattened rows: every method a class HAS (inherited ones included) and every constructor"""
        cb, fi, al, de, an = set(), set(), set(), set(), set()

        def emit(callee_name, fq, kind):
            g = self.fns[fq]
            for (r, p, mem, via, ty) in self.S.get(fq, ()):
                if r == 'self':
                    pos = -1
                else:
                    pos = g.pos.get(r, -3)
                    if pos == -3 or (pos == -1 and kind != 'function'):
                        continue
                cb.add((callee_name, r, pos, '.'.join(p), mem, via, ty))
        for q, g in self.fns.items():
            if g.cls is None and not g.local and keep(q):
                emit(q, q, 'function')
                for form, c, fld in self.decorates(q):
                    de.add((q, form, c, fld))
        for c in self.classes:
            if not keep(c):
                continue
            names = set()
            for k in self.mro(c):
                names |= set(self.classes[k].methods)
            for n in names:
                m = self.lookup(c, n)
                if m and self.fns[m].kind != 'property':
                    emit(f'{c}.{n}', m, 'method' if self.fns[m].kind != 'static' else 'function')
                    for form, k, fld in self.decorates(m):
                        de.add((f'{c}.{n}', form, k, fld))
            for a in self.mro(c)[1:]:
                an.add((c, a))
            ini = self.lookup(c, '__init__')
            if ini:
                emit(c, ini, 'ctor')
                g = self.fns[ini]
                for fld, pn in set().union(*[self.ST.get(k, set()) for k in self.mro(c)]):
                    p = g.pos.get(pn, -3)
                    if p != -3:
                        fi.add((c, fld, pn, p))
                        if p == 0:
                            de.add((c, 'DIRECT', c, fld))       # `@C def f`: C(f) holds f
        for mname, m in self.mods.items():
            for local, q in m.ns.items():
                a = f'{mname}.{local}'
                if a == q:
                    continue
                c = self.canon(a)
                if c and c != a and keep(c):
                    al.add((a, c))
        return cb, fi, al, de, an


def write(path, head, rows):
    tmp = path + '.tmp'
    with open(tmp, 'w', newline='', encoding='utf-8') as fh:
        w = csv.writer(fh, delimiter='\t', lineterminator='\n')
        w.writerow(head)
        for r in sorted(rows, key=lambda x: tuple(str(c) for c in x)):
            w.writerow(r)
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True); ap.add_argument('--out', required=True)
    ap.add_argument('--ir', default=None); ap.add_argument('--stats', action='store_true')
    A = ap.parse_args()
    os.makedirs(A.out, exist_ok=True)
    heads = (('py-lib-callback.csv', ('callee', 'root', 'pos', 'path', 'member', 'via', 'type')),
             ('py-lib-field-init.csv', ('class', 'field', 'param', 'pos')),
             ('py-lib-alias.csv', ('alias', 'canonical')),
             ('py-lib-decorates.csv', ('decorator', 'form', 'class', 'field')),
             ('py-lib-ancestor.csv', ('class', 'ancestor')))
    sites, stdlib = find_sites(os.path.abspath(A.src))
    if not sites:
        for f, h in heads:
            write(os.path.join(A.out, f), h, [])
        print('▶ library callbacks: no Python environment found in the repository (.venv, venv, $VIRTUAL_ENV, '
              'AXIOMCODE_PY_SITE); none summarised')
        return
    imports = client_imports(A.src, A.ir or A.out)
    # CACHED BY WHAT DECIDES THE ANSWER: this file, the client's import paths, and the installed distributions
    # (name and version from each *.dist-info) of every environment read. An edit that adds no import -- every
    # refresh but a few -- reuses the tables instead of reading the library again.
    h = hashlib.sha256()
    h.update(open(os.path.abspath(__file__), 'rb').read())
    h.update('\n'.join(sorted(imports)).encode())
    for d in sites + ([stdlib] if stdlib else []):
        h.update(d.encode())
        try:
            h.update('\n'.join(sorted(x for x in os.listdir(d) if x.endswith(('.dist-info', '.egg-info', '.pth')))).encode())
        except OSError:
            pass
    cache = os.path.join(os.environ.get('XDG_CACHE_HOME') or os.path.join(os.path.expanduser('~'), '.cache'),
                         'axiomcode', 'libsum', h.hexdigest()[:32])
    if all(os.path.isfile(os.path.join(cache, f)) for f, _ in heads):
        import shutil
        for f, _ in heads:
            shutil.copyfile(os.path.join(cache, f), os.path.join(A.out, f))
        try:
            os.utime(cache)
            print(open(os.path.join(cache, 'summary.txt'), encoding='utf-8').read().strip() + ' (cached)')
        except OSError:
            print('▶ library callbacks: reused the cached summaries')
        return
    roots = {p.split('.')[0] for p in imports}
    prog, todo, seen, client_pkgs = Program(), sorted(roots), set(), set()
    # the client's own package installed in editable mode is not a library: its top-level names in the source tree
    for n in os.listdir(A.src):
        if os.path.isfile(os.path.join(A.src, n, '__init__.py')) or n.endswith('.py'):
            client_pkgs.add(n[:-3] if n.endswith('.py') else n)
    for sub in ('src', 'lib'):
        d = os.path.join(A.src, sub)
        if os.path.isdir(d):
            for n in os.listdir(d):
                if os.path.isfile(os.path.join(d, n, '__init__.py')):
                    client_pkgs.add(n)
    nfiles = 0
    while todo:
        r = todo.pop()
        if r in seen or r in client_pkgs:
            continue
        seen.add(r)
        pkg = locate(r, sites, stdlib)
        if not pkg:
            continue
        for modname, path in pkg.files():
            m = Module(modname, path, path.endswith('__init__.py'))
            if not m.load():
                continue
            nfiles += 1
            m.analyse()
            del m.tree
            prog.add(m)
            for imp in m.imports:
                t = imp.split('.')[0]
                if t and t not in seen:
                    todo.append(t)
    rounds = prog.solve()
    prog.returns()
    lib_pkgs = {p for p in seen if p not in client_pkgs}
    named = prog.named(imports, lib_pkgs)
    keep = lambda q: q in named
    cb, fi, al, de, an = prog.rows(keep)
    for (f, h), rows in zip(heads, (cb, fi, al, de, an)):
        write(os.path.join(A.out, f), h, rows)
    line = (f'▶ library callbacks: {len(cb)} hand-backs, {len(fi)} constructor stores, {len(al)} re-exports, '
            f'{len(de)} decorators, from {nfiles} library modules ({len(lib_pkgs)} packages, {rounds} rounds)')
    print(line)
    try:
        import shutil
        tmp = cache + f'.tmp{os.getpid()}'
        os.makedirs(tmp, exist_ok=True)
        for f, _ in heads:
            shutil.copyfile(os.path.join(A.out, f), os.path.join(tmp, f))
        open(os.path.join(tmp, 'summary.txt'), 'w', encoding='utf-8').write(line + '\n')
        os.replace(tmp, cache)
        root = os.path.dirname(cache)                 # keep the 64 most recently used
        old = sorted((os.path.getmtime(os.path.join(root, x)), x) for x in os.listdir(root) if '.tmp' not in x)
        for _, x in old[:-64]:
            shutil.rmtree(os.path.join(root, x), ignore_errors=True)
    except OSError:
        pass


if __name__ == '__main__':
    main()
