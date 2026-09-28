"""What the enrich and changes hooks print about one declaration, where a bare number would mislead.

  zero_label   a method with no resolved caller. Of 323 caller counts the Read / Grep hooks printed in headless
               sessions, 209 were `← 0`, and most of those were methods a framework calls: a route handler, an
               `@app.before_request`, a scheduled job, a library override. The graph stores why for most of them,
               so the line says it: `entry (http)`, `0 resolved, 3 by name`, `? framework (@Scheduled)`. A method
               with no signal at all still reads `0`.
  body_line    an edit that changed only bodies breaks no caller; the one thing worth saying is which tests reach
               it and how to run them. The block it replaces listed 10-42 readers, and 28 of 30 went unused.

Every lookup is one indexed query per declaration (these run on every Read, Grep and Edit)."""
import importlib.machinery, importlib.util, os, sqlite3

# decorations that say nothing about who calls the method: compiler hints, language plumbing, nullness
INERT = {'Override', 'SuppressWarnings', 'Deprecated', 'Serial', 'SafeVarargs', 'FunctionalInterface', 'Nullable',
         'NonNull', 'NotNull', 'Nonnull', 'CheckReturnValue', 'VisibleForTesting', 'Generated', 'staticmethod',
         'classmethod', 'property', 'abstractmethod', 'cached_property', 'functools.wraps', 'wraps', 'override',
         'overload', 'typing.override', 'typing.overload', 'CallerMemberName', 'Obsolete', 'MethodImpl',
         'DebuggerStepThrough', 'Pure', 'Data', 'Getter', 'Setter', 'Value', 'Builder', 'ToString',
         'EqualsAndHashCode', 'NoArgsConstructor', 'AllArgsConstructor', 'RequiredArgsConstructor', 'Slf4j'}


def _has(con, t):
    return con.execute("SELECT 1 FROM sqlite_master WHERE name = ?", (t,)).fetchone() is not None


def _deco(con, owner_id):
    """the first decoration on a declaration that could mean a framework calls it, as written (`@app.before_request`)"""
    for name, text in con.execute("SELECT name, text FROM decorations WHERE owner_id = ? ORDER BY line", (owner_id,)):
        if (name or '') in INERT or (name or '').rsplit('.', 1)[-1] in INERT: continue
        t = (text or '').split('(')[0].strip() or '@' + (name or '')
        if t.startswith('[') and not t.endswith(']'): t += ']'              # a C# attribute, `[HttpGet("x")]`
        return t[:48]
    return None


def zero_label(con, mid, name, is_test=0):
    """what `← 0` means for method `mid`, from the strongest signal the graph holds:
        entry (<reason>)            the runtime invokes it: a route, a test, main, a scheduled job, a listener
        ? framework (@X)            a decoration on it that is not a compiler hint
        0 resolved, N by name       N call sites write its name on a receiver the engine could not type
        ? framework (overrides a library method)   @Override with no base in this repository
        ? framework (extends B)     its class derives from a base outside the graph (Python)
        ? framework (@X on Owner)   a decoration on its class
        0                           none of these: nothing in this graph calls it"""
    try:
        if _has(con, 'entry_points'):
            r = con.execute("SELECT reason FROM entry_points WHERE method_id = ? LIMIT 1", (mid,)).fetchone()
            if r: return f"entry ({r[0]})"
        if is_test: return "entry (test)"
        deco = _deco(con, mid) if _has(con, 'decorations') else None
        if deco: return f"? framework ({deco})"
        if name and _has(con, 'unresolved_sites'):
            n = con.execute("""SELECT count(*) FROM call_sites cs JOIN unresolved_sites u ON u.call_site_id = cs.id
                               WHERE cs.callee_name = ? AND cs.kind NOT IN ('new', 'anon_new', 'DECORATOR_APPLICATION')""",
                            (name,)).fetchone()[0]
            if n: return f"0 resolved, {n} by name"
        owner = con.execute("SELECT owner_type_id FROM methods WHERE id = ?", (mid,)).fetchone() if _has(con, 'methods') else None
        owner = owner[0] if owner else None
        if _has(con, 'decorations') and con.execute(
                "SELECT 1 FROM decorations WHERE owner_id = ? AND name = 'Override' LIMIT 1", (mid,)).fetchone() \
                and not con.execute("""SELECT 1 FROM overrides o JOIN methods b ON b.id = o.method_id
                                       WHERE o.overriding_method_id = ? AND b.provenance = 'client' LIMIT 1""", (mid,)).fetchone():
            return "? framework (overrides a library method)"
        if owner and _has(con, 'ext_type_base_unresolved'):
            r = con.execute("SELECT c3 FROM ext_type_base_unresolved WHERE c1 = ? LIMIT 1", (owner,)).fetchone()
            if r and r[0]: return f"? framework (extends {r[0]})"
        if owner and _has(con, 'decorations'):
            d = _deco(con, owner)
            if d:
                on = con.execute("SELECT name FROM types WHERE id = ?", (owner,)).fetchone() if _has(con, 'types') else None
                return f"? framework ({d}" + (f" on {on[0]}" if on else '') + ")"
    except sqlite3.Error:
        pass
    return "0"


def distinct_paths(files):
    """the shortest path suffix that tells these files apart: two `StubConverterFactory.java` in different modules print
    as `json/StubConverterFactory.java` and `xml/StubConverterFactory.java`, never as the same line twice"""
    parts = [f.split('/') for f in files]
    out = []
    for i, p in enumerate(parts):
        k = 1
        while k < len(p) and any(j != i and q[-k:] == p[-k:] for j, q in enumerate(parts)): k += 1
        out.append('/'.join(p[-k:]))
    return out


_TI = None
def _ti():
    """axiomcode-test-impact as a module, loaded once; None when it cannot be"""
    global _TI
    if _TI is None:
        p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts', 'axiomcode-test-impact')
        try:
            ld = importlib.machinery.SourceFileLoader('ax_test_impact', p)
            m = importlib.util.module_from_spec(importlib.util.spec_from_loader('ax_test_impact', ld)); ld.exec_module(m)
            _TI = m
        except Exception:
            _TI = False
    return _TI or None


def _command_for(lang, files, classes, db=None):
    """the runnable command `axiomcode test-impact` prints, from the same function"""
    try: return _ti().command_for(lang, files, classes, db)
    except Exception: return None


def _concrete(db, classes):
    """the classes a runner can run: each abstract test class replaced by the classes that extend it (test-impact)"""
    try: return _ti().concrete_test_classes(db, classes)[0]
    except Exception: return classes


import _where
LANG = {e: ls[0] for e, ls in _where.BY_EXT.items()}          # one table for every hook (_where.py)
SHOWN = 6


def body_line(db, results):
    """ONE line for an edit that changed only bodies: which declarations, how many tests reach them, how to run those.
    `results` is [(changed-declaration, impact-json)], the same pairs the blast-radius block is built from."""
    names = [d['symbol'] for d, _ in results]
    ids, owners, files = set(), set(), set()
    for d, j in results:
        ids |= set((j or {}).get('test_ids') or [])
        for t in (j or {}).get('tests') or []:                 # the rules' answer carries names, not ids
            if not (j or {}).get('_sql') and t.get('owner'): owners.add(t['owner'])
            if not (j or {}).get('_sql') and t.get('at'): files.add(t['at'].split(':')[0])
    n = len(ids) or sum(len((j or {}).get('tests') or []) for _, j in results)
    if ids:
        try:
            con = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
            idl = sorted(ids)
            for i in range(0, len(idl), 400):
                ch = idl[i:i + 400]
                for o, f in con.execute(f"SELECT owner, file FROM symbols WHERE id IN ({','.join('?' * len(ch))})", ch):
                    if o: owners.add(o)
                    if f: files.add(f)
            con.close()
        except sqlite3.Error:
            pass
    what = ', '.join(names[:3]) + (f" +{len(names) - 3}" if len(names) > 3 else '')
    if not n:
        return f"graph: body edit of {what}: no test reaches it through the graph (a lower bound)"
    lang = LANG.get(os.path.splitext(results[0][0].get('file', ''))[1], '')
    fl, cl = sorted(files), sorted(owners)
    if lang in ('java', 'csharp') and cl:
        cl = sorted(_concrete(db, cl))      # before the cut, so the command and the "+N more" count the same classes
    cmd = _command_for(lang, fl[:SHOWN], cl[:SHOWN])
    more = (len({c.split('.')[-1] for c in cl}) if lang in ('java', 'csharp') and cl else len(fl)) - SHOWN
    tail = (f"; run: {cmd}" + (f" (+{more} more: axiomcode test-impact)" if more > 0 else '')) if cmd else "; axiomcode test-impact gives the command"
    return f"graph: body edit of {what}: {n} test(s) reach it{tail}"
