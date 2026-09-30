"""What the enrich and changes hooks print about one declaration, where a bare number would mislead.

  zero_label   a method with no resolved caller. Of 323 caller counts the Read / Grep hooks printed in headless
               sessions, 209 were `← 0`, and most of those were methods a framework calls: a route handler, an
               `@app.before_request`, a scheduled job, a library override. The graph stores why for most of them,
               so the line says it: `entry (http)`, `0 resolved, 3 by name`, `? framework (@Scheduled)`. A method
               with no signal at all still reads `0`. The reason is graph_sql.no_caller_reasons, which impact and
               path read too.
  callers_via_base  the callers through an interface or base method, which impact lists and call_edges lacks.
  body_line    an edit that changed only bodies breaks no caller; the one thing worth saying is which tests reach
               it and how to run them. The block it replaces listed 10-42 readers, and 28 of 30 went unused.

Every lookup is one indexed query per declaration (these run on every Read, Grep and Edit)."""
import importlib.machinery, importlib.util, os, sqlite3

import sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts'))
import graph_sql


def _q(con):
    return lambda sql, *p: con.execute(sql, p).fetchall()


def zero_label(con, mid, name=None, is_test=0):
    """what `← 0` means for method `mid`: the FIRST reason graph_sql.no_caller_reasons gives, the one reader impact's
    `next:` and path's empty-upstream note word too, so the three never give different reasons for one method:
        entry (<reason>)            the runtime invokes it: a route, a test, main, a scheduled job, a listener
        ? framework (@X)            a decoration a framework reads (a wrapper such as a cache or a permission check is not one)
        ? framework (overrides B)   it overrides a method the graph does not contain
        ? framework (extends B)     its type derives from a base outside the graph
        ? framework (@X on Owner)   a decoration on its type
        0 resolved, N by name       N call sites write its name on a receiver the engine could not type
        0                           none of these: nothing in this graph calls it
    `name` and `is_test` are read from the graph; the parameters stay for callers that pass them."""
    try:
        rs = graph_sql.no_caller_reasons(_q(con), [mid]).get(mid) or []
        if not rs and is_test: return "entry (test)"
        if rs: return graph_sql.no_caller_label(rs[0][0], rs[0][1])
    except sqlite3.Error:
        pass
    return "0"


def callers_via_base(con, mids, repo='.'):
    """{method id: {caller id}}: the callers through an interface or base method that impact lists and call_edges does
    not hold (graph_sql.callers_via_base), read with the repository's lines so a narrowed interface-typed field counts"""
    cache = {}
    def lines(f):
        if f not in cache:
            try: cache[f] = open(os.path.join(repo, f), encoding='utf-8', errors='replace').read().splitlines()
            except OSError: cache[f] = []
        return cache[f]
    try: return graph_sql.callers_via_base(_q(con), list(mids), lines)
    except sqlite3.Error: return {}


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


def _command_for(lang, files, classes, db=None, repo='.'):
    """the runnable command `axiomcode test-impact` prints, from the same function; a TypeScript/JavaScript selection
    can need one command per package and runner, joined with '; ' here because the hook's answer is one line"""
    try: cmd = _ti().command_for(lang, files, classes, db, repo)
    except Exception: return None
    return cmd.replace("\n", "; ") if cmd else cmd


def _concrete(db, classes):
    """the classes a runner can run: each abstract test class replaced by the classes that extend it (test-impact)"""
    try: return _ti().concrete_test_classes(db, classes)[0]
    except Exception: return classes


import _where
LANG = {e: ls[0] for e, ls in _where.BY_EXT.items()}          # one table for every hook (_where.py)
SHOWN = 6


def body_line(db, results, repo='.'):
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
    cmd = _command_for(lang, fl[:SHOWN], cl[:SHOWN], None, repo)
    more = (len({c.split('.')[-1] for c in cl}) if lang in ('java', 'csharp') and cl else len(fl)) - SHOWN
    tail = (f"; run: {cmd}" + (f" (+{more} more: tests(), `axiomcode tests`)" if more > 0 else '')) if cmd else "; tests() (`axiomcode tests`) gives the command"
    return f"graph: body edit of {what}: {n} test(s) reach it{tail}"


# ── what ONE edit changed, and a base that moved under it ─────────────────────────────────────────────────────────────
# The edit hook read the file against the BASELINE (the commit the graph was built from), which only moves when the
# background refresher has rebuilt HEAD's text. After a rebase or a pull that is minutes, or never with refresh off, and
# every change the new commits made to the file came back as "this edit changed", with signature diffs garbled by the
# graph's lines landing on another text. An edit is now read against the file as it was just before the tool call.

def _snap_path(repo, session, fp):
    import hashlib
    return os.path.join(repo, '.axiomcode', f"hooks-before-{session or 'x'}", hashlib.sha1(os.path.realpath(fp).encode()).hexdigest())


def snapshot_before(repo, session, fp):
    """PreToolUse on an edit: keep the file as it is, for the PostToolUse report to diff against ('' when it is new)"""
    try:
        cur = open(fp, errors='replace').read() if os.path.exists(fp) else ''
        p = _snap_path(repo, session, fp); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as f: f.write(cur)
    except OSError:
        pass


def edit_before(tool, inp, resp, fp, repo, session):
    """the text of `fp` just before this Edit / Write / MultiEdit, or None when it cannot be known. In order: what the
    host reports (Claude Code's `originalFile`), the PreToolUse snapshot, the edit itself undone (each new_string that
    occurs exactly once put back); never the baseline, which predates a rebase or a pull"""
    snap = _snap_path(repo, session, fp); kept = None
    try:
        kept = open(snap, errors='replace').read(); os.unlink(snap)
    except OSError:
        pass
    if isinstance(resp, dict):
        o = resp.get('originalFile')
        if isinstance(o, str): return o
        if tool == 'Write' and resp.get('type') == 'create': return ''
    if kept is not None: return kept
    if tool not in ('Edit', 'MultiEdit'): return None
    try: t = open(fp, errors='replace').read()
    except OSError: return None
    edits = inp.get('edits') or ([inp] if 'new_string' in inp else [])
    if not edits: return None
    for e in reversed(edits):
        o, n = str(e.get('old_string', '')), str(e.get('new_string', ''))
        if e.get('replace_all') or not n or t.count(n) != 1: return None
        t = t.replace(n, o, 1)
    return t


def base_moved_line(repo, st):
    """one line, once per move of HEAD in a session: `st['head']` is the HEAD this session last spoke for (at first, the
    commit the baseline was set at). A rebase, a pull, a checkout, a reset or a commit moves it; what those commits
    changed is then never reported as an edit, and this says so. '' when HEAD has not moved."""
    import subprocess
    git = lambda *a: subprocess.run(['git', *a], cwd=repo, capture_output=True, text=True)
    try: h = git('rev-parse', '-q', '--verify', 'HEAD').stdout.strip()
    except Exception: return ''
    if not h: return ''
    prev = st.get('head')
    if prev is None:
        try: prev = open(os.path.join(repo, '.axiomcode', 'out', 'base-commit')).read().strip()
        except OSError: prev = h
    st['head'] = h
    if not prev or prev == h or prev == 'nogit': return ''
    n = git('rev-list', '--count', '--right-only', '--cherry-pick', f'{prev}...{h}').stdout.strip()
    return (f"graph: the base moved: HEAD is {h[:10]}, was {prev[:10]}" + (f" ({n} commit(s) it did not have)" if n.isdigit() else '')
            + " — a rebase, a pull, a checkout, a reset or a commit. What those commits changed is not reported as an edit;"
            " edits are read against the file before each one. impact(name) (`axiomcode impact <name>`) answers for a declaration they touched.")
