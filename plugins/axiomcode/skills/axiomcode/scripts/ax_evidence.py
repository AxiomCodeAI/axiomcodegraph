#!/usr/bin/env python3
"""Evidence for the rows an answer is not sure of. One module, used by every verb and every surface.

A row that is not an exact edge -- [by name], [one of a set], [registered], [text], a dispatch or key join -- is a
lead: the graph matched a NAME, or a set, and could not say which declaration the call reaches. Printed alone, the
reader has to open the file to decide it, and measured over the loops' traces about half of the answers that named
files were followed within three tool calls by a Read or a grep of one of them (55% when the answer had [by name]
rows). What decides such a row is almost always ONE line: where the call's receiver (or its dispatch key) gets its
value -- a parameter's annotation, a field declared or assigned in the constructor, a local, an import, the constant
a registration names. So each non-exact row carries two lines:

    call     the line the call is written on (file:line and its trimmed text)
    decider  the line that decides what the receiver is, and its kind (param, field, local, assigned, import, key …)

and `only_through`: how many callables and tests the answer reaches ONLY through that row, with the way to ask again
without it (`--drop <file:line>`, or `--exact` for exact edges alone). Evidence is given for the five strongest
non-exact rows; the rest are counted. Exact rows get none, so an answer with no uncertain row does not grow.

The switch: AXIOMCODE_EVIDENCE=on|off (the dispatcher sets it from --evidence / --no-evidence; the MCP server from its
`evidence` parameter; the hooks inherit it). OFF by default: with it off nothing here runs and every answer is the
answer it was. AXIOMCODE_DROP (comma-separated file:line or row ids), AXIOMCODE_EXACT=1 and AXIOMCODE_ALONGSIDE=1 are
the ask-again and list-alongside switches, set from --drop, --exact and --alongside.

The decider is read from the source text, not from the graph: the graph has already said it could not type the
receiver, so what it knows is exactly what is missing. It is a heuristic over the file's own lines, per language, and
it says what KIND of line it found; when it finds none the row carries only its call line.
"""
import collections, os, re

TOP = 5                  # rows that get evidence; the rest are counted
TEXT = 150               # a line's text in --json, trimmed (a line is bounded at 160 characters)
PRINTED = 90             # and as printed under a row
UP = 250                 # lines searched above a call for its receiver's parameter or local

# a certainty that is an exact edge (or not a row about a call at all): no evidence
EXACT = {None, '', 'resolved', 'sound', 'entry', 'defines', 'defines (not a call)', 'must change', 'alongside',
         'stubs it', 'at import', 'at load', 'decorator', 'test'}


def _env(k):
    return (os.environ.get(k) or '').strip().lower()


def on():
    return _env('AXIOMCODE_EVIDENCE') in ('on', '1', 'true', 'yes')


def drops():
    return {x.strip() for x in (os.environ.get('AXIOMCODE_DROP') or '').split(',') if x.strip()}


def exact_only():
    return _env('AXIOMCODE_EXACT') in ('1', 'on', 'true', 'yes')


def list_alongside():
    return _env('AXIOMCODE_ALONGSIDE') in ('1', 'on', 'true', 'yes')


def is_exact(cert):
    return cert in EXACT


def lang_of(f):
    e = os.path.splitext(f or '')[1].lower()
    if e in ('.py', '.pyi'): return 'python'
    if e == '.java': return 'java'
    if e == '.cs': return 'csharp'
    if e in ('.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'): return 'ts'
    return 'python' if not e else 'ts'


def trim(s):
    s = (s or '').strip()
    return s if len(s) <= TEXT else s[:TEXT - 1] + '…'


class Source:
    """the lines of the repository's files, read once each"""
    def __init__(self, repo):
        self.repo, self.files = repo or '.', {}

    def lines(self, f):
        if f not in self.files:
            try:
                with open(os.path.join(self.repo, f), encoding='utf-8', errors='replace') as h: self.files[f] = h.read().split('\n')
            except OSError: self.files[f] = None
        return self.files[f]


def split_at(at):
    f, _, n = (at or '').rpartition(':')
    return (f, int(n)) if f and n.isdigit() else (None, None)


def simple(name):
    """the name a call writes: `Owner.get (at x.ts:3)` → get, `Owner.m(int)` → m"""
    n = (name or '').split(' (at ')[0].split('(')[0].strip()
    n = re.split(r'[.#:$/]', n)[-1] if n else ''
    return '' if n.startswith('<') else n


# ── the receiver of a call ─────────────────────────────────────────────────────────────────────────────────────────────
ID = r'[A-Za-z_$][\w$]*'
RECV = re.compile(r'((?:' + ID + r'(?:\(\s*\))?\s*(?:\?\.|!\.|\.|->)\s*)*' + ID + r'(?:\((?:[^()]|\([^()]*\))*\))?)\s*(?:\?\.|!\.|\.|->)\s*$')


def receiver(text, name):
    """the receiver expression written before `.name(` on a line, or None for a bare call / no call of the name"""
    for m in re.finditer(r'(?:\?\.|!\.|\.|->)\s*' + re.escape(name) + r'\s*(?:<[^()]*>)?\s*[(`]', text):
        r = RECV.search(text[:m.start()] + '.')
        if r: return re.sub(r'\s+', '', r.group(1))
    return None


def parts(recv):
    """`this.a.b()` → ('this', ['a', 'b()']); a separator inside parentheses does not split"""
    ps, cur, depth, s, i = [], '', 0, recv or '', 0
    while i < len(s):
        c = s[i]
        if c == '(': depth += 1
        elif c == ')': depth -= 1
        if depth == 0 and (s.startswith('->', i) or c == '.' or (c in '?!' and s.startswith('.', i + 1))):
            ps.append(cur); cur = ''
            i += 2 if (s.startswith('->', i) or c in '?!') else 1
            continue
        cur += c; i += 1
    ps.append(cur)
    return ps[0], ps[1:]


TS_MOD = r'(?:(?:private|public|protected|readonly|static|declare|override|abstract|export|async)\s+)*'
JV_MOD = r'(?:(?:private|public|protected|internal|static|final|readonly|volatile|transient|const|required|new|override|virtual|sealed|unsafe)\s+)*'
JV_KW = {'return', 'new', 'throw', 'await', 'yield', 'else', 'case', 'in', 'is', 'as', 'out', 'ref', 'using', 'import', 'package', 'var', 'val'}


def _type_in(lang, line, x, annotated_only=False):
    """the type a declaration line gives x, if it writes one (a parameter's only from its annotation)"""
    if lang in ('ts', 'python'):
        m = re.search(r'\b' + re.escape(x) + r'\s*[?!]?\s*:\s*([A-Za-z_$][\w$.]*)', line)
        if m and m.group(1) not in ('function',): return m.group(1)
    else:
        m = re.search(r'([A-Za-z_][\w.]*)(?:<[^;=()]*>)?(?:\[\])*\??\s+' + re.escape(x) + r'\b', line)
        if m and m.group(1) not in JV_KW: return m.group(1)
    if annotated_only: return None
    m = re.search(r'=\s*(?:new\s+)?([A-Za-z_$][\w$.]*)\s*(?:<[^()]*>)?\s*\(', line)
    if m and m.group(1) not in ('async', 'function', 'await', 'lambda') and (lang != 'python' or m.group(1)[:1].isupper() or '.' in m.group(1)):
        return ('new ' if 'new ' + m.group(1) in line else '') + m.group(1) + '(…)'
    return None


CLASS = re.compile(r'^(\s*)(?:(?:export|default|abstract|public|private|protected|internal|static|final|sealed|partial|data|open|declare)\s+)*'
                   r'(?:class|interface|struct|record|object)\s+' + ID)


def _indent(s):
    return len(s) - len(s.lstrip())


def _class_span(L, n):
    """[lo, hi) the lines of the class that encloses line n, else the whole file: a field is the enclosing class's own,
    and the same name declared by another class in the file decides nothing"""
    ind = _indent(L[n - 1])
    for i in range(n - 1, -1, -1):
        m = CLASS.match(L[i])
        if m and len(m.group(1)) < ind:
            ci = len(m.group(1))
            for j in range(i + 1, len(L)):
                t = L[j].strip()
                if t and _indent(L[j]) <= ci and not re.match(r'[{})\]]|//|#|/?\*|@|where\b|:', t): return i, j
            return i, len(L)
    return 0, len(L)


def _field(lang, L, x, n):
    """where a field x of the class enclosing line n gets its value: its declaration, a constructor parameter property,
    or an assignment"""
    ex = re.escape(x)
    if lang == 'ts':
        pats = [(re.compile(r'(?:private|public|protected|readonly)\s+(?:readonly\s+)?' + ex + r'\s*[?!]?\s*:'), 'constructor parameter'),
                (re.compile(r'^\s*' + TS_MOD + r'#?' + ex + r'\s*[?!]?\s*[:=](?!=)'), 'field'),
                (re.compile(r'\bthis\.' + ex + r'\s*=(?!=)'), 'assigned')]
    elif lang == 'python':
        pats = [(re.compile(r'^\s+' + ex + r'\s*:\s*[A-Za-z_]'), 'field'),
                (re.compile(r'\bself\.' + ex + r'\s*(?::[^=]+)?=(?!=)'), 'assigned'),
                (re.compile(r'^\s+' + ex + r'\s*=(?!=)'), 'class attribute')]
    else:
        pats = [(re.compile(r'^\s*(?:\[[^\]]*\]\s*|@\w+(?:\([^)]*\))?\s+)*' + JV_MOD + r'[A-Za-z_][\w.<>\[\]?, ]*\s+' + ex + r'\s*(?:=(?!=)|;|\{|=>)'), 'field'),
                (re.compile(r'\bthis\.' + ex + r'\s*=(?!=)'), 'assigned')]
    lo, hi = _class_span(L, n)
    for rx, kind in pats:
        for i in range(lo, hi):
            line = L[i]
            if rx.search(line) and not re.match(r'\s*(//|#|\*|/\*)', line):
                if kind == 'assigned':
                    # `self.gw = gw` / `this.loader = loader` decides nothing on its own: the constructor parameter it
                    # copies may say the type
                    rhs = re.search(r'=\s*(' + ID + r')\s*;?\s*$', line.split('#')[0].split('//')[0])
                    if rhs:
                        p = _param(lang, L, rhs.group(1), i + 1)
                        if p and p[2]: return (p[0], 'constructor parameter', p[2])
                return (i + 1, kind, _type_in(lang, line, x))
    return None


JV_NOT = r'(?!(?:return|new|throw|else|case|await|yield|if|for|while|switch|catch|using|lock|do|try|var)\b)'
NAMED = {
    'python': re.compile(r'^\s*(?:async\s+)?def\s+\w+\s*\('),
    'ts': re.compile(r'\bfunction\b\s*\*?\s*[\w$]*\s*(?:<[^>]*>)?\s*\(|\bconstructor\s*\(|^\s*' + TS_MOD + r'(?:get\s+|set\s+)?' + ID
                     + r'\s*(?:<[^>]*>)?\s*\((?:.*\)\s*(?::\s*[^;{=]+)?\{\s*$|\s*$)'),
    'java': re.compile(r'^\s*' + JV_NOT + r'(?:(?:\[[^\]]*\]|@\w+(?:\([^)]*\))?)\s*)*' + JV_MOD + r'(?:[\w<>\[\],.?]+\s+)?' + ID + r'\s*\([^;]*$'),
}
ANON = re.compile(r'\(([^()]*)\)\s*(?::\s*[^=]+?)?\s*(?:=>|->)|\b(' + ID + r')\s*(?:=>|->)|\blambda\b([^:]*):')


def _signatures(lang, L, n):
    """the signatures enclosing line n, innermost first, up to and including the nearest named one: (line index, the
    signature's text over up to 8 lines, named?)"""
    named = NAMED['java' if lang in ('java', 'csharp') else lang]
    for i in range(n - 1, max(-1, n - 1 - UP), -1):
        line = L[i]
        if named.search(line):
            text = ' '.join(L[i:i + 8])
            text = text[:text.find('{')] if '{' in text else text
            yield i, text, True
            return
        a = ANON.search(line)
        if a: yield i, a.group(0), False


def _param(lang, L, x, n, up=UP):
    """the parameter x of a callable enclosing line n: of the nearest named signature, or of a closure inside it"""
    ex = re.escape(x)
    if lang in ('ts', 'python'):
        rx = re.compile(r'(?:^|[(,]|\blambda\b)\s*(?:@[\w.]+(?:\([^)]*\))?\s*)*(?:(?:private|public|protected|readonly)\s+)*(?:\*{1,2})?' + ex + r'\s*[?]?\s*(?::|=[^=>]|,|\)|=>)')
    else:
        rx = re.compile(r'(?:[(,]|^)\s*(?:(?:final|this|params|ref|out|in)\s+|@\w+(?:\([^)]*\))?\s+)*[A-Za-z_][\w.<>\[\]?, ]*\s+' + ex + r'\s*(?:[,)=]|$)'
                        r'|\(\s*' + ex + r'\s*\)\s*(?:->|=>)|\b' + ex + r'\s*(?:->|=>)')
    for i, text, named in _signatures(lang, L, n):
        if rx.search(text) or (not named and re.search(r'\b' + ex + r'\b', text)):
            # the line of the signature that writes it (a parameter list over several lines)
            k = next((j for j in range(i, min(len(L), i + 8)) if re.search(r'\b' + ex + r'\b', L[j])), i)
            return (k + 1, 'param', _type_in(lang, L[k], x, annotated_only=True))
    return None


def _local(lang, L, x, n, up=UP):
    ex = re.escape(x)
    if lang == 'ts':
        rx = [re.compile(r'\b(?:const|let|var)\s+' + ex + r'\b'), re.compile(r'\b(?:const|let|var)\s*[{\[][^=]*\b' + ex + r'\b'),
              re.compile(r'\bfor\s*\(\s*(?:const|let|var)\s+' + ex + r'\b')]
    elif lang == 'python':
        rx = [re.compile(r'^\s*' + ex + r'\s*(?::[^=]+)?=(?!=)'), re.compile(r'\bfor\s+(?:[\w, ]*\b)?' + ex + r'\b[\w, ]*\s+in\b'),
              re.compile(r'\bas\s+' + ex + r'\s*[:,)]'), re.compile(r'^\s*(?:[\w.]+\s*,\s*)*' + ex + r'\s*(?:,\s*[\w.]+\s*)*=(?!=)')]
    else:
        rx = [re.compile(r'(?:^|[;({])\s*(?:final\s+)?[A-Za-z_][\w.<>\[\]?, ]*\s+' + ex + r'\s*=(?!=)'),
              re.compile(r'\b(?:var|val)\s+' + ex + r'\b'), re.compile(r'\bforeach\s*\([^)]*\s' + ex + r'\s+in\b'),
              re.compile(r'\bfor\s*\([^:;]*\s' + ex + r'\s*:')]
    # within the enclosing callable (a module-level `let` above a test's callbacks is the test file's own local)
    top = [i for i, _t, named in _signatures(lang, L, n) if named]
    stop = top[0] if top and lang != 'ts' else max(-1, n - 1 - up)
    for i in range(n - 1, stop - 1 if stop >= 0 else -1, -1):
        if any(r.search(L[i]) for r in rx) and not re.match(r'\s*(//|#|\*)', L[i]):
            # a member declared with a modifier is the class's field, not a local (a one-line method has no signature
            # line above the call to stop the search at)
            if lang in ('java', 'csharp') and re.match(r'\s*(?:private|public|protected|internal|static|readonly|const)\b', L[i]): return None
            return (i + 1, 'local', _type_in(lang, L[i], x))
    return None


def _module(lang, L, x):
    """x declared at the top of the file, or imported into it"""
    ex = re.escape(x)
    for i, line in enumerate(L):
        if re.search(r'^\s*(?:import\s+(?:type\s+)?(?:\{[^}]*\b' + ex + r'\b[^}]*\}|' + ex + r'\b|\*\s+as\s+' + ex + r'\b|[\w$]+\s*,\s*\{[^}]*\b' + ex + r'\b)'
                     r'|import\s+(?:static\s+)?[\w.]+\.' + ex + r'\s*;|import\s+(?:[\w.]+\s+as\s+)?' + ex + r'\s*$|from\s+\S+\s+import\b[^#]*\b' + ex + r'\b'
                     r'|using\s+' + ex + r'\s*=|(?:const|let|var)\s+(?:\{[^}]*\b' + ex + r'\b[^}]*\}|' + ex + r')\s*=\s*require\b)', line):
            return (i + 1, 'import', None)
    for i, line in enumerate(L):
        if re.search(r'^(?:export\s+)?(?:default\s+)?(?:(?:const|let|var)\s+' + ex + r'\b|(?:async\s+)?function\s*\*?\s*' + ex + r'\b|class\s+' + ex + r'\b|' + ex + r'\s*(?::[^=]+)?=(?!=)|def\s+' + ex + r'\b)', line):
            return (i + 1, 'module', _type_in(lang, line, x))
    return None


def _root_decl(lang, L, x, n):
    """where the name x, as written at line n, gets its value: a local or parameter above it, else a field, else the module"""
    if x in ('this', 'self', 'cls', 'super', 'base'): return None
    return _local(lang, L, x, n) or _param(lang, L, x, n) or _field(lang, L, x, n) or _module(lang, L, x)


KEY_ARG = re.compile(r'\b(?:\w+\.)*\w+\s*\(\s*(?:f?["\']([^"\']+)["\']|([A-Za-z_$][\w$.]*))\s*,')


def decide(src, at, name, lang=None):
    """the deciding line of a non-exact call at `at` to a method called `name`: (line, text, kind) or None"""
    f, n = split_at(at)
    L = src.lines(f) if f else None
    if not L or not 0 < n <= len(L): return None
    lang = lang or lang_of(f)
    # a call written over several lines: the name is on the line of the site or just below it
    rows = [(k, L[k - 1]) for k in range(n, min(len(L), n + 3) + 1)]
    for k, text in rows:
        rv = receiver(text, name) if name else None
        if not rv: continue
        root, rest = parts(rv)
        d = None
        if root in ('this', 'self', 'base') and rest:
            fld = re.sub(r'\(.*$', '', rest[0])
            d = _field(lang, L, fld, k)
            if d: kind = d[1] if len(rest) == 1 else d[1] + ' ' + fld
        elif root.endswith(')'):
            fn = root.split('(')[0]
            d = _root_decl(lang, L, fn, k)
            if d: kind = 'returned by ' + fn + '()'
        else:
            d = _root_decl(lang, L, root, k)
            if d: kind = d[1] if not rest else d[1] + ' ' + root
        if d:
            return (d[0], L[d[0] - 1], kind + (f" · type {d[2]}" if d[2] else ''))
        return None
    # no `.name(` on the line: a dispatch key or a registration decides which declaration runs
    text = ' '.join(t for _k, t in rows[:2])
    g = re.search(r'getattr\s*\([^,]+,\s*f?["\']([^"\']*)["\']|getattr\s*\([^,]+,\s*(' + ID + r')', text)
    if g:
        ids = re.findall(r'\{(' + ID + r')', g.group(1) or '') or ([g.group(2)] if g.group(2) else [])
        for x in ids:
            d = _root_decl(lang, L, x, n)
            if d: return (d[0], L[d[0] - 1], 'dispatch key ' + x)
        return None
    s = re.search(r'\[\s*(' + ID + r')\s*\]\s*\(', text)
    if s:
        d = _root_decl(lang, L, s.group(1), n)
        if d: return (d[0], L[d[0] - 1], 'dispatch key ' + s.group(1))
        return None
    if name and re.search(r'\b' + re.escape(name) + r'\b(?!\s*\()', text):
        k = KEY_ARG.search(text)
        if k and k.group(2):
            x = k.group(2).split('.')[-1] if k.group(2).split('.')[0] in ('this', 'self') else k.group(2).split('.')[0]
            d = _root_decl(lang, L, x, n) if k.group(2).split('.')[0] not in ('this', 'self') else _field(lang, L, x, n)
            if d and d[1] == 'import':
                far = _imported(src, f, L[d[0] - 1], x, lang)
                if far: return far + ('registration key ' + k.group(2),)
            if d: return (d[0], L[d[0] - 1], 'registration key ' + k.group(2))
    return None


def _imported(src, f, line, x, lang):
    """(file:line, text) where a name imported from a module of this repository is defined, or None"""
    m = re.search(r'from\s+[\'"](\.[^\'"]+)[\'"]', line) or re.search(r'require\(\s*[\'"](\.[^\'"]+)[\'"]', line)
    cands = []
    if m:
        base = os.path.normpath(os.path.join(os.path.dirname(f), m.group(1)))
        cands = [base + e for e in ('', '.ts', '.tsx', '.js', '.mjs', '.jsx', '/index.ts', '/index.js')]
    else:
        m = re.search(r'^\s*from\s+(\.*)([\w.]*)\s+import\b', line)
        if m:
            up = os.path.dirname(f)
            for _ in range(max(0, len(m.group(1)) - 1)): up = os.path.dirname(up)
            rel = m.group(2).replace('.', '/')
            cands = [os.path.join(up, rel + '.py'), os.path.join(up, rel, '__init__.py'), rel + '.py']
    for c in cands:
        c = c.replace(os.sep, '/')
        L2 = src.lines(c) if c.rsplit('.', 1)[-1] in ('ts', 'tsx', 'js', 'mjs', 'jsx', 'py') else None
        if not L2: continue
        d = _module(lang, L2, x)
        if d and d[1] == 'module': return (f'{c}:{d[0]}', L2[d[0] - 1])
    return None


def evidence(src, at, name):
    """{call: {at, text}, decider: {at, text, kind}} for one site; decider absent when no line decides it"""
    f, n = split_at(at)
    L = src.lines(f) if f else None
    if not L or not 0 < n <= len(L): return None
    k = n
    if name:
        # the site's own line when it writes the name, or is a call that does not (a dispatch through a key); else the
        # site is where the callable starts (a decorator, a doc comment above it) and the call is the first line below
        # that writes `.name(`, else the first that writes the name at all
        own, t = re.search(r'\b' + re.escape(name) + r'\b', L[n - 1]), L[n - 1].strip()
        if not own and not ('(' in t and not re.match(r'[@*/#]', t)):
            near = range(n, min(len(L), n + 8) + 1)
            k = next((j for j in near if re.search(r'\.\s*' + re.escape(name) + r'\s*(?:<[^()]*>)?\s*[(`]', L[j - 1])), None) \
                or next((j for j in range(n, min(len(L), n + 3) + 1) if re.search(r'\b' + re.escape(name) + r'\b', L[j - 1])), n)
    ev = {'call': {'at': f'{f}:{k}', 'text': trim(L[k - 1])}}
    try: d = decide(src, f'{f}:{k}', name)
    except re.error: d = None
    if d:
        ev['decider'] = {'at': d[0] if isinstance(d[0], str) else f'{f}:{d[0]}', 'text': trim(d[1]), 'kind': d[2]}
    return ev


# ── only through it ────────────────────────────────────────────────────────────────────────────────────────────────────
def _up(callers_of, seeds, within):
    seen, stack = set(), list(seeds)
    while stack:
        x = stack.pop()
        for a in callers_of.get(x, ()):
            if a in within and a not in seen:
                seen.add(a); stack.append(a)
    return seen


def only_through(callers_of, keep, row, within):
    """the members of `within` reached upward from `row` and from none of `keep` (the other dependents): the row's own
    callable among them, since asked again without the row it leaves the answer too"""
    mine = _up(callers_of, [row], within) | ({row} & within)
    if not mine: return set()
    others = [k for k in keep if k != row]
    return mine - _up(callers_of, others, within) - set(others)


def rank(rows, cert_rank):
    """the strongest non-exact rows first: the surer rung, then the more the answer stands on it, then source order"""
    return sorted(rows, key=lambda r: (cert_rank(r.get('certainty')), -((r.get('only_through') or {}).get('callables', 0)
                                                                        + (r.get('only_through') or {}).get('tests', 0)),
                                       r.get('at') or ''))


# ── one document ───────────────────────────────────────────────────────────────────────────────────────────────────────
ORDER = ['one of a set', 'dispatch', 'registered', 'remote', 'capped set', 'in scope', 'spawns', 'by key',
         'decorator by name', 'protocol', 'fixture', 'by name', 'text']


def cert_rank(c):
    return ORDER.index(c) if c in ORDER else len(ORDER)


def attach(rows, src, name_of, top=TOP):
    """evidence on the `top` strongest non-exact rows (already carrying only_through when it is known); returns how many
    non-exact rows were left without it"""
    weak = [r for r in rows if not is_exact(r.get('certainty'))]
    chosen = rank(weak, cert_rank)[:top]
    for r in chosen:
        ev = evidence(src, r.get('call_at') or r.get('at'), name_of(r))
        if ev: r['evidence'] = ev
    return max(0, len(weak) - len(chosen))


def impact_doc(doc, repo, callers_of=None, test_via=None):
    """annotate an impact --json document in place: only_through on every non-exact direct row (when the edges are
    given; a test reached through a fixture counts with its fixture), evidence on the strongest five"""
    names = [simple(t.get('label')) for t in doc.get('targets', [])]
    names = [n for n in names if n]
    src = Source(repo)
    direct = doc.get('direct', [])
    if callers_of is not None:
        seeds = [r['id'] for r in direct if r.get('certainty') not in ('alongside', 'stubs it')] + [r['id'] for r in doc.get('contract', [])]
        within = {r['id'] for r in doc.get('reached', [])} | {t['id'] for t in doc.get('tests', [])}
        tests = {t['id'] for t in doc.get('tests', [])}
        via = test_via or {}
        for r in direct:
            if is_exact(r.get('certainty')): continue
            o = only_through(callers_of, seeds, r['id'], within)
            ts = {t for t in tests if t in o or (via.get(t) and via[t] in o)}
            r['only_through'] = {'callables': len(o - tests), 'tests': len(ts)}
    def name_of(r):
        f, n = split_at(r.get('at'))
        L = src.lines(f) if f else None
        line = (L[n - 1] if L and 0 < n <= len(L) else '')
        return next((x for x in names if re.search(r'\b' + re.escape(x) + r'\b', line)), names[0] if names else '')
    rest = attach(direct, src, name_of)
    _more(doc, rest)
    return doc


def path_doc(doc, repo):
    src = Source(repo)
    hops = []
    for a in doc.get('answers', []):
        for h in a.get('hops', []):
            h.setdefault('certainty', h.get('cert'))
            hops.append(h)
    import ax_edges
    for h in hops:
        h['certainty'] = 'defines (not a call)' if not h.get('is_call', True) else ax_edges.direct_cert(h.get('tier'))
    _more(doc, attach(hops, src, lambda h: simple(h.get('to'))))
    for h in hops: h.pop('certainty', None)
    return doc


def context_doc(doc, repo):
    src = Source(repo)
    flow = doc.get('flow', [])
    parent = {}
    stack = []
    for s in flow:
        while stack and stack[-1].get('depth', 0) >= s.get('depth', 0): stack.pop()
        if stack and s.get('called_at_line'):
            s['call_at'] = f"{split_at(stack[-1].get('at'))[0]}:{s['called_at_line']}"
        stack.append(s)
    rows = [s for s in flow if s.get('call_at') and not s.get('repeat_of')]
    _more(doc, attach(rows, src, lambda s: simple(s.get('name'))))
    for s in flow: s.pop('call_at', None)
    return doc


def tests_doc(doc, repo):
    """a test reached through a non-exact hop: the line in the test's body that starts the route, and what decides it"""
    src = Source(repo)
    changed = [simple(c.get('symbol') or c.get('target') or c.get('display') or '') for c in doc.get('changed', []) if isinstance(c, dict)]
    rows = []
    for t in doc.get('tests', []):
        if is_exact(t.get('certainty')) or t.get('certainty') == 'fixture': continue
        ch = t.get('chain') or []
        want = [simple(ch[1])] if len(ch) > 1 else [x for x in changed if x]
        f, n = split_at(t.get('at'))
        L = src.lines(f) if f else None
        if not L or not n: continue
        for k in range(n, min(len(L), n + 80) + 1):
            hit = next((w for w in want if w and re.search(r'\b' + re.escape(w) + r'\s*[(`<]', L[k - 1])), None)
            if hit:
                t['call_at'] = f'{f}:{k}'; t['_name'] = hit; rows.append(t); break
    _more(doc, attach(rows, src, lambda t: t.get('_name', '')))
    for t in doc.get('tests', []): t.pop('call_at', None); t.pop('_name', None)
    return doc


def _more(doc, n):
    """the count of non-exact rows left without evidence, said only when there are some: an answer with none is unchanged"""
    if n: doc['evidence_more'] = n


def annotate(verb, doc, repo, **kw):
    """the one entry point for a --json document, and every other language's inside it"""
    if not on() or not isinstance(doc, dict): return doc
    f = {'impact': impact_doc, 'path': path_doc, 'context': context_doc, 'test-impact': tests_doc, 'tests': tests_doc}.get(verb)
    if f: f(doc, repo, **kw) if verb == 'impact' else f(doc, repo)
    return doc


# ── how it is printed ──────────────────────────────────────────────────────────────────────────────────────────────────
def lines(r, call=True, indent='    '):
    """the evidence of one row as at most two lines (and a third, the only-through count and how to ask without it)"""
    ev = r.get('evidence') or {}
    out = []
    c = ev.get('call') or {}
    # a line in the file the row already names is written L<n>: the path is on the row
    here = lambda at: 'L' + at.rpartition(':')[2] if at.rpartition(':')[0] == (r.get('at') or '').rpartition(':')[0] else at
    # printed lines are shorter than the --json text: five rows of them are the whole cost of the evidence view
    short = lambda s: s if len(s) <= PRINTED else s[:PRINTED - 1] + '…'
    if call and c: out.append(f"{indent}call     {here(c['at'])}: {short(c['text'])}")
    d = ev.get('decider')
    if d and d['at'] == c.get('at'): out.append(f"{indent}decided  on the call's own line  [{d['kind']}]")
    elif d: out.append(f"{indent}decided  {here(d['at'])}: {short(d['text'])}  [{d['kind']}]")
    # the row's own file:line is what --drop takes: it is on the row already, so it is said once, in DROP_HINT
    o = r.get('only_through')
    if o and (o.get('callables') or o.get('tests')):
        out.append(f"{indent}only through it: {o['callables']} callable(s), {o['tests']} test(s)")
    return out


DROP_HINT = "--drop <a row's file:line> asks again without that row and what stands only on it; --exact with exact edges only"


def prose_block(rows, more, what='rows'):
    """the evidence section of a prose answer: the rows that carry evidence, each with its lines"""
    ev = [r for r in rows if r.get('evidence')]
    if not ev: return []
    out = [f"evidence for the {len(ev)} strongest non-exact {what} (the line that decides each; the rest are leads):"]
    for r in ev:
        out.append(f"  [{r.get('certainty')}] {r.get('display') or r.get('name') or r.get('to') or ''}   {r.get('at')}")
        out += lines(r)
    if more: out.append(f"  +{more} more non-exact {what} without evidence (only the {TOP} strongest carry it)")
    if any(r.get('only_through') for r in ev): out.append('  ' + DROP_HINT)
    return out


def ask_again_note():
    """the line an answer asked again without some rows starts with"""
    d, x = drops(), exact_only()
    if not d and not x: return ''
    return 'asked again ' + ('with exact edges only' if x else '') + (' and ' if x and d else '') + \
           (f"without {', '.join(sorted(d))}" if d else '') + ' — what was reached only through those rows is left out'


def dropped(r):
    """is this direct row one the caller asked to leave out"""
    d = drops()
    if exact_only() and not is_exact(r.get('certainty')) and r.get('certainty') != 'alongside': return True
    if not d: return False
    return r.get('id') in d or r.get('at') in d or any(x.get('at') in d for x in r.get('reasons', []) or [])
