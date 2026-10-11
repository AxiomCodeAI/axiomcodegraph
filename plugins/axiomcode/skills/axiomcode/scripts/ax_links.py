#!/usr/bin/env python3
"""ax_links.py — call edges an agent (or a person) ASSERTS where the graph could not resolve the call.

An answer that stops at an unresolved site says so ("N unresolved call(s) inside — a lower bound") and lists the sites
(`unknown_sites`). Someone who has read the code and is certain where such a call lands records it:

    axiomcode link <file:line> <target>          the call written at file:line reaches <target>
    axiomcode link                               every link, and whether the graph took it
    axiomcode link <file:line> -                 remove the links at that site (or: --remove <file:line> [<target>])

THE FILE. Links live in `axiomcode-links.tsv` at the repository root (AXIOMCODE_LINKS overrides it), not under
.axiomcode/. Everything under .axiomcode/ is derived and is deleted freely (a corrupt graph, an engine change, a user
clearing it); a link is knowledge someone read the code to get, so it must outlive the graph, and it is reviewed and
shared like any other file a team commits. The line's text is hashed into each row, so a committed link that no longer
describes the code is dropped by the graph rather than trusted.

THE RULE. A link may only ADD an edge, never remove or relabel one (the rule runtime-observed.dl states for a trace).
Each is validated against the graph it is applied to, and applied only if:
  (a) a call site is written at that line (followed by the line's TEXT when lines above it moved: the nearest line with
      the same text and a call of the same name), and the call as written is consistent with the target: the same name,
      the class a constructor belongs to, or a call through a value (the name as written declares nothing in the graph,
      a computed or reflective call, or a site the engine itself says is a call through a parameter or value);
  (b) the target is a declaration in the graph (a client callable, or a staged library method), named as the graph
      names it, in the file the link recorded;
  (c) the line's text still hashes the same.
An applied link is a call_edges row of tier `asserted` (certainty `asserted`, never `resolved`). A rejected or stale
one is recorded in the graph's `asserted_links` table with the reason, listed by `axiomcode link`, and counted on the
next answer's note line. Applying is O(links): it runs at the end of every index (axiomcode-index), so a rebuild keeps
them, and on `link` itself against the existing graphs, with the derived facts patched in place (no re-solve).
"""
import hashlib, json, os, re, sqlite3, subprocess, sys, time

FILE_NAME = 'axiomcode-links.tsv'
COLS = ('file', 'line', 'line_sha', 'callee', 'caller', 'target', 'target_file', 'by', 'at', 'col', 'ncol', 'not')
HEADER = ('# axiomcode links: call edges asserted where the graph could not resolve the call. '
          'Written by `axiomcode link`; one per line, tab-separated: ' + ' '.join(COLS))
TIER = 'asserted'
# a call whose callee is computed, or invoked through a value: the name as written says nothing about what runs
VALUE_KINDS = {'DYNAMIC_CALL', 'SUBSCRIPT_CALL', 'UNKNOWN_CALLEE_CALL', 'COMPUTED_CALL', 'FUNCTION_CALL_APPLY',
               'FUNCTION_CALL_CALL', 'FUNCTION_CALL_BIND', 'IIFE_CALL', 'DYNAMIC_CODE_CALL'}
# the engine's own reason (ext_call_site_unresolved) when it says the callee is a value it could not follow
VALUE_REASONS = ('callee_is_parameter', 'dynamic_call', 'escape_hatch', 'unbound_name', 'untyped_receiver:subscript_untyped',
                 'member_absent_from_type', 'untyped_receiver:attribute_absent_on_type', 'computed_attribute_name',
                 'value_callee', 'callee_is_value', 'callee_is_local', 'callee_is_field')
# the methods every language invokes a held callable or a reflected member through
REFLECTIVE = {'invoke', 'Invoke', 'DynamicInvoke', 'InvokeMember', 'apply', 'call', 'accept', 'test', 'run',
              'applyAsInt', 'applyAsLong', 'applyAsDouble', 'handle', 'execute', 'Execute', '__call__', 'emit', 'dispatch'}
RANK = {'applied': 0, 'moved': 1, 'redundant': 2, 'changed': 3, 'stale': 3, 'rejected': 4, 'malformed': 5}
# the library methods that run a callable or a member someone else chose: a site resolved to one of them is as unknown as an
# unresolved one, and is listed with them (unknown_sites)
REFLECTIVE_LIB = {'invoke', 'Invoke', 'DynamicInvoke', 'InvokeMember', 'newInstance', 'CreateInstance', 'apply', 'accept',
                  'test', 'run', 'call', 'applyAsInt', 'applyAsLong', 'applyAsDouble', 'Execute'}
# a call written on a receiver (`x.m()`): its callee as written is a member name, not a value
MEMBER_KINDS = {'METHOD_CALL', 'SELF_CALL', 'SUPER_CALL', 'CHAINED_CALL', 'OPTIONAL_CALL', 'PROPERTY_READ', 'PROPERTY_WRITE',
                'CONTEXT_MANAGER', 'ITERATION_PROTOCOL', 'BUILTIN_PROTOCOL', 'DECORATOR_ATTRIBUTE'}
CTOR_KINDS = {'new', 'CONSTRUCTOR_CALL', 'anon_new', 'METACLASS_CREATION', 'object_creation', 'OBJECT_CREATION'}
CTOR_NAMES = {'__init__', '<init>', 'constructor', '.ctor', '__new__'}


def norm(text):
    return re.sub(r'\s+', ' ', (text or '').strip())


def line_sha(text):
    return hashlib.sha1(norm(text).encode('utf-8', 'replace')).hexdigest()[:12]


def norm_col(text, col):
    """a 1-based column of a line as an offset into the line's normalized text (norm): the same call keeps it when the
    line is re-indented or its spacing changes, which is how a link follows a call by its place within the line"""
    pre = re.sub(r'\s+', ' ', (text or '')[:max(0, col - 1)].lstrip())
    return len(pre)


def denorm_col(text, off):
    """the 1-based column of the line whose normalized offset is off (norm_col's inverse), or None past the end"""
    i, n, t = 0, 0, text or ''
    while i < len(t) and t[i].isspace(): i += 1
    while i < len(t):
        if n == off: return i + 1
        if t[i].isspace():
            while i < len(t) and t[i].isspace(): i += 1
            n += 1
        else: i += 1; n += 1
    return i + 1 if n == off else None


def links_path(repo):
    return os.environ.get('AXIOMCODE_LINKS') or os.path.join(repo, FILE_NAME)


def file_sha(repo):
    try:
        with open(links_path(repo), 'rb') as fh: return hashlib.sha1(fh.read()).hexdigest()[:16]
    except OSError: return ''


def read_links(repo):
    """([link dict with 'n' = its line in the file], [(n, raw, why)] malformed lines). A bad line costs only itself."""
    out, bad = [], []
    try:
        with open(links_path(repo), encoding='utf-8', errors='replace') as fh: rows = fh.read().split('\n')
    except OSError: return out, bad
    for n, raw in enumerate(rows, 1):
        if not raw.strip() or raw.lstrip().startswith('#'): continue
        parts = raw.split('\t')
        if len(parts) < 6:
            bad.append((n, raw, f'expected at least 6 tab-separated fields ({", ".join(COLS[:6])}), found {len(parts)}')); continue
        d = dict(zip(COLS, parts + [''] * (len(COLS) - len(parts))))
        if not d['file'] or not d['target'] or not re.fullmatch(r'\d+', d['line'].strip() or 'x'):
            bad.append((n, raw, 'the file, a numeric line and the target are required')); continue
        d['line'] = int(d['line']); d['n'] = n
        d['col'] = int(d['col']) if str(d.get('col') or '').isdigit() else None
        d['ncol'] = int(d['ncol']) if str(d.get('ncol') or '').isdigit() else None
        d['not'] = str(d.get('not') or '').strip().lower() in ('1', 'not', 'yes', 'true')
        out.append(d)
    return out, bad


def write_links(repo, links):
    p = links_path(repo); tmp = f"{p}.{os.getpid()}.tmp"
    keep = []
    try:
        with open(p, encoding='utf-8', errors='replace') as fh:
            keep = [l for l in fh.read().split('\n') if l.lstrip().startswith('#') and l.strip() != HEADER]
    except OSError: pass
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(HEADER + '\n')
        for l in keep: fh.write(l + '\n')
        for d in links:
            d = dict(d, **{'not': 'not' if d.get('not') else ''})
            fh.write('\t'.join(('' if d.get(c) is None else str(d.get(c))).replace('\t', ' ').replace('\n', ' ') for c in COLS).rstrip('\t') + '\n')
    os.replace(tmp, p)


# ── the graphs of a repository and the text each describes ──────────────────────────────────────────────────
def graph_dbs(repo):
    """[(db path, source reader, live?)] for every graph under .axiomcode: the main and each language's, and the baseline
    graphs `changed` / `tests` read, whose text is the tree they were built from"""
    ax = os.path.join(repo, '.axiomcode'); out, seen = [], set()
    def add(db, reader, live):
        try: rp = os.path.realpath(db)
        except OSError: return
        if os.path.isfile(rp) and rp not in seen: seen.add(rp); out.append((db, reader, live))
    work = Reader(repo)
    add(os.path.join(ax, 'out', 'graph.sqlite'), work, True)
    lang = os.path.join(ax, 'lang')
    for l in sorted(os.listdir(lang)) if os.path.isdir(lang) else []: add(os.path.join(lang, l, 'out', 'graph.sqlite'), work, True)
    base = os.path.join(ax, 'base')
    if os.path.isdir(base):
        try: tree = open(os.path.join(base, 'tree')).read().strip()
        except OSError: tree = ''
        br = Reader(repo, tree) if tree else None
        if br:
            add(os.path.join(base, 'out', 'graph.sqlite'), br, False)
            bl = os.path.join(base, 'lang')
            for l in sorted(os.listdir(bl)) if os.path.isdir(bl) else []: add(os.path.join(bl, l, 'out', 'graph.sqlite'), br, False)
    return out


class Reader:
    """a file's lines: the working tree's, or (tree given) the text of that git tree"""
    def __init__(self, repo, tree=None):
        self.repo, self.tree, self.cache = repo, tree, {}
    def lines(self, f):
        if f not in self.cache:
            txt = None
            if self.tree:
                try:
                    r = subprocess.run(['git', 'cat-file', 'blob', f'{self.tree}:{f}'], cwd=self.repo, capture_output=True, timeout=20)
                    if r.returncode == 0: txt = r.stdout.decode('utf-8', 'replace')
                except (OSError, subprocess.SubprocessError): pass
            else:
                try:
                    with open(os.path.join(self.repo, f), encoding='utf-8', errors='replace') as fh: txt = fh.read()
                except OSError: pass
            self.cache[f] = txt.split('\n') if txt is not None else None
        return self.cache[f]


# ── one graph ────────────────────────────────────────────────────────────────────────────────────────────────
class Graph:
    def __init__(self, con):
        self.con = con
        self.tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
        self._raw = None; self._names = None
        self.lang = ''
        if 'run' in self.tables:
            r = self.q("SELECT value FROM run WHERE key = 'language'")
            self.lang = r[0][0] if r else ''
        # call_sites columns: 1-based for the TypeScript / JavaScript front ends, 0-based for the others
        self.base = 1 if self.lang in ('typescript', 'javascript') else 0
        self.reader = None
    def q(self, sql, *a): return self.con.execute(sql, a).fetchall()
    def raw_paths(self, f):
        """the spellings call_sites.file_path uses for the repo-relative file f"""
        if 'paths' in self.tables:
            r = [x[0] for x in self.q("SELECT raw FROM paths WHERE rel = ?", f)]
            if r: return r
        return [f]
    def rel(self, raw):
        if self._raw is None:
            self._raw = dict(self.q("SELECT raw, rel FROM paths")) if 'paths' in self.tables else {}
        return self._raw.get(raw, raw)
    def sites_on(self, f, line, text=None):
        """the call sites starting on that line, each with `col`: the 1-based column of its callee's NAME as written (of
        the call's start when it has none), the column an answer prints and `link` takes; s0/e0 its span on the line"""
        raws = self.raw_paths(f); ph = ','.join('?' * len(raws))
        rows = self.q(f"SELECT id, caller_id, kind, callee_name, start_line, end_line, start_column, end_column FROM call_sites "
                      f"WHERE file_path IN ({ph}) AND start_line = ?", *raws, line)
        out = []
        for sid, c, k, n, l, el, sc, ec in rows:
            s0 = max(0, (sc or 0) - self.base)
            e0 = ((ec or 0) - self.base) if el == l and ec is not None else len(text or '')
            out.append(dict(id=sid, caller=c, kind=k, callee=n, line=l, end=el, s0=s0, e0=e0, col=name_col(text, n, s0, e0)))
        return out
    def reason(self, sid):
        if 'ext_call_site_unresolved' not in self.tables: return ''
        r = self.q("SELECT c2 FROM ext_call_site_unresolved WHERE c0 = ? LIMIT 1", sid)
        return r[0][0] if r else ''
    def unresolved(self, sid):
        return bool('unresolved_sites' in self.tables and self.q("SELECT 1 FROM unresolved_sites WHERE call_site_id = ? LIMIT 1", sid))
    def declares(self, name):
        """does a CALLABLE in this graph (a client or staged library method or function, or a type) carry this simple name?
        A field, a variable or a parameter of that name holds a value, which is exactly what a link may name the target of"""
        if self._names is None:
            self._names = {r[0] for r in self.q("SELECT DISTINCT name FROM symbols WHERE name IS NOT NULL AND (method_id IS NOT NULL OR type_id IS NOT NULL)")} if 'symbols' in self.tables else set()
            self._names |= {r[0] for r in self.q("SELECT DISTINCT name FROM methods")}
            if 'types' in self.tables:
                try: self._names |= {r[0] for r in self.q("SELECT DISTINCT name FROM types")}
                except sqlite3.Error: pass
        return name in self._names
    def holds_value(self, name):
        """is this name declared as a field / variable / constant (an attribute that can hold a callable)?"""
        if getattr(self, '_fields', None) is None:
            self._fields = {r[0] for r in self.q("SELECT DISTINCT name FROM symbols WHERE name IS NOT NULL AND method_id IS NULL AND type_id IS NULL")} if 'symbols' in self.tables else set()
            if 'fields' in self.tables:
                try: self._fields |= {r[0] for r in self.q("SELECT DISTINCT name FROM fields")}
                except sqlite3.Error: pass
        return name in self._fields
    def display(self, sid):
        r = self.q("SELECT display FROM symbols WHERE id = ? LIMIT 1", sid)
        return r[0][0] if r else sid

    def targets(self, target, tfile=''):
        """[(method id, display, file, provenance, simple name, kind, owner)] for a target as the graph names it"""
        out = []
        hint = None
        mh = re.fullmatch(r'(.+):(\d+)', tfile or '')
        if mh: tfile, hint = mh.group(1), int(mh.group(2))
        m = re.fullmatch(r'(.+\.\w+):(\d+)', target)        # a declaration by its file:line
        if m:
            rows = self.q("SELECT method_id, display, file, name, kind, owner, line FROM symbols WHERE file = ? AND line = ? AND method_id IS NOT NULL "
                          "AND kind <> 'module'", m.group(1), int(m.group(2)))
        else:
            rows = self.q("SELECT method_id, display, file, name, kind, owner, line FROM symbols WHERE (display = ? OR qualified_name = ?) "
                          "AND method_id IS NOT NULL AND kind <> 'module'", target, target)
        rows = [r for r in rows if not tfile or r[2] == tfile]
        # several declarations of one name in one file (overloads, an @overload stub beside its body): the one nearest the
        # line the link recorded it at, which survives an edit that moves it a few lines
        if hint is not None and len({r[0] for r in rows}) > 1:
            rows = sorted(rows, key=lambda r: abs((r[6] or 0) - hint))[:1]
        for mid, disp, f, name, kind, owner, _ln in rows:
            out.append((mid, disp, f, 'client', name, kind, owner))
        if not out and not tfile:
            for mid, qn, name, prov in self.q("SELECT id, qualified_name, name, provenance FROM methods WHERE qualified_name = ? AND provenance <> 'client'", target):
                out.append((mid, qn, '', prov, name, 'method', qn.rsplit('.', 2)[-2] if qn.count('.') >= 1 else ''))
        seen, uniq = set(), []
        for t in out:
            if t[0] not in seen: seen.add(t[0]); uniq.append(t)
        return uniq


def name_col(text, callee, s0, e0):
    """1-based column of the callee's name inside the call's span on its line (the LAST occurrence: `h(x).run()` names run
    after h), else of the span's start"""
    nm = (callee or '').split('.')[-1].split('::')[-1]
    if text and nm:
        seg = text[s0:max(e0, s0)] if e0 and e0 > s0 else text[s0:]
        k = -1
        for m in re.finditer(r'(?<![\w$])' + re.escape(nm) + r'(?![\w$])', seg): k = m.start()
        if k >= 0: return s0 + k + 1
    return s0 + 1


def stable_name(g, mid, display, tfile):
    """the name a link records for its target: the display when it names one declaration in that file, else the qualified
    name (a nested `decorator` is one of five in its file), else the display as it is. A line number would go stale with
    the first edit above it, so it is never what is recorded."""
    if len(g.targets(display, tfile)) <= 1: return display, tfile
    r = g.q("SELECT qualified_name FROM symbols WHERE method_id = ? AND qualified_name IS NOT NULL LIMIT 1", mid)
    if r and r[0][0] and len(g.targets(r[0][0], tfile)) == 1: return r[0][0], tfile
    # overloads share both names: the file carries the declaration's line as a hint (Graph.targets takes the nearest)
    ln = g.q("SELECT line FROM symbols WHERE method_id = ? AND file = ? LIMIT 1", mid, tfile)
    return display, (f"{tfile}:{ln[0][0]}" if ln else tfile)


def is_value_lib(g, sid):
    """a site resolved only into a library method that runs a value (Method.invoke, Function.apply)"""
    rows = g.q("SELECT e.tier, s.callee_name FROM call_edges e JOIN call_sites s ON s.id = e.call_site_id WHERE e.call_site_id = ?", sid)
    return bool(rows) and all(t == 'boundary_lib' and (n or '').split('.')[-1] in REFLECTIVE_LIB for t, n in rows)


def consistent(g, site, tname, tkind, towner):
    """'' when the call as written may be a call to the target, else why not"""
    callee = (site['callee'] or '').split('.')[-1].split('::')[-1]
    owner_simple = (towner or '').split('.')[-1]
    if callee and callee == tname: return ''
    if callee and (tname in CTOR_NAMES or tkind in ('constructor', 'class')) and callee in (owner_simple, tname): return ''
    # a CONSTRUCTION names its type: `new Error(…)` builds an Error whatever the graph declares, never some other function
    if site['kind'] in CTOR_KINDS:
        return f"the call constructs `{site['callee']}`; a construction is linked only to that type's constructor"
    if site['kind'] in VALUE_KINDS: return ''
    if callee in REFLECTIVE: return ''
    rsn = g.reason(site['id'])
    if any(rsn.startswith(v) for v in VALUE_REASONS): return ''
    # a MEMBER call on a receiver the engine could not type (`x.index()`): the member's name is what it calls, most often
    # a library method's; it is linked only to a declaration of that name
    member = site['kind'] in MEMBER_KINDS or rsn.startswith('untyped_receiver')
    if not callee or (not g.declares(callee) and (not member or g.holds_value(callee))): return ''   # a local, a parameter, a field holding a value
    if member and not g.declares(callee):
        return (f"the call is to the member `{site['callee']}` of a receiver the graph could not type — most likely a library "
                f"method of that name, not `{tname}`; a member call is linked only to a declaration of its own name, or where "
                f"the member is a field holding a callable")
    return (f"the call as written names `{site['callee']}`, which is a declaration in the graph and not `{tname}`; "
            f"a link is taken where the call goes through a value (a parameter, a local, a table, getattr / reflection), "
            f"or names the target itself")


def locate(g, reader, link):
    """(line now, [sites on it], status reason). Follows the line by its text when lines above it moved."""
    L = reader.lines(link['file'])
    if L is None: return None, [], 'stale: the file is gone'
    want = link.get('line_sha') or ''
    n = link['line']
    at = lambda i: g.sites_on(link['file'], i, L[i - 1] if 0 < i <= len(L) else '')
    if 0 < n <= len(L) and (not want or line_sha(L[n - 1]) == want):
        return n, at(n), ''
    if not want: return None, [], 'stale: the line is past the end of the file'
    cands = [i for i, t in enumerate(L, 1) if line_sha(t) == want]
    callee = link.get('callee') or ''
    with_site = []
    for i in cands:
        # the same text in ANOTHER callable is another call: a moved line is followed only within the callable it was
        # written in (`return fn(doc)` is a line many functions share)
        ss = [s for s in at(i) if (not callee or s['callee'] == callee)
              and (not link.get('caller') or g.display(s['caller']) == link['caller'])]
        if ss: with_site.append((abs(i - n), i, ss))
    if not with_site:
        return None, [], 'stale: the line was edited (no line with its text and that call is left in ' + (f"{link['caller']})" if link.get('caller') else 'the file)')
    with_site.sort()
    if len(with_site) > 1 and with_site[0][0] == with_site[1][0]:
        return None, [], f"stale: the line's text now appears at lines {with_site[0][1]} and {with_site[1][1]}, equally near"
    return with_site[0][1], with_site[0][2], ''


def resolve(g, reader, link):
    """-> dict(status, reason, line, site, caller, target id, display, provenance)"""
    r = dict(status='rejected', reason='', line=None, site=None, caller=None, callee_id=None, target_display=link['target'], prov='client')
    ts = g.targets(link['target'], link.get('target_file') or '')
    if not ts:
        r['reason'] = ('the target is not a declaration in this graph' + (f" in {link['target_file']}" if link.get('target_file') else '')
                       + ' (renamed, deleted or moved?)'); r['status'] = 'stale' if link.get('target_file') else 'rejected'
        return r
    if len(ts) > 1:
        r['reason'] = f"the target names {len(ts)} declarations ({', '.join(sorted({t[2] or '<library>' for t in ts})[:4])}): name it as file:line"; return r
    mid, disp, tf, prov, tname, tkind, towner = ts[0]
    r.update(callee_id=mid, target_display=disp, prov=prov, target_file=tf)
    line, sites, why = locate(g, reader, link)
    if why: r.update(status='stale', reason=why); return r
    r['line'] = line
    if not sites:
        r['reason'] = f"no call is written at {link['file']}:{line}"; return r
    callee = link.get('callee') or ''
    if callee: sites = [s for s in sites if s['callee'] == callee] or sites
    # A COLUMN NAMES ONE CALL: the call whose name starts there, read through the line's normalized text so a re-indented
    # or re-spaced line keeps it. A column that names no call on the line is stale, never a nearby guess.
    if link.get('col') or link.get('ncol') is not None:
        L = reader.lines(link['file']) or []
        text = L[line - 1] if 0 < line <= len(L) else ''
        col = denorm_col(text, link['ncol']) if link.get('ncol') is not None else link['col']
        at_line = sites
        sites = [s for s in sites if s['col'] == col]
        if not sites:
            have = ', '.join(str(x['col']) for x in sorted(at_line, key=lambda x: x['col']))
            r.update(status='stale', reason=f"stale: no call's name starts at column {col} of {link['file']}:{line} (calls there: column {have})"); return r
    # the engine already made this very edge: nothing to add, whatever the call as written says
    for s_ in sites:
        if g.q("SELECT 1 FROM call_edges WHERE call_site_id = ? AND callee_method_id = ? AND tier <> ? LIMIT 1", s_['id'], mid, TIER):
            r.update(status='redundant', reason='the graph already has this edge', site=s_['id'], caller=s_['caller'], kind=s_['kind'],
                     callee_written=s_['callee'])
            return r
    ok = [(s, consistent(g, s, tname, tkind, towner)) for s in sites]
    good = [s for s, w in ok if not w]
    if not good:
        r['reason'] = ok[0][1]; return r
    if len(good) > 1:
        # the one call named like the target; else the calls the graph could not follow (an unresolved site, or one into a
        # library method that runs a value) over the ones it resolved
        un = [s for s in good if g.unresolved(s['id']) or is_value_lib(g, s['id'])]
        named = [s for s in good if (s['callee'] or '').split('.')[-1] == tname]
        good = named if len(named) == 1 else un if un else good
    if len(good) > 1 and len({(x['callee'], x['col']) for x in good}) == 1:
        # one call written once and recorded twice (a decorator factory's call and the decoration applying its result):
        # the call itself
        good = sorted(good, key=lambda x: (x['kind'] or '').endswith('APPLICATION'))[:1]
    if len(good) > 1:
        # NEVER CHOOSE between two calls the link could mean (`a.run() + b.run()`, `f(a)(b)`): the column says which
        which = ', '.join(f"`{x['callee'] or '?'}` at column {x['col']}" for x in sorted(good, key=lambda x: x['col']))
        r['reason'] = (f"{len(good)} calls on that line could be it ({which}): "
                       f"give the column, `axiomcode link {link['file']}:{line}:<col> {link['target']}`"); return r
    s = good[0]
    r.update(site=s['id'], caller=s['caller'], kind=s['kind'], callee_written=s['callee'], col=s['col'], s0=s['s0'], e0=s['e0'])
    if g.q("SELECT 1 FROM call_edges WHERE call_site_id = ? AND callee_method_id = ? AND tier <> ? LIMIT 1", s['id'], mid, TIER):
        r.update(status='redundant', reason='the graph already has this edge'); return r
    r['status'] = 'applied' if line == link['line'] else 'moved'
    if r['status'] == 'moved': r['reason'] = f"followed by its text from line {link['line']} to {line}"
    return r



# ── what a link makes resolvable AFTER it: calls on the linked call's result ────────────────────────────────────
# A link names a declaration, so the type its call returns is known: a call chained on the result (`h(req).render()`)
# or made on a local assigned from it (`x = h(req)` … `x.render()`) resolves to that type's member, at apply time and with
# no re-solve. Each such edge is `asserted` too, remembers the link it came from, and goes when that link goes.
WRAPPERS = {'Optional', 'Promise', 'PromiseLike', 'Task', 'ValueTask', 'Awaitable', 'Coroutine', 'Future', 'CompletableFuture',
            'Final', 'Annotated', 'Readonly', 'Mono', 'Deferred'}
ELEMENT_OF = {'list', 'List', 'Iterable', 'Iterator', 'Sequence', 'Collection', 'Set', 'set', 'tuple', 'Tuple', 'Array', 'ReadonlyArray',
              'IEnumerable', 'IList', 'ICollection', 'IReadOnlyList', 'IReadOnlyCollection', 'Stream', 'Generator', 'AsyncIterable',
              'AsyncIterator', 'IAsyncEnumerable', 'ArrayList', 'LinkedList', 'HashSet', 'frozenset'}
DECL_WORDS = r'(?:const|let|var|val|final|auto|readonly)'


def split_generic(t):
    """`Optional[Response]` / `Task<List<Order>>` -> ('Optional', ['Response']) ; `Response` -> ('Response', [])"""
    t = (t or '').strip().strip('"\'').strip()
    m = re.match(r'^([\w.$]+)\s*[\[<](.*)[\]>]\s*$', t)
    if not m: return t, []
    args, depth, cur = [], 0, ''
    for ch in m.group(2):
        if ch in '[<(': depth += 1
        elif ch in ']>)': depth -= 1
        if ch == ',' and depth == 0: args.append(cur.strip()); cur = ''
        else: cur += ch
    if cur.strip(): args.append(cur.strip())
    return m.group(1), args


def clean_type(t, owner=''):
    """an annotation as written -> the simple name of the type a call of it returns (wrappers, Optional and `| None` off)"""
    t = (t or '').strip().strip('"\'').strip().rstrip('?!').strip()
    if not t: return ''
    parts = [x.strip() for x in re.split(r'\|', t) if x.strip() not in ('None', 'null', 'undefined', 'void')] if '|' in t and '<' not in t and '[' not in t else [t]
    if len(parts) != 1: return ''
    t = parts[0]
    if t.endswith('[]'): return ''                                        # an array: its element is element_type's
    head, args = split_generic(t)
    last = head.split('.')[-1]
    if last in WRAPPERS and args: return clean_type(args[0], owner)
    if last in ('Self', 'this') and owner: return owner.split('.')[-1]
    return last


def element_type(t):
    head, args = split_generic((t or '').strip().strip('"\''))
    if head.split('.')[-1] in WRAPPERS and args: return element_type(args[0])
    if head.split('.')[-1] in ELEMENT_OF and args: return clean_type(args[0])
    m = re.match(r'^(.+)\[\]$', (t or '').strip())                       # T[]
    return clean_type(m.group(1)) if m else ''


class Types:
    def __init__(self, g, reader):
        self.g, self.reader, self.memo = g, reader, {}
    def type_named(self, name):
        if not name: return None
        rows = {(t, d) for t, d in self.g.q("SELECT type_id, display FROM symbols WHERE type_id IS NOT NULL AND method_id IS NULL AND (name = ? OR display = ?)", name, name)}
        return sorted(rows)[0] if len(rows) == 1 else None
    def owner_type(self, mid):
        r = self.g.q("SELECT owner_type_id FROM methods WHERE id = ?", mid)
        if r and r[0][0]:
            d = self.g.q("SELECT display FROM symbols WHERE type_id = ? AND method_id IS NULL LIMIT 1", r[0][0])
            return (r[0][0], d[0][0] if d else r[0][0])
        return None
    def declared(self, mid):
        """the return type as WRITTEN: (text, how) from the declaration's own header (generics and arrays as written), else the graph's type_use"""
        g = self.g
        sy = g.q("SELECT name, file, line, end_line FROM symbols WHERE method_id = ? AND file IS NOT NULL LIMIT 1", mid)
        if not sy: return None
        name, f, ln, end = sy[0]
        L = self.reader.lines(f) or []
        # the header only: up to the line that opens the body (a Python `:` at the end of a line, else `{` / `=>` / `;`)
        hl = []
        for t in L[ln - 1: min(len(L), ln + 11)]:
            hl.append(t)
            if (g.lang == 'python' and re.search(r':\s*(#.*)?$', t)) or (g.lang != 'python' and re.search(r'[{;]|=>', t)): break
        head = ' '.join(hl)
        lang = g.lang
        if lang == 'python':
            m = re.search(r'\bdef\s+' + re.escape(name) + r'\s*\(.*?\)\s*->\s*(.+?)\s*:(?:\s|$)', head)
            if m: return (m.group(1), 'annotation')
        elif lang == 'typescript':
            m = re.search(re.escape(name) + r'\s*(?:<[^>]*>)?\s*\((?:[^()]|\([^()]*\))*\)\s*:\s*([^={;]+?)\s*(?:\{|=>|;|$)', head)
            if m: return (m.group(1), 'declared')
        elif lang in ('java', 'csharp'):
            m = re.search(r'([\w.$]+(?:\s*<[^()]*?>)?(?:\[\])?\??)\s+' + re.escape(name) + r'\s*(?:<[^>]*>)?\s*\(', head)
            if m and m.group(1) not in ('new', 'return', 'void', 'else'): return (m.group(1), 'declared')
        if lang in ('javascript', 'typescript'):
            # the doc comment directly above the declaration, and only that one
            k = ln - 2
            while k >= 0 and k >= ln - 40 and re.match(r'\s*(/\*\*|\*|\*/|//|@)', L[k]):
                m = re.search(r'@returns?\s*\{([^}]+)\}', L[k])
                if m: return (m.group(1), 'JSDoc')
                k -= 1
        # the graph's own type_use when the header says nothing the patterns read
        if 'type_use' in g.tables:
            rows = g.q("SELECT tu.depth, COALESCE(sy.display, ty.name) FROM type_use tu LEFT JOIN symbols sy ON sy.type_id = tu.type_id AND sy.method_id IS NULL "
                       "LEFT JOIN types ty ON ty.id = tu.type_id WHERE tu.owner_method_id = ? AND tu.context = 'METHOD_RETURN' ORDER BY tu.depth", mid) if 'types' in g.tables else []
            names = [n for _d, n in rows if n]
            if names: return (names[0] + (f"<{', '.join(names[1:])}>" if len(names) > 1 else ''), 'declared')
        return None

    def inferred(self, mid):
        """the type every `return` of the body names: `self` / `this` (the owner), `new T(…)` / `T(…)` of a type in the graph"""
        sy = self.g.q("SELECT file, line, end_line FROM symbols WHERE method_id = ? AND file IS NOT NULL LIMIT 1", mid)
        if not sy: return None
        f, ln, end = sy[0]
        L = self.reader.lines(f) or []
        got = set()
        for t in L[ln - 1: (end or ln)]:
            m = re.search(r'\breturn\s+(?:await\s+)?(.+?)\s*;?\s*}?\s*$', t)
            if not m: continue
            v = m.group(1)
            if re.fullmatch(r'(self|this)', v): o = self.owner_type(mid); got.add(o[1].split('.')[-1] if o else '?'); continue
            m2 = re.match(r'(?:new\s+)?([A-Za-z_$][\w$.]*)\s*(?:<[^>]*>)?\s*\(', v)
            if m2 and self.type_named(m2.group(1).split('.')[-1]): got.add(m2.group(1).split('.')[-1]); continue
            got.add('?')
        return (got.pop(), 'inferred from its returns') if len(got) == 1 and '?' not in got else None
    def returns(self, mid):
        """-> (type_id, display, how, element type text or '') for what a call of mid returns, or None"""
        if mid in self.memo: return self.memo[mid]
        g = self.g; out = None
        sy = g.q("SELECT name, kind FROM symbols WHERE method_id = ? LIMIT 1", mid)
        nm, kind = sy[0] if sy else ('', '')
        if nm in CTOR_NAMES or kind == 'constructor':
            o = self.owner_type(mid)
            if o: out = (o[0], o[1], 'constructs it', '')
        if out is None:
            d = self.declared(mid)
            o = self.owner_type(mid)
            if d:
                t = clean_type(d[0], o[1] if o else '')
                tt = self.type_named(t)
                if tt: out = (tt[0], tt[1], d[1], '')
                else:
                    el = element_type(d[0])
                    if el and self.type_named(el): out = (None, d[0], d[1], el)
            if out is None:
                i = self.inferred(mid)
                tt = self.type_named(i[0]) if i else None
                if tt: out = (tt[0], tt[1], i[1], '')
        self.memo[mid] = out
        return out
    def member(self, type_id, name):
        """(method id, display) of the member `name` on the type or the nearest base declaring it"""
        g = self.g; seen = []; todo = [type_id]
        while todo and len(seen) < 30:
            t = todo.pop(0)
            if t in seen: continue
            seen.append(t)
            r = g.q("SELECT m.id, COALESCE(sy.display, m.qualified_name) FROM methods m LEFT JOIN symbols sy ON sy.method_id = m.id "
                    "WHERE m.owner_type_id = ? AND m.name = ? LIMIT 1", t, name)
            if r: return r[0]
            if 'type_ancestors' in g.tables:
                todo += [a for (a,) in g.q("SELECT ancestor_type_id FROM type_ancestors WHERE type_id = ?", t)]
        return None


def derive(g, reader, res, cap=60):
    """-> ([(site id, caller id, method id, label, how)], note) for the calls on the linked call's result"""
    T = Types(g, reader)
    rt = T.returns(res['callee_id'])
    if not rt: return [], 'return type unknown, calls on its result stay unknown'
    f, line = res['file'], res['line']
    L = reader.lines(f) or []
    text = L[line - 1] if 0 < line <= len(L) else ''
    out = []
    def site_at(ln, name, col0):
        for s in g.sites_on(f, ln, L[ln - 1] if 0 < ln <= len(L) else ''):
            if (s['callee'] or '').split('.')[-1] == name and s['col'] == col0 + 1: return s
        return None
    def chain(ln, pos, t, how):
        """walk `.m()` / `.attr` segments after column pos (0-based) of line ln, starting from type t"""
        seg_text = L[ln - 1] if 0 < ln <= len(L) else ''
        depth = 0
        while t and t[0] and depth < 8 and len(out) < cap:
            m = re.match(r'\s*(?:\)\s*)*(?:!\s*)?\??\.\s*([A-Za-z_$][\w$]*)\s*(?:<[^<>()]*>)?\s*(\()?', seg_text[pos:])
            if not m: return
            name, is_call = m.group(1), bool(m.group(2))
            mem = T.member(t[0], name)
            if not mem: return
            name0 = pos + m.start(1)
            if is_call:
                s = site_at(ln, name, name0)
                if not s: return
                if not g.q("SELECT 1 FROM call_edges WHERE call_site_id = ? AND callee_method_id = ? AND tier <> ?", s['id'], mem[0], TIER):
                    out.append((s['id'], s['caller'], mem[0], mem[1], f"{how}: on the result, {t[1]}", s['kind']))
                pos = s['e0']
            else:
                s = site_at(ln, name, name0)                       # a property read the parser recorded as a call
                if s and not g.q("SELECT 1 FROM call_edges WHERE call_site_id = ? AND callee_method_id = ? AND tier <> ?", s['id'], mem[0], TIER):
                    out.append((s['id'], s['caller'], mem[0], mem[1], f"{how}: a property of the result, {t[1]}", s['kind']))
                pos = name0 + len(name)
            t = T.returns(mem[0]); how = 'derived'; depth += 1
    # (1) chained on the same expression
    chain(line, res['e0'], rt, 'derived')
    # (2) a local assigned from it, or an element of it
    before = text[:res['s0']]
    ma = (re.search(r'(?:^|[\s(,;])(?:' + DECL_WORDS + r'\s+|[\w.$<>\[\],?]+\s+)?([A-Za-z_$][\w$]*)\s*(?::[^=]+)?(?<![=!<>])=(?!=)\s*(?:await\s+)?\(?\s*$', before)
          or re.search(r'\(\s*([A-Za-z_]\w*)\s*:=\s*(?:await\s+)?$', before))
    mw = re.match(r'\s*(?:\)\s*)?as\s+([A-Za-z_]\w*)', text[res['e0']:]) if g.lang == 'python' else None
    mf = re.search(r'\bfor(?:each)?\s*\(?\s*(?:' + DECL_WORDS + r'\s+|[\w<>?]+\s+)?([A-Za-z_$][\w$]*)\s+(?:of|in|:)\s*(?:await\s+)?$', before)
    local, lt = None, None
    if mf and rt[3]:
        el = T.type_named(rt[3]); local, lt = mf.group(1), ((el[0], el[1], 'derived', '') if el else None)
    elif ma or mw:
        local = (ma or mw).group(1); lt = rt
        if mw:
            ent = T.member(rt[0], '__enter__')
            if ent: lt = T.returns(ent[0]) or rt
    if local and lt and lt[0]:
        cs = g.q("SELECT file, line, end_line FROM symbols WHERE id = ? LIMIT 1", res['caller'])
        lo, hi = (cs[0][1], cs[0][2]) if cs and cs[0][2] else (line, min(len(L), line + 200))
        body = L[lo - 1: hi]
        assign = re.compile(r'(?:^|[^\w$.])' + re.escape(local) + r'\s*(?::[^=()]+)?(?<![=!<>])=(?!=)|\bfor\s*\(?\s*(?:\w+\s+)?' + re.escape(local)
                            + r'\s+(?:in|of)\b|\bas\s+' + re.escape(local) + r'\b|\(\s*' + re.escape(local) + r'\s*:=')
        if sum(1 for t in body if assign.search(t)) > 1:
            return out, f"`{local}` is assigned more than once in {g.display(res['caller'])}: calls on it stay unknown"
        use = re.compile(r'(?<![\w$.])' + re.escape(local) + r'\s*(?:!\s*)?\??\.\s*([A-Za-z_$][\w$]*)')
        for ln in range(line + (0 if mf or mw else 1), hi + 1):
            t = L[ln - 1] if 0 < ln <= len(L) else ''
            for mu in use.finditer(t):
                if ln == line and mu.start() < res['e0']: continue
                chain(ln, t.rfind('.', mu.start(), mu.start(1)), lt, 'derived')
    n = len(out)
    return out, (f"derived {n} edge(s) on its result ({rt[1]}, {rt[2]})" if n else f"returns {rt[1]} ({rt[2]}); no call on its result here")



# ── REJECTIONS: a lead at a site that someone read and found wrong ──────────────────────────────────────────────
# `axiomcode link <site> --not <target>`. Only a GUESS can be rejected: a by-name match at an unresolved site, or one
# member of a target set the engine could not narrow (one of a set, a capped fan). Nothing is deleted: the pair is
# skipped where the walks read their facts (impact's calls / rejected, path's edge / rejected_edge), so removing the
# rejection restores it at once. An edge the engine resolved is never hidden this way.
LEAD_TIERS = ('multi_inferred', 'fan_capped')
REJ_TABLE = ("CREATE TABLE IF NOT EXISTS asserted_rejections(n INT, call_site_id TEXT, caller_id TEXT, callee_id TEXT, file TEXT, line INT, "
             "status TEXT, reason TEXT)")


def resolve_not(g, reader, link, asserted_pairs):
    """-> dict(status, reason, site, caller, callee_id, line) for a rejection"""
    r = dict(status='rejected', reason='', site=None, caller=None, callee_id=None, line=None)
    ts = g.targets(link['target'], link.get('target_file') or '')
    if not ts:
        r.update(status='stale' if link.get('target_file') else 'rejected',
                 reason='the target is not a declaration in this graph (renamed, deleted or moved?)'); return r
    if len(ts) > 1: r['reason'] = f"the target names {len(ts)} declarations: name it as file:line"; return r
    mid, disp, tf, prov, tname, tkind, towner = ts[0]
    r['callee_id'] = mid; r['target_file'] = tf; r['target_display'] = disp
    line, sites, why = locate(g, reader, link)
    if why: r.update(status='stale', reason=why); return r
    r['line'] = line
    if link.get('col') or link.get('ncol') is not None:
        L = reader.lines(link['file']) or []
        text = L[line - 1] if 0 < line <= len(L) else ''
        col = denorm_col(text, link['ncol']) if link.get('ncol') is not None else link['col']
        sites = [x for x in sites if x['col'] == col]
        if not sites: r.update(status='stale', reason=f"stale: no call's name starts at column {col}"); return r
    if not sites: r['reason'] = f"no call is written at {link['file']}:{line}"; return r
    lead, refuse = [], ''
    for x in sites:
        tiers = {t for (t,) in g.q("SELECT tier FROM call_edges WHERE call_site_id = ? AND callee_method_id = ?", x['id'], mid)}
        if (x['id'], mid) in asserted_pairs or tiers == {TIER}:
            refuse = refuse or "that edge is an asserted link, not a guess: remove the link instead (`axiomcode link <file:line[:col]> -`)"
        elif tiers & set(LEAD_TIERS) and not (tiers - set(LEAD_TIERS) - {TIER}):
            lead.append(x)
        elif tiers:
            refuse = refuse or "the engine resolved this call; if it is wrong that is an engine defect — not hidden"
        elif g.unresolved(x['id']) and (x['callee'] or '').split('.')[-1] == tname:
            lead.append(x)
    if not lead:
        r['reason'] = refuse or f"no by-name or one-of-a-set lead at {link['file']}:{line} reaches {disp}"; return r
    if len(lead) > 1:
        r['reason'] = f"{len(lead)} calls on that line lead to {disp}: give the column"; return r
    x = lead[0]
    r.update(status='applied' if line == link['line'] else 'moved', site=x['id'], caller=x['caller'], col=x['col'], callee_written=x['callee'])
    return r


def prefer_on():
    """AXIOMCODE_LINKS_PREFER=1: at a site an asserted link settles, the site's own guesses are not walked either"""
    return os.environ.get('AXIOMCODE_LINKS_PREFER', '').lower() in ('1', 'on', 'true', 'yes')


def suppressed(q, site_file=lambda f: f):
    """-> (pairs {(caller, callee, file, line)}, edges {(caller, callee)}): the leads the walks skip. A pair is a site and
    a target; an edge (path's by-name / set edges carry no site) is skipped only when EVERY site of that caller leading
    to that callee is suppressed."""
    tabs = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    sites = set()                                            # (site id, callee)
    if 'asserted_rejections' in tabs:
        sites |= {(a, b) for a, b in q("SELECT call_site_id, callee_id FROM asserted_rejections WHERE status IN ('applied','moved')")}
    if prefer_on():
        linked = {a for (a,) in q("SELECT DISTINCT call_site_id FROM call_edges WHERE tier = 'asserted'")}
        for sid in linked:
            keep = {b for (b,) in q("SELECT callee_method_id FROM call_edges WHERE call_site_id = ? AND tier = 'asserted'", sid)}
            sites |= {(sid, b) for (b,) in q(f"SELECT callee_method_id FROM call_edges WHERE call_site_id = ? AND tier IN ('multi_inferred','fan_capped')", sid) if b not in keep}
            if 'unresolved_sites' in tabs and q("SELECT 1 FROM unresolved_sites WHERE call_site_id = ?", sid):
                n = q("SELECT callee_name FROM call_sites WHERE id = ?", sid)
                nm = (n[0][0] or '').split('.')[-1] if n else ''
                if nm: sites |= {(sid, b) for (b,) in q("SELECT method_id FROM symbols WHERE name = ? AND method_id IS NOT NULL", nm) if b not in keep}
    if not sites: return set(), set()
    info = {}
    ids = sorted({a for a, _ in sites})
    for i in range(0, len(ids), 500):
        ch = ids[i:i + 500]
        for sid, c, n, f, l in q(f"SELECT id, caller_id, callee_name, file_path, start_line FROM call_sites WHERE id IN ({','.join('?' * len(ch))})", *ch):
            info[sid] = (c, (n or '').split('.')[-1], site_file(f) if f else '', l or 0)
    pairs = {(info[a][0], b, info[a][2], info[a][3]) for a, b in sites if a in info}
    # an edge is gone only when all of its sites are: the caller's other sites of that name / set still lead there
    edges = set()
    by_edge = {}
    for a, b in sites:
        if a in info: by_edge.setdefault((info[a][0], b), set()).add(a)
    for (c, b), ss in by_edge.items():
        multi = {x for (x,) in q("SELECT call_site_id FROM call_edges WHERE caller_id = ? AND callee_method_id = ? AND tier IN ('multi_inferred','fan_capped')", c, b)}
        nm = {info[x][1] for x in ss}
        byname = {x for n_ in nm if n_ for (x,) in (q("SELECT s.id FROM call_sites s JOIN unresolved_sites u ON u.call_site_id = s.id WHERE s.caller_id = ? AND (s.callee_name = ? OR s.callee_name LIKE ?)", c, n_, '%.' + n_) if 'unresolved_sites' in tabs else [])}
        if (multi | byname) <= ss: edges.add((c, b))
    return pairs, edges


DERIVED_TABLE = "CREATE TABLE IF NOT EXISTS asserted_derived(n INT, call_site_id TEXT, callee_id TEXT, label TEXT, how TEXT)"
LINK_TABLE = ("CREATE TABLE IF NOT EXISTS asserted_links(n INT, file TEXT, line INT, at_line INT, target TEXT, target_id TEXT, "
              "call_site_id TEXT, caller_id TEXT, status TEXT, reason TEXT)")


def apply_db(db, repo, reader, links=None, bad=None, sha=None):
    """validate every link against this graph and make its asserted edges exactly the valid ones. Only rows of tier
    `asserted` are ever deleted. -> [(link, result)]"""
    if links is None: links, bad = read_links(repo)
    if sha is None: sha = file_sha(repo)
    con = sqlite3.connect(db, timeout=30)
    try:
        g = Graph(con)
        if 'call_sites' not in g.tables or 'call_edges' not in g.tables: return []
        had = bool(con.execute("SELECT 1 FROM call_edges WHERE tier = ? LIMIT 1", (TIER,)).fetchone()) or 'asserted_links' in g.tables or 'asserted_rejections' in g.tables
        if not links and not bad and not had: return []
        rejs = [l for l in links if l.get('not')]
        links = [l for l in links if not l.get('not')]
        res = [(l, resolve(g, reader, l)) for l in links]
        # what each applied link makes resolvable after it, read before any row is written (the engine's own edges decide)
        derived = {}
        for l, r in res:
            if r['status'] in ('applied', 'moved') and r.get('e0') is not None:
                try: derived[l['n']] = derive(g, reader, dict(r, file=l['file']))
                except Exception as e: derived[l['n']] = ([], f'nothing derived ({type(e).__name__})')
        con.execute("DELETE FROM call_edges WHERE tier = ?", (TIER,))
        con.execute(LINK_TABLE); con.execute("DELETE FROM asserted_links")
        con.execute(DERIVED_TABLE); con.execute("DELETE FROM asserted_derived")
        done = set()
        ins = lambda sid, c, m, lab, prov, k: con.execute(
            "INSERT INTO call_edges(call_site_id, caller_id, callee_method_id, callee_label, callee_provenance, tier, kind) VALUES (?,?,?,?,?,?,?)",
            (sid, c, m, lab, prov, TIER, k or 'call'))
        for l, r in res:
            if r['status'] in ('applied', 'moved') and (r['site'], r['callee_id']) not in done:
                done.add((r['site'], r['callee_id']))
                ins(r['site'], r['caller'], r['callee_id'], r['target_display'], r['prov'], r.get('kind'))
            if l['n'] in derived:
                edges, why = derived[l['n']]
                for sid, c, m, lab, how, k in edges:
                    con.execute("INSERT INTO asserted_derived VALUES (?,?,?,?,?)", (l['n'], sid, m, lab, how))
                    if (sid, m) not in done: done.add((sid, m)); ins(sid, c, m, f"{lab} (derived from link {l['n']})", 'client', k)
                r['reason'] = ('; '.join(x for x in (r['reason'], why) if x))
            con.execute("INSERT INTO asserted_links VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (l['n'], l['file'], l['line'], r['line'], l['target'], r['callee_id'], r['site'], r['caller'], r['status'], r['reason']))
        con.execute(REJ_TABLE); con.execute("DELETE FROM asserted_rejections")
        apairs = {(r['site'], r['callee_id']) for _l, r in res if r['status'] in ('applied', 'moved')}
        for l in rejs:
            r = resolve_not(g, reader, l, apairs)
            res.append((l, r))
            con.execute("INSERT INTO asserted_rejections VALUES (?,?,?,?,?,?,?,?)", (l['n'], r['site'], r['caller'], r['callee_id'], l['file'], r['line'], r['status'], r['reason']))
            con.execute("INSERT INTO asserted_links VALUES (?,?,?,?,?,?,?,?,?,?)",
                        (l['n'], l['file'], l['line'], r['line'], 'not ' + l['target'], r['callee_id'], r['site'], r['caller'], r['status'], r['reason']))
        for n, raw, why in bad or []:
            con.execute("INSERT INTO asserted_links VALUES (?,?,?,?,?,?,?,?,?,?)", (n, '', None, None, raw[:120], None, None, None, 'malformed', why))
        if 'index_meta' in g.tables:
            con.execute("DELETE FROM index_meta WHERE key = 'links_sha'"); con.execute("INSERT INTO index_meta VALUES ('links_sha', ?)", (sha,))
        con.commit()
        return res
    finally:
        con.close()


# ── the derived facts, patched rather than re-exported ────────────────────────────────────────────────────────
def _rewrite(path, keep, add):
    try:
        with open(path, encoding='utf-8') as fh: rows = [l for l in fh.read().split('\n') if l and keep(l.split('\t'))]
    except OSError: return False
    tmp = f"{path}.{os.getpid()}.tmp"
    with open(tmp, 'w', encoding='utf-8') as fh:
        for l in rows: fh.write(l + '\n')
        for r in add: fh.write('\t'.join(str(x) for x in r) + '\n')
    os.replace(tmp, path); return True


def patch_facts(db, old_mtime, rows):
    """the path and impact facts exported for this graph are keyed on its mtime (axiomcode-path / axiomcode-impact
    export()). Writing the asserted rows moved the mtime, which would make the next query re-export every relation
    (minutes on a large graph). The asserted rows reach those facts in exactly three relations — path's edge, impact's
    calls and cert_tier — so those are rewritten (rows of tier `asserted` dropped, the new ones added) and the stamps
    moved to the new mtime. A facts directory stamped for some other graph is left alone: it re-exports as before."""
    try: new = os.stat(db).st_mtime
    except OSError: return
    gdir = os.path.dirname(os.path.dirname(db)) if os.path.basename(os.path.dirname(db)) == 'out' else os.path.dirname(db)
    facts = os.path.join(gdir, 'out', 'dl')
    import ax_edges
    for stamp, files in ((os.path.join(facts, 'stamp'), 'path'), (os.path.join(facts, 'impact', 'stamp'), 'impact')):
        try: cur = open(stamp).read()
        except OSError: continue
        if not cur.startswith(f"{old_mtime}:"): continue
        ok = True
        if files == 'path':
            ok = _rewrite(os.path.join(facts, 'edge.facts'), lambda p: len(p) < 3 or p[2] != TIER,
                          sorted({(c, m, TIER) for c, m, prov, _f, _l in rows if prov in ('client', 'generated')}))
        else:
            D = os.path.join(facts, 'impact')
            ok = _rewrite(os.path.join(D, 'calls.facts'), lambda p: len(p) < 3 or p[2] != TIER,
                          sorted({(c, m, TIER, f, l) for c, m, prov, f, l in rows if prov == 'client'}))
            ok = ok and _rewrite(os.path.join(D, 'cert_tier.facts'), lambda p: p[0] != TIER,
                                 [(TIER, ax_edges.direct_cert(TIER), ax_edges.direct_why(TIER))])
        if ok:
            tmp = f"{stamp}.{os.getpid()}.tmp"; open(tmp, 'w').write(f"{new}:{cur.split(':', 1)[1]}"); os.replace(tmp, stamp)


def asserted_rows(db):
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        g = Graph(con)
        return [(c, m, prov, g.rel(f) if f else '', l or 0) for c, m, prov, f, l in con.execute(
            "SELECT e.caller_id, e.callee_method_id, e.callee_provenance, s.file_path, s.start_line FROM call_edges e "
            "LEFT JOIN call_sites s ON s.id = e.call_site_id WHERE e.tier = ?", (TIER,))]
    finally:
        con.close()


def _has_rejections(db):
    try:
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try: return bool(con.execute("SELECT 1 FROM asserted_rejections LIMIT 1").fetchone())
        finally: con.close()
    except sqlite3.Error: return False


def apply_repo(repo, quiet=True):
    """apply the links file to every graph of the repository, patching each one's facts. -> {graph: results}"""
    links, bad = read_links(repo); sha = file_sha(repo); out = {}
    for db, reader, live in graph_dbs(repo):
        try: old = os.stat(db).st_mtime
        except OSError: continue
        had_rej = _has_rejections(db)
        try: res = apply_db(db, repo, reader, links, bad, sha)
        except sqlite3.Error as e:
            if not quiet: print(f"axiomcode link: {db}: {e}", file=sys.stderr)
            continue
        # a rejection (or the prefer mode) changes the by-name and set facts too: those graphs re-export on the next query
        if (res or links or bad) and not prefer_on() and not had_rej and not any(l.get('not') for l in links): patch_facts(db, old, asserted_rows(db))
        out[db] = (live, res)
    return out


def sync(repo):
    """before a query: re-apply when the links file differs from what the graphs were last given (edited by hand,
    pulled, removed). One read of a small file and one row per graph; nothing at all with no links file and no links."""
    sha = file_sha(repo)
    for db, _r, _live in graph_dbs(repo):
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            try: got = con.execute("SELECT value FROM index_meta WHERE key = 'links_sha'").fetchone()
            except sqlite3.Error: got = None
            con.close()
        except sqlite3.Error: continue
        if (got[0] if got else '') != sha:
            apply_repo(repo); return True
    return False


# ── what a query says about them ──────────────────────────────────────────────────────────────────────────────
def status_rows(q):
    try: return q("SELECT n, file, line, at_line, target, status, reason FROM asserted_links ORDER BY n")
    except sqlite3.Error: return []


def note(q):
    """one line for an answer when some link was not applied, else ''"""
    rows = status_rows(q)
    off = [r for r in rows if r[5] in ('stale', 'rejected', 'malformed')]
    nrej = sum(1 for r in rows if str(r[4]).startswith('not ') and r[5] in ('applied', 'moved'))
    if not off: return ''
    by = {}
    for r in off: by[r[5]] = by.get(r[5], 0) + 1
    return (f"links: {len(off)} of {len(rows)} asserted link(s) not applied ({', '.join(f'{n} {s}' for s, n in sorted(by.items()))})"
            f" — `axiomcode link` lists them")


def rejected_note(q):
    rows = status_rows(q)
    n = sum(1 for r in rows if str(r[4]).startswith('not ') and r[5] in ('applied', 'moved'))
    return f"links: {n} lead(s) rejected by a link are not walked — `axiomcode link` lists them" if n else ''



# ── CANDIDATES: what the graph already knows about where an unknown site may land ───────────────────────────────
# Never from a runtime trace: the engine's own target set at the site, the callables handed into the called value by
# the caller's callers, a computed name's constant prefix, callables registered as values in the same file, and
# declarations of the callee's own name. Ranked in that order, at most `cap`. A candidate is a LEAD: the agent confirms
# it by reading the call, never by its rank.
def candidates(q, sid, caller, callee, kind, file_, line, reason, reader, cap=5):
    out, seen = [], set()
    def add(mid, why):
        if not mid or mid in seen or len(out) >= cap: return
        r = q("SELECT display, file, line FROM symbols WHERE method_id = ? AND kind <> 'module' LIMIT 1", mid)
        if not r: return
        seen.add(mid); out.append(dict(target=r[0][0], at=f"{r[0][1]}:{r[0][2]}", why=why))
    for (m,) in q("SELECT callee_method_id FROM call_edges WHERE call_site_id = ? AND tier IN ('multi_inferred','fan_capped') AND callee_provenance = 'client'", sid):
        add(m, "the engine's own candidate set")
    nm = (callee or '').split('.')[-1]
    L = reader.lines(file_) if reader and file_ else None
    cs = q("SELECT name, file, line, end_line, signature FROM symbols WHERE id = ? LIMIT 1", caller)
    # declarations of the callee's own name (a member call on an untyped receiver)
    if nm:
        for (m,) in q("SELECT method_id FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> 'module' LIMIT 10", nm):
            add(m, "a declaration of the name called")
    # a parameter called: what the callers pass in that position
    if nm and cs and L is not None:
        cname, cf, cl, ce, sig = cs[0]
        params = [re.split(r'[:=\s]', p.strip().lstrip('*&'))[0] for p in re.sub(r'^[^(]*\(|\)[^)]*$', '', sig or '').split(',') if p.strip()]
        if nm in params:
            k = params.index(nm)
            for s_f, s_l, s_sc in q("SELECT s.file_path, s.start_line, s.start_column FROM call_edges e JOIN call_sites s ON s.id = e.call_site_id "
                                    "WHERE e.callee_method_id = (SELECT method_id FROM symbols WHERE id = ?) AND e.tier <> 'asserted' LIMIT 20", caller):
                rel = q("SELECT rel FROM paths WHERE raw = ?", s_f); rel = rel[0][0] if rel else s_f
                LL = reader.lines(rel) or []
                t = LL[s_l - 1] if 0 < (s_l or 0) <= len(LL) else ''
                mm = re.search(re.escape(cname) + r'\s*\((.*)', t)
                if not mm: continue
                args = [a.strip() for a in re.split(r',(?![^()\[\]{}]*[)\]}])', mm.group(1).rsplit(')', 1)[0])]
                a = args[k - (1 if params and params[0] in ('self', 'cls', 'this') else 0)] if k < len(args) + 1 else ''
                a = (a or '').split('=')[-1].strip().split('.')[-1]
                for (m,) in q("SELECT method_id FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind <> 'module'", a):
                    add(m, f"passed in by a caller at {rel}:{s_l}")
    # a name computed from a constant prefix (the engine's reason carries it: computed_attribute_name:on_*)
    pref = ''
    mr = re.search(r'computed_attribute_name:(\w*)\*', reason or '')
    if mr: pref = mr.group(1)
    elif L is not None and cs:
        body = '\n'.join(L[cs[0][2] - 1: cs[0][3] or cs[0][2]])
        mp = re.search(r'["\'`](\w{2,})["\'`]\s*\+|`(\w{2,})\$\{|f["\'](\w{2,})\{', body)
        if mp: pref = next(g_ for g_ in mp.groups() if g_)
    if pref:
        for (m,) in q("SELECT method_id FROM symbols WHERE name LIKE ? ESCAPE '\\' AND method_id IS NOT NULL AND kind <> 'module' ORDER BY file = ? DESC, line LIMIT 20",
                      pref.replace('\\', '').replace('%', '').replace('_', '\\_') + '%', file_):
            add(m, f"named {pref}…, the constant part of the computed name")
    # callables registered as VALUES in the same file (a table, a list, a register(...) call)
    if L is not None:
        vals = set()
        for t in L:
            for v in re.findall(r'[:\[,(=]\s*([A-Za-z_$][\w$]*)\s*(?=[,\]})])', t): vals.add(v)
        for v in sorted(vals):
            for (m,) in q("SELECT method_id FROM symbols WHERE name = ? AND method_id IS NOT NULL AND kind NOT IN ('module', 'class') LIMIT 3", v):
                add(m, "handed over as a value in this file")
    return out


def unknown_sites(q, callers, site_file, limit=30, order=None, repo=None):
    """the unresolved call sites inside these callables: where the answer stops being complete. Each with the call as
    written, the engine's own reason, and the targets it was linked to (if any)."""
    callers = [c for c in dict.fromkeys(callers) if c]
    if not callers: return [], 0
    tabs = {r[0] for r in q("SELECT name FROM sqlite_master WHERE type IN ('table','view')")}
    if 'unresolved_sites' not in tabs: return [], 0
    rows = []; libcall = {}
    for i in range(0, len(callers), 500):
        ch = callers[i:i + 500]; ph = ','.join('?' * len(ch))
        rows += [tuple(r) for r in q(f"SELECT s.id, s.caller_id, s.kind, s.callee_name, s.file_path, s.start_line FROM unresolved_sites u "
                                     f"JOIN call_sites s ON s.id = u.call_site_id WHERE u.caller_id IN ({ph})", *ch)]
        # A CALL RESOLVED INTO A LIBRARY THAT RUNS A VALUE: Method.invoke, a delegate's Invoke, Function.apply. The engine
        # resolved it (to the library method), so it is no unresolved site, and what it runs is as unknown as one's
        for sid, c, k, n, f, l, lib in q(f"SELECT s.id, s.caller_id, s.kind, s.callee_name, s.file_path, s.start_line, e.callee_label FROM call_edges e "
                                          f"JOIN call_sites s ON s.id = e.call_site_id WHERE e.tier = 'boundary_lib' AND e.caller_id IN ({ph})", *ch):
            if (n or '').split('.')[-1] in REFLECTIVE_LIB: rows.append((sid, c, k, n, f, l)); libcall[sid] = lib
        # …and a typed front end's call through a holder of a FUNCTION TYPE: resolved to a signature with no body, so the
        # function the holder is given is what runs (axiomcode-path's value calls, FUNCTION_TYPE_KINDS there)
        for sid, c, k, n, f, l, qn in q(f"SELECT s.id, s.caller_id, s.kind, s.callee_name, s.file_path, s.start_line, m.qualified_name FROM call_edges e "
                                         f"JOIN call_sites s ON s.id = e.call_site_id JOIN methods m ON m.id = e.callee_method_id "
                                         f"WHERE m.kind IN ('FUNCTION_TYPE_SIGNATURE', 'CALL_SIGNATURE', 'TYPE_LITERAL_CALL_SIGNATURE') AND e.caller_id IN ({ph})", *ch):
            rows.append((sid, c, k, n, f, l)); libcall[sid] = 'a function-type signature, not a body'
        # …and a site whose every engine candidate a link rejected: never silently empty, it is to resolve again
        if 'asserted_rejections' in tabs:
            for sid, c, k, n, f, l in q(f"SELECT DISTINCT s.id, s.caller_id, s.kind, s.callee_name, s.file_path, s.start_line FROM asserted_rejections r "
                                        f"JOIN call_sites s ON s.id = r.call_site_id WHERE r.status IN ('applied','moved') AND s.caller_id IN ({ph})", *ch):
                left = q("SELECT 1 FROM call_edges e WHERE e.call_site_id = ? AND e.tier IN ('multi_inferred','fan_capped') AND NOT EXISTS "
                         "(SELECT 1 FROM asserted_rejections r WHERE r.call_site_id = e.call_site_id AND r.callee_id = e.callee_method_id AND r.status IN ('applied','moved')) LIMIT 1", sid)
                if not left: rows.append((sid, c, k, n, f, l))
    rows = list(dict.fromkeys(rows))
    total = len(rows)
    rank = {c: i for i, c in enumerate(order or callers)}
    rows.sort(key=lambda r: (rank.get(r[1], len(rank)), str(r[4]), r[5] or 0))
    reasons, linked = {}, {}
    ids = [r[0] for r in rows[:limit]]
    if ids:
        ph = ','.join('?' * len(ids))
        if 'ext_call_site_unresolved' in tabs:
            for sid, why in q(f"SELECT c0, c2 FROM ext_call_site_unresolved WHERE c0 IN ({ph})", *ids): reasons.setdefault(sid, why)
        for sid, lab in q(f"SELECT call_site_id, callee_label FROM call_edges WHERE tier = 'asserted' AND call_site_id IN ({ph})", *ids):
            linked.setdefault(sid, []).append(lab)
    # the column of each call's name, so a site is written file:line:col and two calls on one line are told apart
    base = 0
    try:
        lg = q("SELECT value FROM run WHERE key = 'language'")
        base = 1 if lg and lg[0][0] in ('typescript', 'javascript') else 0
    except sqlite3.Error: pass
    spans = {r[0]: (r[1], r[2], r[3], r[4]) for r in (q(f"SELECT id, start_line, start_column, end_line, end_column FROM call_sites WHERE id IN ({ph})", *ids) if ids else [])}
    rd = Reader(repo) if repo else None
    def col_of(sid, f, callee):
        sl, sc, el, ec = spans.get(sid, (0, 0, 0, None))
        L = rd.lines(f) if rd and f else None
        text = L[sl - 1] if L and 0 < (sl or 0) <= len(L) else ''
        s0 = max(0, (sc or 0) - base); e0 = ((ec or 0) - base) if el == sl and ec is not None else len(text)
        return name_col(text, callee, s0, e0)
    disp = {}
    out = []
    for sid, caller, kind, callee, f, ln in rows[:limit]:
        if caller not in disp:
            d = q("SELECT display FROM symbols WHERE id = ? LIMIT 1", caller); disp[caller] = d[0][0] if d else caller
        lc = str(libcall.get(sid, ''))
        why = reasons.get(sid) or ((f"calls a value typed by {lc}" if ' ' in lc else f"runs a value through {lc.split(':')[-1]}") if sid in libcall else 'unresolved')
        rf = site_file(f) if f else '?'
        try: cands = candidates(q, sid, caller, callee, kind, rf, ln, reasons.get(sid), rd)
        except Exception: cands = []
        site = f"{rf}:{ln or 0}:{col_of(sid, rf, callee)}"
        out.append(dict(at=f"{rf}:{ln or 0}", site=site, call=callee or '', kind=kind, caller=disp[caller], candidates=cands,
                        command=f"axiomcode link {site} {cands[0]['target'] if cands else '<target>'}",
                        reason=why, linked=sorted(linked.get(sid, []))))
    return out, total


def code_at(repo, at):
    f, _, n = at.rpartition(':')
    try:
        with open(os.path.join(repo, f), encoding='utf-8', errors='replace') as fh: L = fh.read().split('\n')
        return L[int(n) - 1].strip() if 0 < int(n) <= len(L) else ''
    except (OSError, ValueError): return ''


def unknown_lines(repo, sites, total, shown=None):
    """the `unknown:` block of an answer"""
    if not sites: return []
    # a site a link settled is no longer to resolve: counted, not listed
    nlinked = sum(1 for x in sites if x['linked'])
    sites = [x for x in sites if not x['linked']]
    total = max(0, total - nlinked)
    if not sites: return [f"to resolve: nothing — {nlinked} site(s) the answer stopped at are settled by links"] if nlinked else []
    shown = sites[:shown] if shown else sites
    out = [f"to resolve: {total} call site(s) the answer stopped at — what each reaches is not in it"
           + (f" (first {len(shown)})" if total > len(shown) else '') + ':']
    for s in shown:
        code = code_at(repo, s['at'])
        out.append(f"    {s.get('site') or s['at']}  {code[:90]}  [{s['reason']}]" + (f"  → linked: {', '.join(s['linked'])} [asserted]" if s['linked'] else ''))
        if not s['linked']:
            cs_ = s.get('candidates') or []
            out.append("        candidates: " + ('; '.join(f"{c['target']} {c['at']} ({c['why']})" for c in cs_[:3]) + (f" +{len(cs_) - 3}" if len(cs_) > 3 else '')
                                                if cs_ else 'no candidate'))
    out.append("    read the call first; when it makes the target certain: `axiomcode link <file:line:col> <target>` (a candidate is a lead, never link it by its rank)")
    return out


# ── the verb ──────────────────────────────────────────────────────────────────────────────────────────────────
USAGE = """axiomcode link <file:line> <target> [<callee as written>]   record that the call written there reaches <target>
axiomcode link                                             list every link and whether the graph took it
axiomcode link <file:line> -                               remove the links at that site (--remove <file:line> [<target>])

<target> is a declaration as the graph names it (Owner.method, function) or its file:line. Only a call the graph could
not resolve the same way is worth a link, and only when the code makes the target CERTAIN: an asserted edge is walked by
impact, path and tests like any other, labelled [asserted]."""


def find_repo(args):
    for a in reversed(args):
        if os.path.isdir(a) and not re.search(r':\d+$', a): return os.path.realpath(a), [x for x in args if x is not a]
    return os.path.realpath(os.getcwd()), args


def site_arg(repo, s):
    """file:line or file:line:col -> (file, line, col or None)"""
    m = re.fullmatch(r'(.+?):(\d+)(?::(\d+))?', s or '')
    if not m: return None, None, None
    f = m.group(1)
    if os.path.isabs(f): f = os.path.relpath(os.path.realpath(f), repo)
    f = f[2:] if f.startswith('./') else f
    return f.replace(os.sep, '/'), int(m.group(2)), (int(m.group(3)) if m.group(3) else None)


def list_links(repo, as_json=False):
    links, bad = read_links(repo)
    status = {}
    for db, _r, live in graph_dbs(repo):
        if not live: continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            for n, f, l, at, t, st, why in status_rows(lambda s, *a: con.execute(s, a).fetchall()):
                prev = status.get(n)
                # a link lives in one language's graph: the best verdict any graph gave it
                if prev is None or RANK.get(st, 9) < RANK.get(prev[0], 9): status[n] = (st, why, at)
            con.close()
        except sqlite3.Error: pass
    # what the graph holds may predate an edit: the line's text is checked against the file now as well
    rows = []
    for l in links:
        st, why, at = status.get(l['n'], ('not applied', 'the graph has not been given this link yet', None))
        L = Reader(repo).lines(l['file'])
        same = lambda k: bool(k) and 0 < k <= len(L) and line_sha(L[k - 1]) == l.get('line_sha')
        if L is None: st, why = 'stale', 'the file is gone'
        elif st in ('applied', 'moved', 'redundant') and l.get('line_sha') and not same(at or l['line']):
            st, why = 'changed', 'the line was edited since the graph was built; the next refresh re-validates it (followed if it only moved)'
        rows.append(dict(link=l['n'], site=f"{l['file']}:{l['line']}" + (f":{l['col']}" if l.get('col') else ''), now=at, callee=l.get('callee'), target=l['target'],
                         rejects=bool(l.get('not')),
                         target_file=l.get('target_file'), status=st, reason=why, by=l.get('by'), at=l.get('at')))
    for n, raw, why in bad:
        rows.append(dict(link=n, site='', target=raw[:80], status='malformed', reason=why))
    rows.sort(key=lambda r: r['link'])
    web = list_web_links(repo)
    if as_json:
        print(json.dumps(dict(file=links_path(repo), links=rows, **({'web_file': web_links_path(repo), 'web_includes': web} if web else {})), indent=1)); return 0
    for w in web:
        print(f"asserted include: {w['fragment']} → {w['host']}  taken {w['taken']}" + (f" ({w['reason']})" if w['reason'] else ''))
    if not rows:
        if not web: print(f"no asserted links ({links_path(repo)} has none)")
        return 0
    print(f"{len(rows)} asserted link(s) in {os.path.relpath(links_path(repo), repo)}:")
    for r in rows:
        where = r['site'] + (f" (now line {r['now']})" if r.get('now') and r['site'] and int(r['site'].split(':')[1]) != r['now'] else '')
        tgt = f"NOT {r['target']} (a lead rejected: not walked)" if r.get('rejects') else r['target']
        print(f"  {r['link']:>3}. [{r['status']}] {where}  → {tgt}" + (f"  — {r['reason']}" if r['reason'] else ''))
    return 0


def main(argv):
    as_json = '--json' in argv
    argv = [a for a in argv if a != '--json']
    remove = '--remove' in argv
    argv = [a for a in argv if a != '--remove']
    reject = '--not' in argv
    argv = [a for a in argv if a != '--not']
    if '--list' in argv: argv = [a for a in argv if a != '--list']; return list_links(find_repo(argv)[0], as_json)
    if argv and argv[0] in ('-h', '--help', 'help'): print(USAGE); return 0
    repo, args = find_repo(argv)
    if args and not remove and not reject:
        r = web_link(repo, args, as_json)
        if r is not None: return r
    if not os.path.isdir(os.path.join(repo, '.axiomcode')):
        print(f"axiomcode link: no graph for {repo} — ask a question first (impact, path) so it is built", file=sys.stderr); return 2
    if not args: return list_links(repo, as_json)
    f, line, col = site_arg(repo, args[0])
    if f is None:
        print(f"axiomcode link: the site is written file:line (as an answer's `unknown:` block prints it), not {args[0]!r}\n\n{USAGE}", file=sys.stderr); return 2
    links, bad = read_links(repo)
    if remove or (len(args) > 1 and args[1] == '-'):
        tgt = args[1] if len(args) > 1 and args[1] != '-' else None
        keep = [l for l in links if not (l['file'] == f and l['line'] == line and (tgt is None or l['target'] == tgt)
                                          and (col is None or l.get('col') in (None, col)))]
        gone = len(links) - len(keep)
        write_links(repo, keep + [])   # malformed lines are dropped only by hand; they stay listed until fixed
        _restore_bad(repo, bad)
        apply_repo(repo)
        print(f"removed {gone} link(s) at {f}:{line}" if gone else f"no link at {f}:{line}")
        return 0 if gone else 1
    if len(args) < 2:
        print(USAGE, file=sys.stderr); return 2
    target = args[1]; callee = args[2] if len(args) > 2 else ''
    if target.startswith('not:'): reject, target = True, target[4:]
    reader = Reader(repo); L = reader.lines(f)
    if L is None or not (0 < line <= len(L)):
        print(f"axiomcode link: rejected — {f}:{line} is not a line of a file in this repository", file=sys.stderr); return 1
    new = dict(file=f, line=line, line_sha=line_sha(L[line - 1]), callee=callee, caller='', target=target, target_file='',
               col=col, ncol=norm_col(L[line - 1], col) if col else None,
               by=os.environ.get('AXIOMCODE_LINK_BY') or os.environ.get('USER') or 'agent', at=time.strftime('%Y-%m-%dT%H:%M:%S'), n=0)
    # validate against the live graphs first: a link no graph would take is refused, not written
    verdicts = []
    for db, rd, live in graph_dbs(repo):
        if not live: continue
        con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
        try:
            g = Graph(con)
            if reject:
                ap = {(a, b) for a, b in g.q("SELECT call_site_id, callee_method_id FROM call_edges WHERE tier = ?", TIER)}
                verdicts.append((resolve_not(g, rd, new, ap), g))
            else: verdicts.append((resolve(g, rd, new), g))
        except sqlite3.Error: pass
    good = [(r, g) for r, g in verdicts if r['status'] in ('applied', 'redundant')]
    if not good:
        why = sorted(verdicts, key=lambda x: (x[0]['reason'].startswith('no call is written'), x[0]['reason'].startswith('the target is not')))
        print(f"axiomcode link: rejected — {why[0][0]['reason'] if why else 'no graph to check it against'}", file=sys.stderr); return 1
    r, g = good[0]
    new.update(callee=r.get('callee_written') or callee, caller=g.display(r['caller']) if r.get('caller') else '',
               target=r['target_display'], target_file=r.get('target_file') or '', **({'not': True} if reject else {}))
    new['target'], new['target_file'] = stable_name(g, r['callee_id'], r['target_display'], new['target_file'])
    g.con.close()
    # the column the link resolved to is recorded even when none was given: it is what the link names from now on
    if r.get('col') and not new.get('col'): new['col'] = r['col']; new['ncol'] = norm_col(L[line - 1], r['col'])
    dup = [l for l in links if l['file'] == f and l['line'] == line and l['target'] == new['target'] and l.get('col') == new.get('col')
           and bool(l.get('not')) == bool(new.get('not'))]
    links = [l for l in links if l not in dup] + [new]
    t0 = time.time()
    write_links(repo, links); _restore_bad(repo, bad)
    res = apply_repo(repo)
    ms = (time.time() - t0) * 1000
    note_ = next((x['reason'] for live, rs in res.values() if live for l_, x in rs
                  if l_['file'] == f and l_['line'] == line and l_['target'] == new['target'] and l_.get('col') == new.get('col') and x['status'] in ('applied', 'moved')), '')
    where = f"{f}:{line}" + (f":{new['col']}" if new.get('col') else '')
    if reject:
        print(f"rejected the lead {where} → {new['target']}: no walk takes it from now on (the engine's row is kept; "
              f"`axiomcode link {where} -` restores it)  — applied to {sum(1 for v in res.values() if v[0])} graph(s) in {ms:.0f} ms")
        return 0
    print(f"linked {where} `{new['callee']}` → {new['target']} [asserted]" + (" (the graph already had this edge; recorded, nothing added)" if r['status'] == 'redundant' else '')
          + (f"; {note_}" if note_ else '') + f"  — applied to {sum(1 for v in res.values() if v[0])} graph(s) in {ms:.0f} ms")
    return 0


# ── web: asserted includes (SPEC §11.2) ─────────────────────────────────────────────────────────────────────────
# `link <fragment>:1 <host>:<line>` says that a page fragment is included by a host page at that line, where the web
# graph found no include reference or could not resolve one. It is kept in axiomcode-web-links.tsv at the repository
# root (fragment, host, line, by, at), which the web graph reads when it is built: the fragment is then matched inside
# the host, under the host's sheets, and every row that comes of it is labelled [asserted]. `link <fragment>:1 -`
# removes the fragment's links; `link` alone lists them with whether the graph took each one.
WEB_FILE = 'axiomcode-web-links.tsv'
WEB_HEADER = '# axiomcode web links: page fragments asserted to be included by a host page. Written by `axiomcode link`; one per line, tab-separated: fragment host line by at'
WEB_PAGE = re.compile(r'\.(?:html?|shtml?|xhtml)$', re.I)


def web_links_path(repo):
    return os.environ.get('AXIOMCODE_WEB_LINKS') or os.path.join(repo, WEB_FILE)


def read_web_links(repo):
    try:
        with open(web_links_path(repo), encoding='utf-8', errors='replace') as fh: rows = fh.read().split('\n')
    except OSError: return []
    out = []
    for raw in rows:
        if not raw.strip() or raw.lstrip().startswith('#'): continue
        p = (raw.split('\t') + [''] * 5)[:5]
        out.append(dict(fragment=p[0], host=p[1], line=p[2], by=p[3], at=p[4]))
    return out


def write_web_links(repo, links):
    p = web_links_path(repo); tmp = f"{p}.{os.getpid()}.tmp"
    with open(tmp, 'w', encoding='utf-8') as fh:
        fh.write(WEB_HEADER + '\n')
        for l in links: fh.write('\t'.join(str(l.get(k) or '') for k in ('fragment', 'host', 'line', 'by', 'at')) + '\n')
    os.replace(tmp, p)


def web_graph(repo):
    for db, _r, live in graph_dbs(repo):
        if not live: continue
        try:
            con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
            lang = con.execute("SELECT value FROM run WHERE key = 'language'").fetchone()
            has = con.execute("SELECT 1 FROM sqlite_master WHERE name = 'web_includes'").fetchone()
            con.close()
            if lang and lang[0] == 'web' and has: return db
        except sqlite3.Error: pass
    return None


def web_verdicts(repo):
    """{(fragment, host, line): (taken, reason)} from the web graph's asserted include rows"""
    db = web_graph(repo); out = {}
    if not db: return out
    con = sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    try:
        for frag, host, line, status, reason in con.execute(
                "SELECT i.url_as_written, coalesce(h.file, i.file), i.line, i.status, i.reason FROM web_includes i LEFT JOIN web_pages h ON h.uid = i.host_page_uid WHERE i.kind = 'asserted'"):
            out[(frag, host, str(line))] = (status == 'asserted', reason)
    finally: con.close()
    return out


def web_rebuild(repo):
    """the web graph rebuilt now with the links file as it stands (the build reads it); False when the build failed"""
    import ax_fresh
    t = ax_fresh.load_table(repo) or ax_fresh.legacy_params(repo) or {}
    env = ax_fresh.rebuild_env(t, AXIOMCODE_REFRESH_REASON='an asserted web include')
    r = subprocess.run([os.environ.get('AXIOMCODE_BASH') or 'bash', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'axiomcode-build'), repo],
                       env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    return r.returncode == 0


def web_link(repo, args, as_json=False):
    """`link <fragment>:1 <host>:<line>` / `link <fragment>:1 -`; None when the arguments are not a web include"""
    f, _l, _c = site_arg(repo, args[0]) if args else (None, None, None)
    if not f or not WEB_PAGE.search(f) or len(args) < 2: return None
    links = read_web_links(repo)
    if args[1] == '-':
        keep = [l for l in links if l['fragment'] != f]
        if len(keep) == len(links): return None                 # not a web link: the call-link removal handles it
        write_web_links(repo, keep)
        ok = web_rebuild(repo)
        print(f"removed {len(links) - len(keep)} asserted include(s) of {f}" + ('' if ok else ' (the web graph rebuild failed; see .axiomcode/build.log)'))
        return 0
    h, hl, _hc = site_arg(repo, args[1])
    if not h or not WEB_PAGE.search(h) or not hl: return None
    if not web_graph(repo):
        print("axiomcode link: no web graph here to take an asserted include (index with --lang web first)", file=sys.stderr); return 2
    for x in (f, h):
        if not os.path.isfile(os.path.join(repo, x)):
            print(f"axiomcode link: rejected — {x} is not a file in this repository", file=sys.stderr); return 1
    new = dict(fragment=f, host=h, line=hl, by=os.environ.get('AXIOMCODE_LINK_BY') or os.environ.get('USER') or 'agent', at=time.strftime('%Y-%m-%dT%H:%M:%S'))
    links = [l for l in links if not (l['fragment'] == f and l['host'] == h)] + [new]
    write_web_links(repo, links)
    t0 = time.time(); ok = web_rebuild(repo)
    taken, why = web_verdicts(repo).get((f, h, str(hl)), (False, 'the web graph did not read the link (rebuild failed?)' if not ok else 'not read'))
    if as_json:
        print(json.dumps(dict(fragment=f, host=h, line=hl, taken=taken, reason=why))); return 0 if taken else 1
    if taken:
        print(f"linked {f} → included by {h}:{hl} [asserted]: its elements are now matched in {h} under its sheets  — web graph rebuilt in {time.time() - t0:.0f} s")
        return 0
    print(f"axiomcode link: recorded but not taken — {why}", file=sys.stderr)
    return 1


def list_web_links(repo):
    links = read_web_links(repo)
    if not links: return []
    v = web_verdicts(repo)
    rows = []
    for l in links:
        taken, why = v.get((l['fragment'], l['host'], str(l['line'])), (False, 'the web graph has not read it yet (next refresh)'))
        rows.append(dict(fragment=l['fragment'], host=f"{l['host']}:{l['line']}", taken='yes' if taken else 'no', reason=why, by=l['by'], at=l['at']))
    return rows


def _restore_bad(repo, bad):
    """a hand-written line write_links could not parse is kept as written, so a link is never lost to a typo"""
    if not bad: return
    with open(links_path(repo), 'a', encoding='utf-8') as fh:
        for _n, raw, _w in bad: fh.write(raw + '\n')


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
