"""[text]: what a search by hand finds, for a question the graph has no declaration for.

NEVER ANSWER WORSE THAN GREP. A name no graph declares (a message, an environment variable, a key written in a YAML, a
string an issue quotes) was refused with "nothing named X" and nothing else, and the agent asked it then searched the
tree by hand: most of the searches that bypassed the graph were exactly that. The search is cheap and the tool knows
more than grep does about each line it finds: which declaration holds it, or that no graph reads that file at all.

So a refusal now carries the text matches, and every one of them is labelled `[text]`: a line that WRITES the name,
never a call edge, never counted as a caller, and never an exit status of 0 (the verb still refused). The containing
declaration is looked up in every graph of the repository, so a line in another language's file is placed too.

In a repository in several languages every graph refuses on its own (ax_langs.py). A verb that is one of several
(AXIOMCODE_FANOUT) prints no text block: it writes MARK and what it would have searched for on stderr, and the
dispatcher prints ONE block when no graph answered, instead of the same lines once per language.
"""
import json, os, re, subprocess, sys

MARK = 'axiomcode-text: '
SCOPE_GONE = 'scope: no indexed file in any graph has '    # the line that says an --in was dropped for the root
ROWS = 12                    # rows printed; the count of the rest is printed with them
PER_FILE = 3                 # rows from one file before the next file gets a turn
_FILE_LIKE = re.compile(r'^[\w./-]*\.[A-Za-z][\w]{0,7}$|/')
_FILE_LINE = re.compile(r':\d+(:\d+)?$')
FILE_EXTS = {'xml', 'yml', 'yaml', 'json', 'sql', 'sh', 'bash', 'dl', 'txt', 'md', 'html', 'htm', 'properties', 'toml', 'ini',
             'cfg', 'conf', 'env', 'csv', 'tsv', 'ftl', 'vm', 'jinja', 'j2', 'tmpl', 'mustache', 'hbs', 'py', 'java', 'cs',
             'ts', 'js', 'kt', 'gradle', 'ps1', 'bat', 'cmd', 'lock', 'cshtml', 'razor', 'resx', 'config', 'csproj'}


def graph_dbs(repo):
    """every graph.sqlite of the repository, the main one first"""
    import ax_langs
    return [os.path.join(d or os.path.join(repo, '.axiomcode'), 'out', 'graph.sqlite') for _, d in ax_langs.graphs(repo)]


def _con(db):
    import sqlite3
    try: return sqlite3.connect(f"file:{db}?mode=ro", uri=True)
    except Exception: return None


def held(repo, scope):
    """True when some graph of the repository holds a file with `scope` in its path"""
    for db in graph_dbs(repo):
        c = _con(db)
        if not c: continue
        try:
            if c.execute("SELECT 1 FROM symbols WHERE file LIKE ? LIMIT 1", (f'%{scope}%',)).fetchone(): return True
        except Exception: pass
        finally: c.close()
    return False


def declared(repo, name):
    """True when some graph declares a symbol named `name`"""
    for db in graph_dbs(repo):
        c = _con(db)
        if not c: continue
        try:
            if c.execute("SELECT 1 FROM symbols WHERE name = ? LIMIT 1", (name,)).fetchone(): return True
        except Exception: pass
        finally: c.close()
    return False


def needles(asked):
    """[(needle, whole word?)] to try in turn for a name as it was asked: the whole of it, then (for Owner.member) the
    member alone. A quoted string is searched as written; a file:line is not searched (the graph answers a line)"""
    s = asked.strip()
    if len(s) > 1 and s[0] in '"\'`' and s[-1] == s[0]: return [(s[1:-1], False)] if s[1:-1] else []
    if _FILE_LINE.search(s) or s in ('*', ''): return []
    s = re.sub(r'\([^()]*\)$', '', s)                                  # Owner.m(p): the name, not the signature
    word = lambda x: bool(re.fullmatch(r'\w+', x))
    out = [(s, word(s))]
    last = re.split(r'[.#:$]', s)[-1]
    # the member of Owner.member; never the extension of a file name (`JobsMapper.xml` is not every line with 'xml')
    if last and last != s and word(last) and len(last) >= 3 and last.lower() not in FILE_EXTS: out.append((last, True))
    base = s.rsplit('/', 1)[-1]
    if '/' in s and re.search(r'\.[A-Za-z]\w{0,7}$', base) and len(base) >= 4: out.append((base, False))   # a path: code joins it
    return out


def _git(repo, args):
    try:
        r = subprocess.run(['git', '-C', repo] + args, capture_output=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired): return None
    return r.stdout.decode('utf-8', 'replace') if r.returncode in (0, 1) else None


def _walk(repo):
    import ax_fresh
    for root, dirs, files in os.walk(repo):
        dirs[:] = [d for d in dirs if d not in ax_fresh.PRUNE_ALL and not d.startswith('.')]
        rel = os.path.relpath(root, repo).replace(os.sep, '/')
        for fn in files: yield fn if rel == '.' else f"{rel}/{fn}"


def files(repo):
    """every file of the repository a search by hand would look at: git's (tracked and untracked, not ignored), else
    the refresher's pruned walk"""
    out = _git(repo, ['ls-files', '-co', '--exclude-standard'])
    fs = out.splitlines() if out is not None else list(_walk(repo))
    return [f for f in fs if f and not f.startswith('.axiomcode/')]


def grep(repo, needle, word):
    """[(file, line, text)] of every line holding `needle` (as a whole word when `word`), outside .axiomcode"""
    out = _git(repo, ['grep', '-n', '-I', '--no-color', '--untracked', '-F'] + (['-w'] if word else []) +
               ['-e', needle, '--', '.', ':(exclude).axiomcode'])
    hits = []
    if out is not None:
        for l in out.splitlines():
            m = re.match(r'^(.*?):(\d+):(.*)$', l)
            if m: hits.append((m.group(1), int(m.group(2)), m.group(3)))
        return hits
    pat = re.compile((r'(?<!\w)' + re.escape(needle) + r'(?!\w)') if word else re.escape(needle))
    for f in _walk(repo):
        p = os.path.join(repo, f)
        try:
            if os.path.getsize(p) > 2 << 20: continue
            with open(p, 'rb') as fh: data = fh.read()
        except OSError: continue
        if b'\0' in data[:4096]: continue
        for i, l in enumerate(data.decode('utf-8', 'replace').splitlines(), 1):
            if pat.search(l): hits.append((f, i, l))
    return hits


# ── a phrase written with a value between its words ────────────────────────────────────────────────────────────────
# A message is rarely written as the words an agent reads: `f"no graph holds '{name}' under the root"` (Python),
# `$"no graph holds '{name}' under the root"` (C#), `String.format("no graph holds '%s' under the root", name)` or
# `"no graph holds '" + name + "' under the root"` (Java). Searched as one literal run of text, "holds under the root"
# is on no line, and the answer said "no line of the repository's files writes it". So a phrase of several words that no
# line writes as asked is searched again with each gap between two words allowed to hold an interpolation (a {..}
# hole, a %s / %1$s / %(name)s placeholder, a " + expr + " concatenation), quoted or not; and, when that finds nothing
# either, with one of its inner words standing for such a hole (the agent quoted the message with a value in it). Both stay
# on one line, and a gap holds only whitespace and interpolations: two literals that happen to hold the words apart
# (`log("stock level"); ... ; warn("is negative")`) are not one phrase.
_Q = r'(?:\\?["\'`])?'
_SLOT = (r'(?:\{[^{}\n]{1,60}\}'                                        # {scope} {0} {x:N2} {x!r}
         r'|%(?:\(\w+\))?[-#+ 0,(]*\d*(?:\.\d+)?[a-zA-Z]|%\d+\$[a-zA-Z]'   # %s %-5d %(name)s %1$s
         r'|["\']\s*\+\s*[^"\'\n;]{1,60}?\s*\+\s*["\']'               # " + scope + "
         r'|["\']\s*\+\s*["\'])')                                        # "a " + " b": one message in two pieces
_HOLE = _Q + _SLOT + _Q
_GAP = r'(?:\s|' + _HOLE + r')+'


def _words(needle):
    ws = needle.split()
    return ws if len(ws) >= 2 and sum(1 for w in ws if re.search(r'\w', w)) >= 2 else []


def phrase_patterns(needle):
    """[(compiled pattern, how it differs from the phrase as asked)] to try in turn for a phrase no line writes as
    asked: its words with an interpolation allowed in each gap, then (three words or more) one inner word standing for one"""
    ws = _words(needle)
    if not ws: return []
    out = [(re.compile(_GAP.join(re.escape(w) for w in ws)), 'with an interpolation between its words')]
    if len(ws) >= 3:
        # an inner word only: the words at both ends stay literal, so the phrase is still anchored on what was asked
        alts = [_GAP.join(_HOLE if j == i else re.escape(w) for j, w in enumerate(ws)) for i in range(1, len(ws) - 1)]
        out.append((re.compile('|'.join(f'(?:{a})' for a in alts)), 'with an interpolation in place of one word'))
    return out


def grep_phrase(repo, needle, have=()):
    """-> ([(file, line, text)], pattern, how) for the first of phrase_patterns(needle) that some line other than those
    in `have` (the lines that write it as asked) matches, else ([], None, ''). The lines are found by the two longest
    words (any variant keeps one of them), then matched whole"""
    pats = phrase_patterns(needle)
    if not pats: return [], None, ''
    keys = sorted({re.sub(r'^\W+|\W+$', '', w) for w in _words(needle)} - {''}, key=len, reverse=True)[:2]
    cand = {}
    for k in keys:
        for h in grep(repo, k, False): cand[(h[0], h[1])] = h
    for pat, how in pats:
        hits = [h for _k, h in sorted(cand.items()) if h not in have and pat.search(h[2])]
        if hits: return hits, pat, how
    return [], None, ''


class Places:
    """the declaration that holds a line, in whichever graph holds its file"""
    def __init__(self, repo):
        self.cons = [c for c in (_con(db) for db in graph_dbs(repo)) if c]
        self.cache = {}

    def graph_file(self, rel):
        """(connection, the path that graph stores for this file) or (None, None). A graph built with --src stores paths
        under it, so a repository path is matched by its longest suffix that some graph holds"""
        if rel in self.cache: return self.cache[rel]
        parts = rel.split('/'); found = (None, None)
        for i in range(len(parts)):
            cand = '/'.join(parts[i:])
            for c in self.cons:
                try:
                    if c.execute("SELECT 1 FROM symbols WHERE file = ? LIMIT 1", (cand,)).fetchone(): found = (c, cand); break
                except Exception: pass
            if found[0]: break
        self.cache[rel] = found
        return found

    # a member the parser generated (a Lombok accessor, an implicit constructor) spans its whole type from the type's first
    # line: it holds every line of the type, and is not what any of them was written in. A synthesized <Main>$ is kept:
    # it is where C# top-level statements are written
    _REAL = """AND kind NOT IN ('module', 'library', 'written', 'file')
               AND NOT (kind IN ('function', 'method', 'constructor') AND name NOT LIKE '<%' AND EXISTS (SELECT 1 FROM symbols t WHERE t.file = s.file
                        AND t.kind IN ('class', 'interface', 'enum', 'struct', 'record', 'type') AND t.line = s.line))"""

    def decl(self, rel, line, callable_only=False, kinds=None):
        """(display, kind, method_id, name, line) of the innermost declaration around the line (callable_only: the
        innermost function, method or constructor; kinds: the innermost of those kinds), or None"""
        c, f = self.graph_file(rel)
        if not c: return None
        kinds = CALLABLE if callable_only else kinds
        only = f"AND kind IN ({', '.join(repr(k) for k in kinds)})" if kinds else ''
        try:
            return c.execute(f"""SELECT display, kind, method_id, name, line FROM symbols s WHERE file = ? AND line <= ? AND end_line >= ?
                                {self._REAL} {only} ORDER BY line DESC, end_line ASC LIMIT 1""", (f, line, line)).fetchone()
        except Exception: return None

    def below(self, rel, line, reach=6):
        """the type or callable that starts within `reach` lines below: what an annotation or attribute line is written on"""
        c, f = self.graph_file(rel)
        if not c: return None
        try:
            return c.execute(f"""SELECT display, kind, method_id, name, line FROM symbols s WHERE file = ? AND line > ? AND line <= ?
                                {self._REAL} AND kind IN ({', '.join(repr(k) for k in CALLABLE + TYPES)})
                                ORDER BY line ASC, end_line DESC LIMIT 1""", (f, line, line + reach)).fetchone()
        except Exception: return None

    def of(self, rel, line):
        """'in <declaration>' for the innermost declaration around the line, 'not indexed' for a file no graph holds,
        '' for a line in an indexed file outside every declaration"""
        c, f = self.graph_file(rel)
        if not c: return 'not indexed'
        r = self.decl(rel, line)
        return f"in {r[0]}" if r else ''

    def lang(self, rel):
        """the language of the graph that holds the file, or None"""
        c, _f = self.graph_file(rel)
        if not c: return None
        if id(c) not in self.cache:
            try: r = c.execute("SELECT value FROM run WHERE key = 'language'").fetchone()
            except Exception: r = None
            self.cache[id(c)] = (r[0] or '').lower() if r else ''
        return self.cache[id(c)]

    def is_test(self, rel):
        """the graph's own test flag for the file (by its path), or the path rule when no graph holds it"""
        c, f = self.graph_file(rel)
        if c:
            try:
                r = c.execute("SELECT max(is_test) FROM symbols WHERE file = ?", (f,)).fetchone()
                if r and r[0] is not None: return bool(r[0])
            except Exception: pass
        return bool(TEST_PATH.search(rel))

    def users(self, rel, method_id):
        """(n, [display]) of the declarations the graph says call `method_id`, surest tiers only (never a by-name guess)"""
        c, _f = self.graph_file(rel)
        if not c or not method_id: return 0, []
        try:
            rows = c.execute("""SELECT DISTINCT s.display FROM call_edges e JOIN symbols s ON s.method_id = e.caller_id
                                WHERE e.callee_method_id = ? AND e.tier NOT LIKE 'ambiguous%' AND e.caller_id != ?
                                ORDER BY s.is_test, s.display""", (method_id, method_id)).fetchall()
        except Exception: return 0, []
        return len(rows), [r[0] for r in rows]


# ── [approx]: the code that holds a text match, placed in its declaration ───────────────────────────────────────────
# A [text] row says WHERE a line is; the question behind it ("which code prints this message", "who runs build.sh",
# "who reads this table") wants the DECLARATION that does it, and what reaches that declaration. So a match that sits in
# code of an indexed file (not a comment, not a docstring, not a test) is answered by its enclosing declaration with the
# graph's callers of that declaration, labelled [approx]: found by text, placed by the graph, never a call edge. A match
# held by a constant or a field (OUT = HERE / "decls_all.dl") is followed one step, by name, to the code of the same
# graph that reads it. Every row keeps its evidence line. Nothing crosses languages: the declaration and its readers are
# looked up in the one graph that holds the file.
TEST_PATH = re.compile(r'(^|/)(tests?|__tests__|specs?|testdata|fixtures?)/|(^|/)test_[^/]*\.py$|_test\.py$|'
                       r'Tests?\.(java|kt|cs)$|IT\.java$|(^|/)conftest\.py$')
_CLIKE = {'.java', '.cs', '.kt', '.scala', '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.go', '.c', '.h', '.cpp', '.cc', '.swift'}
APPROX_LANGS = ('python', 'java', 'csharp')          # measured on these; another language's graph keeps its [text] rows
CALLABLE = ('function', 'method', 'constructor')
HOLDER = ('const', 'variable', 'field', 'property')
TYPES = ('class', 'interface', 'enum', 'struct', 'record', 'type')
ANNOTATION = re.compile(r'\s*(@[A-Za-z_][\w.]*\s*\(|\[[A-Za-z_][\w.]*\s*\()')     # a Java/Python decoration, a C# attribute
RUNS = re.compile(r'\b(subprocess|Popen|check_call|check_output|os\.system|os\.exec\w*|os\.spawn\w*|execvp?|ProcessBuilder|'
                  r'getRuntime\(\)\.exec|Process\.Start|ProcessStartInfo)\b')
WRITES = re.compile(r'\b(write_text|write_bytes|FileWriter|FileOutputStream|Files\.write\w*|File\.Write\w*|StreamWriter|'
                    r'OpenWrite|File\.Create)\b|\bopen\([^)]*,\s*["\'][wax]')
READS = re.compile(r'\b(open|read_text|read_bytes|load|loads|safe_load|read_csv|read_sql\w*|execute|executemany|'
                   r'executescript|query|executeQuery|executeUpdate|prepareStatement|prepareCall|createQuery|createNativeQuery|'
                   r'ExecuteReader\w*|ExecuteNonQuery\w*|ExecuteScalar\w*|FromSqlRaw|SqlQuery|Query\w*|SqlCommand|readAllBytes|readAllLines|readString|FileReader|FileInputStream|getResource\w*|'
                   r'ReadAllText|ReadAllLines|ReadAllBytes|StreamReader|OpenRead|OpenText|Load|import_module|'
                   r'getenv|getProperty|GetEnvironmentVariable|GetValue|GetSection|get)\s*\(|\benviron\b|\bprocess\.env\b', re.I)
SQL = re.compile(r'\b(SELECT|INSERT|UPDATE|DELETE|MERGE)\b.*\b(FROM|INTO|SET|WHERE|USING)\b')   # a query written in the code
EMITS = re.compile(r'\b(print|println|printf|log|logger|logging|warn\w*|error|info|debug|raise|throw|abort|exit|'
                   r'Console\.Write\w*|System\.(out|err)|std(out|err)|Write(Line)?|'
                   r'Log(Information|Warning|Error|Debug|Critical|Trace)(Async)?|_?logger\.\w+)\b', re.I)
RENDERS = re.compile(r'\b(render_template\w*|render_to_string|render|TemplateResponse|get_template|select_template|'
                     r'ModelAndView|View|PartialView|template_name)\b')
_RANK = {'runs it': 0, 'writes it': 1, 'reads it': 2, 'renders it': 2, 'emits it': 3, 'names it': 4}


def _verb(line):
    if RUNS.search(line): return 'runs it'
    if WRITES.search(line): return 'writes it'
    if RENDERS.search(line): return 'renders it'
    if READS.search(line) or SQL.search(line): return 'reads it'
    if EMITS.search(line): return 'emits it'
    return 'names it'


def _py_kinds(text):
    """{line: [(col0, col1, kind)]} for the strings, docstrings and comments of a Python file (tokenize), or None"""
    import io, tokenize
    out = {}
    def put(sr, sc, er, ec, kind):
        for ln in range(sr, er + 1):
            out.setdefault(ln, []).append((sc if ln == sr else 0, ec if ln == er else 1 << 30, kind))
    try:
        toks = list(tokenize.generate_tokens(io.StringIO(text).readline))
    except (tokenize.TokenError, IndentationError, SyntaxError): return None
    sig = [t for t in toks if t.type not in (tokenize.NL, tokenize.COMMENT)]
    prev = {id(t): (sig[i - 1] if i else None) for i, t in enumerate(sig)}
    nxt = {id(t): (sig[i + 1] if i + 1 < len(sig) else None) for i, t in enumerate(sig)}
    fstart = getattr(tokenize, 'FSTRING_START', -1); fend = getattr(tokenize, 'FSTRING_END', -1)
    open_f = []
    for t in toks:
        if t.type == tokenize.COMMENT: put(*t.start, *t.end, 'comment')
        elif t.type == fstart: open_f.append(t)
        elif t.type == fend and open_f:
            s = open_f.pop(); put(*s.start, *t.end, 'string')
        elif t.type == tokenize.STRING:
            p, n = prev.get(id(t)), nxt.get(id(t))
            # a string that is a statement on its own is a docstring (or a comment written as one): prose, not code
            alone = (p is None or p.type in (tokenize.NEWLINE, tokenize.INDENT, tokenize.DEDENT)) and \
                    (n is None or n.type in (tokenize.NEWLINE, tokenize.ENDMARKER))
            put(*t.start, *t.end, 'doc' if alone else 'string')
    return out


def _c_kinds(text):
    """{line: [(col0, col1, kind)]} for the strings and comments of a C-family file (Java, C#): a small scanner, enough to
    tell a literal from a comment; /** */ and /// are comments, a Java text block and a C# verbatim string are strings"""
    out = {}; i, n, ln, col = 0, len(text), 1, 0
    def put(sl, sc, el, ec, kind):
        for x in range(sl, el + 1):
            out.setdefault(x, []).append((sc if x == sl else 0, ec if x == el else 1 << 30, kind))
    while i < n:
        ch = text[i]
        if ch == '\n': ln += 1; col = 0; i += 1; continue
        two = text[i:i + 2]
        if two == '//' or two == '/*' or ch in '"\'`':
            if two == '//':
                end = text.find('\n', i); end = n if end < 0 else end; kind = 'comment'
            elif two == '/*':
                end = text.find('*/', i + 2); end = n if end < 0 else end + 2; kind = 'comment'
            else:
                q = '"""' if text.startswith('"""', i) else ch
                j = i + len(q); verbatim = i > 0 and text[i - 1] == '@'
                while j < n:
                    if text[j] == '\\' and q != '"""' and not verbatim: j += 2; continue
                    if verbatim and text.startswith('""', j): j += 2; continue
                    if text.startswith(q, j): j += len(q); break
                    if text[j] == '\n' and q in '"\'' and not verbatim: break
                    j += 1
                end = min(j, n); kind = 'string'
            seg = text[i:end]; nl = seg.count('\n')
            eln = ln + nl; ecol = (len(seg) - seg.rfind('\n') - 1) if nl else col + len(seg)
            put(ln, col, eln, ecol, kind)
            ln, col, i = eln, ecol, end
            continue
        i += 1; col += 1
    return out


class Lexed:
    """what kind of text each match sits in: code, string, comment or doc (a docstring), per file, read once"""
    def __init__(self, repo):
        self.repo, self.cache, self.text = repo, {}, {}

    def header(self, rel, a, b):
        """lines a..b-1 of the file are all annotations, attributes, their continuations or blank: a declaration's header"""
        if rel not in self.text:
            try:
                with open(os.path.join(self.repo, rel), encoding='utf-8', errors='replace') as fh: self.text[rel] = fh.read().split('\n')
            except OSError: self.text[rel] = []
        ls = self.text[rel]
        return b - a <= 8 and all(re.match(r'\s*($|@|\[|[)\]},"\'\w=\s]+[),\]]\s*$)', ls[i - 1]) for i in range(a, b) if 0 < i <= len(ls))

    def kinds(self, rel):
        if rel in self.cache: return self.cache[rel]
        ext = os.path.splitext(rel)[1].lower(); k = None
        try:
            with open(os.path.join(self.repo, rel), encoding='utf-8', errors='replace') as fh: text = fh.read()
        except OSError: text = None
        if text is not None and len(text) < 4 << 20:
            if ext in ('.py', '.pyi') or (not ext and text.startswith('#!') and 'python' in text[:80]): k = _py_kinds(text)
            elif ext in _CLIKE: k = _c_kinds(text)
        self.cache[rel] = k
        return k

    def at(self, rel, line, col):
        """'code', 'string', 'comment' or 'doc' at line:col, or None when the file is not lexed"""
        k = self.kinds(rel)
        if k is None: return None
        for c0, c1, kind in k.get(line, ()):
            if c0 <= col < c1: return kind
        return 'code'

    def best(self, rel, line, text, needle, word):
        """the kind of the most code-like occurrence of `needle` (a string, or a compiled pattern) on the line: a string
        or code beats a comment"""
        pat = needle if isinstance(needle, re.Pattern) else \
            re.compile((r'(?<!\w)' + re.escape(needle) + r'(?!\w)') if word else re.escape(needle))
        got = [self.at(rel, line, m.start()) for m in pat.finditer(text)]
        if not got or got[0] is None: return None
        for want in ('string', 'code', 'doc', 'comment'):
            if want in got: return want
        return got[0]


def _cut(t, n):
    t = t.strip()
    return t if len(t) <= n else t[:n - 3] + '…'


def approx(repo, hits, needle, word, filelike, places, lex, rows=ROWS, pat=None, how=''):
    """-> ([printed lines], the hits they answer). A hit is answered here when it sits in code of an indexed, non-test
    file, inside a declaration: in a string literal when the name asked is a file (its path, as the code writes it), in
    a string or in code otherwise. A comment, a docstring, a test and a file no graph reads stay [text] rows"""
    used, found, holders, typed = set(), {}, [], {}
    for h in hits:
        f, ln, t = h
        if places.lang(f) not in APPROX_LANGS or places.is_test(f): continue
        k = lex.best(f, ln, t, pat or needle, word)
        if k is None or k in ('comment', 'doc'): continue
        if filelike and k != 'string': continue
        d = places.decl(f, ln)
        if ANNOTATION.match(t) and not (d and d[1] in CALLABLE + TYPES and lex.header(f, d[4], ln)):
            b = places.below(f, ln)                                               # @TableName("orders") above its class
            if b and lex.header(f, ln, b[4]): d = b
        elif d and d[1] not in CALLABLE: d = places.decl(f, ln, True) or d      # a local variable: its function
        if d and d[1] in HOLDER and (d[3] or '').startswith('__'):
            d = places.decl(f, ln, kinds=TYPES) or d                              # __tablename__ = "orders": the class
        if not d: continue
        if d[1] in CALLABLE:
            found.setdefault((f, d[0]), {'decl': d, 'rows': []})['rows'].append((ln, t, None)); used.add(h)
        elif d[1] in HOLDER and d[3] and re.fullmatch(r'\w+', d[3]) and len(holders) < 6:
            holders.append((h, d)); used.add(h)
        elif d[1] in TYPES and k == 'string' and ANNOTATION.match(t):
            # written on the type itself: an annotation or attribute argument (@TableName("orders"), [Table("orders")])
            typed.setdefault((f, d[0]), (ln, t, d)); used.add(h)
    # one step through a constant or a field that holds it: the code of the same graph that reads that name, in its own
    # file, or elsewhere where it is written qualified (`cfg.OUT`, `Paths.OUT`) or imported
    reached, common = set(), set()
    for (f, ln, t), d in holders:
        name = d[3]
        c0 = places.graph_file(f)[0]
        # a plain lowercase word (`id`, `name`, `path`) read by name is every other `id`: the step is not taken
        if re.fullmatch(r'[a-z]+', name) or len(name) < 3: common.add((f, ln)); continue
        # another file reads it only by a name that points at this holder: a module constant imported or qualified by its
        # module (Python), a constant qualified by its type (`Paths.SEED`); a field is followed in its own file only
        owner = (d[0].rsplit('.', 1)[0].rsplit('.', 1)[-1]) if '.' in d[0] else ''
        if places.lang(f) == 'python' and d[1] in ('const', 'variable') and not owner:
            other = re.compile(r'\.' + re.escape(name) + r'(?!\w)|\bimport\b.*\b' + re.escape(name) + r'\b')
        elif d[1] == 'const' and owner:
            other = re.compile(r'\b' + re.escape(owner) + r'\.' + re.escape(name) + r'(?!\w)|\bimport\s+static\b.*\.' + re.escape(name) + r'\b')
        else:
            other = None
        for rf, rl, rt in grep(repo, name, True):
            if (rf, rl) == (f, ln) or places.graph_file(rf)[0] is not c0 or places.is_test(rf): continue
            if rf != f and not (other and other.search(rt)): continue
            if lex.best(rf, rl, rt, name, True) != 'code': continue
            d2 = places.decl(rf, rl, True)
            if not d2 or d2[1] not in CALLABLE: continue
            found.setdefault((rf, d2[0]), {'decl': d2, 'rows': []})['rows'].append((rl, rt, (name, f, ln, t)))
            reached.add((f, ln))
    if not found and not holders and not typed: return [], used
    verb = lambda r: _verb(r[1])
    ordered = sorted(found.items(), key=lambda kv: (min(_RANK[verb(r)] for r in kv[1]['rows']), kv[0][0], kv[1]['rows'][0][0]))
    out = []
    if ordered or typed:
        out.append(f"[approx] the code that {'names the file' if filelike else 'holds'} '{needle}'{f' ({how})' if how else ''}: found as text, placed in its "
                   f"declaration by the graph; approximate, not call edges ({len(ordered) + len(typed)} declaration(s)):")
    for (f, disp), v in ordered[:rows]:
        rs = sorted(v['rows'], key=lambda r: (_RANK[verb(r)], r[0]))
        ln, t, via = rs[0]
        more = f" (+{len(rs) - 1} more line(s) in it)" if len(rs) > 1 else ''
        out.append(f"    [approx] {verb(rs[0])}   {disp}   {f}:{ln}{more}   | {_cut(t, 100)}")
        if via: out.append(f"             via {via[0]}, which holds it at {via[1]}:{via[2]}   | {_cut(via[3], 80)}")
        n, who = places.users(f, v['decl'][2])
        out.append(f"             reached from {n} caller(s) in the graph: {', '.join(who[:4])}{' …' if n > 4 else ''}" if n else
                   "             no caller in the graph (an entry point, or reached only through what the graph cannot see)")
    if len(ordered) > rows: out.append(f"    … +{len(ordered) - rows} more declaration(s)")
    for (f, disp), (ln, t, d) in list(typed.items())[:rows]:
        out.append(f"    [approx] {verb((ln, t, None))}   {disp} ({d[1]})   {f}:{ln}   | {_cut(t, 100)}")
        out.append(f"             written on the {d[1]} itself: `impact {disp}` for the code that uses it")
    for (f, ln, t), d in holders:
        if (f, ln) not in reached:
            why = (f"not followed: '{d[3]}' is a common word, so its readers by name would be every other '{d[3]}'" if (f, ln) in common
                   else f"no code of this graph reads '{d[3]}' by that name")
            out.append(f"    [approx] held by {d[0]}   {f}:{ln}   | {_cut(t, 100)}   ({why})")
    return out, used


QUALIFIED = re.compile(r'(?<![\w.$])[A-Za-z_][\w$]*(?:\.[A-Za-z_][\w$]*){1,}(?![\w$])')


def names_in_file(repo, rel, places, rows=ROWS):
    """[printed lines]: the declarations a file no graph reads names by their qualified name (a mapper XML's namespace,
    a bean's class, a script's `java -cp … com.acme.Main`), each placed by the graph that declares it, [approx]. The
    other direction of the same question: what code this file is bound to"""
    try:
        if os.path.getsize(os.path.join(repo, rel)) > 512 * 1024: return []
        with open(os.path.join(repo, rel), encoding='utf-8', errors='replace') as fh: text = fh.read()
    except OSError: return []
    where = {}
    for i, l in enumerate(text.split('\n'), 1):
        for m in QUALIFIED.finditer(l):
            where.setdefault(m.group(0), (i, l))
            if len(where) > 400: break
    if not where: return []
    kinds = ', '.join(repr(k) for k in TYPES + CALLABLE)
    got = []
    for c in places.cons:
        try: lang = (c.execute("SELECT value FROM run WHERE key = 'language'").fetchone() or [''])[0].lower()
        except Exception: lang = ''
        if lang not in APPROX_LANGS: continue
        qs = list(where)
        for k in range(0, len(qs), 400):
            part = qs[k:k + 400]
            try:
                got += [(r, where[r[4]]) for r in c.execute(
                    f"SELECT display, kind, file, line, qualified_name FROM symbols WHERE qualified_name IN ({', '.join('?' * len(part))}) "
                    f"AND kind IN ({kinds}) AND is_test = 0", part)]
            except Exception: pass
    if not got: return []
    got.sort(key=lambda g: g[1][0])
    out = [f"[approx] {rel} itself names {len(got)} declaration(s) of the graph by qualified name, which is what the file is bound to:"]
    for (disp, kind, f, ln, _q), (fl, ft) in got[:rows]:
        out.append(f"    [approx] named by it   {disp} ({kind})   {f}:{ln}   | {rel}:{fl}: {_cut(ft, 80)}")
    if len(got) > rows: out.append(f"    … +{len(got) - rows} more")
    return out


def unindexed_file(repo, name):
    """the repository files a name asked about denotes when no graph reads them as source; [] when it is not such a file"""
    s = name.strip().strip('"\'`').lstrip('./')
    if not s or ' ' in s or not re.search(r'\.[A-Za-z]\w{0,7}$', s): return []
    fs = [f for f in files(repo) if f == s or f.endswith('/' + s)]
    if not fs: return []
    places = Places(repo)
    return [f for f in fs if not places.graph_file(f)[0]]


def block(repo, asked, scope=None, why='unresolved', rows=ROWS):
    """the text lines to print for names the graph could not answer (`asked`), searched under `scope` when some file
    lies there, else at the root (and said so). '' when there is nothing to search for"""
    lines = []
    places = lex = None; rowed = False; approxed = False
    for a in dict.fromkeys(asked):
        tries = needles(a)
        if not tries: continue
        hits, used, pat, how = [], None, None, ''
        for i, (n, w) in enumerate(tries):
            hits = grep(repo, n, w); used = (n, w)
            if i == 0 and not w and _words(n):
                # a message written with a value between its words (an f-string, $"...", String.format, a concatenation).
                # Searched even when some line writes it as asked: that line is often a doc or an issue quoting the
                # message, and the code that prints it is the line with the hole
                extra, p2, h2 = grep_phrase(repo, n, set(hits))
                if extra: hits, pat, how = hits + extra, p2, h2
            if hits: break
        places = places or Places(repo); lex = lex or Lexed(repo)
        at = pat or used[0]                   # what to look for on a matched line: the phrase, or the pattern that found it
        if why == 'string' and hits:
            # a STRING in a source file is written quoted; the same word bare there is an identifier (a field, a local)
            # and another question. A file no graph reads keeps every mention: a YAML value is written bare. Inside a
            # longer literal it is still the string (a table in "SELECT id FROM orders")
            quoted = re.compile(r'["\'`]' + re.escape(used[0]) + r'["\'`]')
            hits = [h for h in hits if quoted.search(h[2]) or not places.graph_file(h[0])[0]
                    or lex.best(h[0], h[1], h[2], at, used[1]) == 'string']
        under = ''
        if scope:
            inside = [h for h in hits if scope in h[0]]
            if inside: hits = inside; under = f", under {scope}"
            elif hits: under = f"; none under {scope}, so these are from the whole repository"
        n, w = used
        also = f" (as '{n}')" if n != tries[0][0] else (f" ({how})" if how else '')
        # a name that reads as a file: the files whose path holds it come first, which is what the search by hand was for
        paths = []
        if _FILE_LIKE.search(tries[0][0]) and ' ' not in tries[0][0]:
            want = tries[0][0].lstrip('./')
            paths = [f for f in files(repo) if f == want or f.endswith('/' + want) or want in f][:rows]
        q = tries[0][0] if not tries[0][1] and a.strip()[:1] in '"\'`' else a       # a quoted string, shown quoted once
        head = {'unresolved': f"the graph has no declaration for '{q}'", 'quoted': f"no declaration is named '{q}'",
                'string': f"'{q}' is a string, so beside the literal sites above",
                'undeclared': f"no graph declares '{q}': the rows above match it by name only, and"}.get(why, f"'{q}'")
        if paths:
            lines.append(f"[text] files whose path holds '{tries[0][0]}' ({len(paths)}{'+' if len(paths) == rows else ''}):")
            lines += [f"    [text] {f}" for f in paths]
        # the code that holds it, placed in its declaration with what reaches that ([approx]); the rest stay [text]. A file
        # no graph reads is also answered the other way round: the declarations the file itself names
        ours = unindexed_file(repo, tries[0][0])
        ap, taken = approx(repo, hits, n, w, bool(ours), places, lex, rows, pat, how) if hits else ([], set())
        if ours and not ap:
            ap.append(f"[approx] no code outside the tests names '{n}' in a string literal: nothing the graph holds is seen "
                      f"to run, read or write {', '.join(ours[:3])} (a path built from pieces is not seen)")
        for o in ours[:3]: ap += names_in_file(repo, o, places, rows)
        lines += ap; approxed = approxed or any(re.match(r'\s+\[approx\] (\w+ it|named by it)   ', l) for l in ap)
        if not hits:
            if not paths and not ap and why not in ('string', 'undeclared'):
                lines.append(f"[text] {head}, and no line of the repository's files writes it either"
                             + (f" (nor '{n}')" if len(tries) > 1 else '') + ": absent from the text, not only from the graph.")
            continue
        hits = [h for h in hits if h not in taken]
        if not hits: continue
        nfiles = len({h[0] for h in hits})
        rowed = True
        lines.append(f"[text] {head}; the {'other ' if taken else ''}lines that write it{also} — text, not call edges "
                     f"({len(hits)} line(s) in {nfiles} file(s){under}):")
        shown, per = [], {}
        for f, ln, t in sorted(hits, key=lambda h: (h[0], h[1], h[2])):     # total: a tie on (file, line) is never left to input order
            if per.get(f, 0) >= PER_FILE: continue
            per[f] = per.get(f, 0) + 1; shown.append((f, ln, t))
        # one row per file first, so twelve rows name twelve files rather than one file twelve times
        seen = set(); firsts = []
        for h in shown:
            if h[0] not in seen: seen.add(h[0]); firsts.append(h)
        order = firsts + [h for h in shown if h not in firsts]
        for f, ln, t in order[:rows]:
            where = places.of(f, ln)
            if where != 'not indexed':
                # why this line is not an [approx] row: said, so a comment or a test is not read as the answer
                k = lex.best(f, ln, t, at, w)
                tag = {'comment': 'a comment', 'doc': 'a docstring'}.get(k) or ('a test' if places.is_test(f) else '')
                if tag: where = f"{where} · {tag}" if where else tag
            t = t.strip()
            t = t if len(t) <= 110 else t[:107] + '…'
            lines.append(f"    [text] {f}:{ln}" + (f"   {where}" if where else '') + f"   | {t}")
        rest = len(hits) - min(len(order), rows)
        if rest > 0:
            lines.append(f"    … +{rest} more line(s): git grep -n{'w' if w else ''} -F -e '{n}'" if not pat else
                         f"    … +{rest} more line(s): git grep -nP -e '{pat.pattern}'")
        # a name no graph declares that ARRIVES THROUGH AN IMPORT is the signature of an unstaged dependency, the
        # commonest setup gap there is: without the hint this answer is indistinguishable from an engine gap, and the
        # fix (stage the dependency's source) is one flag away. Only for undeclared names: a string or a resolved
        # target wants no staging advice.
        if why == 'undeclared' and any(re.match(r'\s*(import\b|using\b|from\s)', t.strip()) and n in t for _f, _l, t in hits):
            lines.append(f"    this name arrives through an import, so it is likely declared in a dependency: calls through "
                         f"it resolve once that dependency's source is staged — `axiomcode index --library <its source dir>`")
    if not lines: return ''
    if approxed: lines.append("next: [approx] rows are text placed in the declaration that holds it, not resolved edges: read the "
                              "evidence line, then `impact <that declaration>` for what a change reaches")
    elif rowed and why == 'unresolved': lines.append("next: these [text] rows are leads, not resolved edges — open the one that fits; for code the graph "
                 "does hold, ask again by the name of the declaration a row sits in")
    return '\n'.join(lines) + '\n'


def emit(repo, asked, scope=None, why='unresolved', rows=ROWS):
    """print the block (a verb alone) or hand what it would search for to the dispatcher (a verb that is one of several)"""
    asked = [a for a in asked if a]
    if not asked: return
    if os.environ.get('AXIOMCODE_FANOUT') == '1':
        sys.stderr.write(MARK + json.dumps({'asked': asked, 'scope': scope, 'why': why, 'rows': rows}) + '\n'); sys.stderr.flush()
        return
    b = block(repo, asked, scope, why, rows)
    if b: sys.stdout.write('\n' + b); sys.stdout.flush()


def take(err):
    """(stderr without the markers, [the marker objects])"""
    keep, got = [], []
    for l in err.splitlines(keepends=True):
        if l.startswith(MARK):
            try: got.append(json.loads(l[len(MARK):]))
            except ValueError: pass
        else: keep.append(l)
    return ''.join(keep), got
