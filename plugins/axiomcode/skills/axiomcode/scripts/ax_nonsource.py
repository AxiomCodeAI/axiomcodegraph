"""ax_nonsource.py — the text files the index does not read as source, and where a name is written in them, without
opening every one of them on every query.

`impact` looks for the changed name in files the compiler never sees (a mapper XML, a services file, a properties file,
a build script, a spec), because a rename breaks those at run time. It used to find them by walking the tree and
OPENING every candidate file twice per query: once to tell text from binary, once to search it. On this repository that
is ~2,100 files and 0.6 s of every impact query; on a machine whose antivirus scans each open, or on a busy one, the
opens are what the query waits on, and they are the same files every time.

So the scan is kept per graph in <graph>/out/dl/nonsource.sqlite:

  files(rel, size, mtime_ns, kind)   what each candidate file was when it was last read: kind 0 text, 1 binary
  tok(tok, rel)                      the words written in each text file: every maximal run of [\\w.$-] characters,
                                     and each of its prefixes that ends before a '.'

A query still walks the tree (so a new or deleted file is seen at once) and stats every candidate, but opens only a file
whose size or mtime moved since it was read, and searches only the files whose words include a name asked for. A name
can match only at the start of such a run (the search requires no [\\w.$-] before it) and must end where the run ends or
at a '.', which is exactly the set stored, so the files skipped are files the search could not have matched: the answer
is the one the full scan gives. A file modified in the last two seconds is not cached (its mtime may not have ticked
yet); a name with a character outside [\\w.$-] falls back to searching every file; any error with the cache falls back to
the full scan.
"""
import os, re, sqlite3, time

VERSION = '2'
WORD = re.compile(r'[\w.$-]+')
NAME_OK = re.compile(r'[\w.$-]+')
MAX_SIZE = 512 * 1024
CAP = 4000
RACY = 2.0


def words(text):
    """every run of [\\w.$-] and each of its prefixes that ends before a '.': where a whole-token name can match"""
    out = set()
    for m in WORD.finditer(text):
        r = m.group(0); out.add(r)
        i = r.find('.', 1)
        while i > 0:
            out.add(r[:i]); i = r.find('.', i + 1)
    return out


def _classify(fp):
    """0 text, 1 binary, None unreadable -- the same test the full scan applies (a NUL byte in the first 2 KB)"""
    try:
        with open(fp, 'rb') as fh: head = fh.read(2048)
    except OSError: return None
    return 1 if b'\0' in head else 0


# ── which name matches are noise ─────────────────────────────────────────────────────────────────────────
# Two rules, applied to every hit before anyone sees it (impact's "bound from outside the source", context's text
# bindings):
#
#   OUT OF SCOPE. A shell script or a Datalog file is never analysed, so a name matched inside one is noise by rule:
#   `hits` for a method `hits` was 21 rows, most of them CI scripts and rule comments. An extensionless script is
#   one by its first line (`mvnw`, `gradlew`: `#!/bin/sh`).
#
#   PROSE. A name that is a plain English word (`note`, `export`, `build`, `validate`: lowercase letters only, no `_`
#   and no case boundary) is written as a word in templates, YAML, CI files and comments far more often than as a
#   binding: 261 rows for one Django view, 71 for `note`, a Maven `<phase>validate</phase>` for a Java `validate`.
#   Such a match is kept as a binding only where the line writes it the way code or configuration refers to a
#   callable: called (`note(`), quoted as a value (`"note"`, `'note'`), or qualified with `#`, `::` or `->`
#   (`Owner#note`; a CSS `#note` selector is not one). A dotted `Owner.note` is matched as the qualified name itself and never reaches this rule. The
#   rest are PROSE: counted and grep-able, not listed as places a rename breaks.
OUT_OF_SCOPE_EXT = {'.sh', '.bash', '.zsh', '.ksh', '.dl'}
SHELL_SHEBANG = re.compile(r'#!\s*\S*(?:/|\s)(?:env\s+)?(?:ba|z|k|da)?sh\b')
COMMON = re.compile(r'[a-z]+')
_QUOTES = '"\'`'
QUALIFIER = re.compile(r'[\w$)\]>](?:#|::|->)$')      # `Owner#note`, `Owner::note`, `$obj->note`; not a CSS `#note` selector


def out_of_scope(rel, text):
    """a shell script or a Datalog file: a name matched there is never a binding (owner's rule)"""
    if os.path.splitext(rel)[1].lower() in OUT_OF_SCOPE_EXT: return True
    return not os.path.splitext(rel)[1] and bool(SHELL_SHEBANG.match(text[:120]))


def is_common(name):
    """a plain word: the names whose bare mentions are mostly prose"""
    return bool(COMMON.fullmatch(name or ''))


def code_shaped(line, start, end):
    """the match line[start:end] is written as a reference: called, quoted as a whole value, or #/::/-> qualified"""
    before, after = line[:start], line[end:]
    if after.lstrip().startswith('('): return True
    if before[-1:] and before[-1] in _QUOTES and after[:1] == before[-1]: return True
    return bool(QUALIFIER.search(before))


MAPPER_NS = re.compile(r'<mapper\b[^>]*?\bnamespace\s*=\s*["\']([^"\']+)["\']', re.S)


def mapper_namespace(repo, rel):
    """the `<mapper namespace="...">` of a MyBatis mapper XML, or None for any other file. A statement id written in
    it is resolved inside that namespace, so it binds only the methods of the type the namespace names (#1381)."""
    if not rel.lower().endswith('.xml'): return None
    try:
        with open(os.path.join(repo, rel), errors='replace') as fh: head = fh.read(8192)
    except OSError: return None
    m = MAPPER_NS.search(head)
    return m.group(1).strip() if m else None


# ── the elements of a MyBatis mapper XML, by id ──────────────────────────────────────────────────────────────
# A statement (`<select|insert|update|delete id="m">`) under `<mapper namespace="a.b.Mapper">` IS the body of
# a.b.Mapper.m: MyBatis binds the two by namespace plus id, and an edit to the SQL changes what the method does as
# surely as an edit to a Java body. A `<sql id>` fragment is part of every statement that `<include refid>`s it, and a
# `<resultMap id>` of every statement that names it in `resultMap=`, so an edit there is an edit to those statements.
STATEMENT_TAGS = ('select', 'insert', 'update', 'delete')
_ELEM_OPEN = re.compile(r'<(select|insert|update|delete|sql|resultMap)\b([^>]*?)(/?)>', re.S)
_ELEM_ID = re.compile(r'(?<![\w-])id\s*=\s*["\']([^"\']+)["\']')
_INCLUDE = re.compile(r'<include\b[^>]*?\brefid\s*=\s*["\']([^"\']+)["\']', re.S)
_RESULT_MAP = re.compile(r'(?<![\w-])resultMap\s*=\s*["\']([^"\']+)["\']')


def mapper_namespace_of(text):
    """the namespace a mapper XML's own text declares, or None"""
    m = MAPPER_NS.search(text or '')
    return m.group(1).strip() if m else None


def mapper_elements(text):
    """[(tag, id, first_line, last_line, open_tag_text, body_text)] for every statement, <sql> fragment and <resultMap>
    of a mapper XML's text, lines 1-based. An element with no id, or with no closing tag, is left out."""
    out = []
    for m in _ELEM_OPEN.finditer(text or ''):
        idm = _ELEM_ID.search(m.group(2))
        if not idm: continue
        tag = m.group(1)
        if m.group(3): end = m.end()
        else:
            close = text.find(f'</{tag}>', m.end())
            if close < 0: continue
            end = close + len(tag) + 3
        first = text.count('\n', 0, m.start()) + 1
        last = text.count('\n', 0, end) + 1
        out.append((tag, idm.group(1), first, last, m.group(0), text[m.end():end]))
    return out


def _local_id(ref, ns):
    """a refid / resultMap written as `ns.id` or as `id` inside namespace ns, as the id in that namespace; None for another namespace's"""
    if ns and ref.startswith(ns + '.'): return ref[len(ns) + 1:]
    return None if '.' in ref else ref


def mapper_statement_ids(elems, ns, ids):
    """the STATEMENT ids that `ids` (any element ids: statements, fragments, result maps) are part of, each with the
    element it came through: {statement id: via id or None}"""
    stmts = [e for e in elems if e[0] in STATEMENT_TAGS]
    out = {i: None for i in ids if any(s[1] == i for s in stmts)}
    frags = {i for i in ids if any(e[1] == i and e[0] == 'sql' for e in elems)}
    # a fragment can include another fragment: whatever includes it includes the one it includes
    grew = True
    while grew:
        grew = False
        for e in elems:
            if e[0] == 'sql' and e[1] not in frags and any(_local_id(r, ns) in frags for r in _INCLUDE.findall(e[5])):
                frags.add(e[1]); grew = True
    maps = {i for i in ids if any(e[1] == i and e[0] == 'resultMap' for e in elems)}
    for s in stmts:
        if s[1] in out: continue
        inc = [x for x in (_local_id(r, ns) for r in _INCLUDE.findall(s[5])) if x in frags]
        rm = [x for x in (_local_id(r, ns) for r in _RESULT_MAP.findall(s[4])) if x in maps]
        if inc or rm: out[s[1]] = (inc or rm)[0]
    return out


def mapper_edits(old, new):
    """what an edit of a mapper XML's text changed: (namespace, {statement id: (line, how, via)}, unplaced) where line is
    the statement's first line in the new text (the old one for a statement the edit removed), how is 'changed',
    'added' or 'removed', via the fragment or result map the edit was in (None for the statement itself), and unplaced
    the number of edited lines that fall in no element with an id (the header, the namespace, a comment between
    elements). (None, {}, 0) for a text that is not a mapper."""
    import difflib
    ns = mapper_namespace_of(new) or mapper_namespace_of(old)
    if not ns: return None, {}, 0
    ol, nl = (old or '').split('\n'), (new or '').split('\n')
    oe, ne = mapper_elements(old or ''), mapper_elements(new or '')
    touched_o, touched_n = set(), set()
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(None, ol, nl, autojunk=False).get_opcodes():
        if op == 'equal': continue
        touched_o.update(range(i1 + 1, i2 + 1)); touched_n.update(range(j1 + 1, j2 + 1))
    def hit(elems, lines):
        ids, placed = set(), set()
        for e in elems:
            inside = {x for x in lines if e[2] <= x <= e[3]}
            if inside: ids.add(e[1]); placed |= inside
        return ids, placed
    ids_o, placed_o = hit(oe, touched_o); ids_n, placed_n = hit(ne, touched_n)
    unplaced = len(touched_n - placed_n) + len(touched_o - placed_o) if new.strip() else 0
    out = {}
    first_n = {e[1]: e[2] for e in ne if e[0] in STATEMENT_TAGS}
    first_o = {e[1]: e[2] for e in oe if e[0] in STATEMENT_TAGS}
    for sid, via in mapper_statement_ids(ne, ns, ids_n).items():
        out[sid] = (first_n[sid], 'changed' if sid in first_o else 'added', via)
    for sid, via in mapper_statement_ids(oe, ns, ids_o).items():
        if sid in out: continue
        out[sid] = (first_n[sid], 'changed', via) if sid in first_n else (first_o[sid], 'removed', via)
    return ns, out, unplaced


def mapper_methods(q, ns, sid):
    """the method ids a statement `sid` under `<mapper namespace="ns">` is the SQL of: the type the namespace names
    declares one of that name, or inherits it from a base mapper; a type the graph does not hold binds nothing.
    `q(sql, *params)` answers from graph.sqlite."""
    tids = [r[0] for r in q("SELECT id FROM types WHERE REPLACE(qualified_name, '$', '.') = ?", ns.replace('$', '.'))]
    if not tids: return []
    ph = ','.join('?' * len(tids))
    own = q(f"SELECT id FROM methods WHERE name = ? AND owner_type_id IN ({ph})", sid, *tids)
    if not own:
        anc = [r[0] for r in q(f"SELECT ancestor_type_id FROM type_ancestors WHERE type_id IN ({ph})", *tids)]
        own = q(f"SELECT id FROM methods WHERE name = ? AND owner_type_id IN ({','.join('?' * len(anc))})", sid, *anc) if anc else []
    return sorted({r[0] for r in own})


def statement_at(text, line):
    """(tag, id) of the statement element whose opening tag is written on `line` of a mapper XML's text, or None"""
    for e in mapper_elements(text):
        if e[0] in STATEMENT_TAGS and e[2] <= line <= e[2] + e[4].count('\n'): return e[0], e[1]
    return None


class NonSource:
    def __init__(self, repo, cache_dir, indexed, skip_dir, skip_ext):
        self.repo, self.cache_dir, self.indexed, self.skip_dir, self.skip_ext = repo, cache_dir, indexed, skip_dir, skip_ext
        self._files = None; self._uncached = set(); self.con = None
        self.prose = set()      # (name, rel, line) hits of a common word with no reference syntax around it (see PROSE)
        if cache_dir and not os.environ.get('AXIOMCODE_NO_SCAN_CACHE'):
            try:
                os.makedirs(cache_dir, exist_ok=True)
                self.con = sqlite3.connect(os.path.join(cache_dir, 'nonsource.sqlite'), timeout=5)
                self.con.executescript("""CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
                    CREATE TABLE IF NOT EXISTS files(id INTEGER PRIMARY KEY, rel TEXT UNIQUE, size INTEGER, mtime INTEGER, kind INTEGER);
                    CREATE TABLE IF NOT EXISTS tok(tok TEXT, fid INTEGER, PRIMARY KEY (tok, fid)) WITHOUT ROWID;""")
                v = self.con.execute("SELECT value FROM meta WHERE key = 'version'").fetchone()
                if not v or v[0] != VERSION:
                    with self.con:
                        self.con.execute("DELETE FROM files"); self.con.execute("DELETE FROM tok")
                        self.con.execute("INSERT OR REPLACE INTO meta VALUES ('version', ?)", (VERSION,))
            except sqlite3.Error:
                self.con = None

    def files(self):
        """every text file in the tree that is NOT source the index read, sorted (Impact.nonsource_files)"""
        if self._files is not None: return self._files
        try:
            if self.con is not None: return self._files_cached()
        except (sqlite3.Error, OSError):
            self.con = None
        self._files = self._files_full(); return self._files

    def _files_full(self):
        out = []
        for root, dirs, files in os.walk(self.repo):
            dirs[:] = [d for d in dirs if d not in self.skip_dir and not d.startswith('.axiomcode')]
            for fn in files:
                ext = os.path.splitext(fn)[1].lower()
                if ext in self.skip_ext: continue
                fp = os.path.join(root, fn)
                if os.path.relpath(fp, self.repo).replace(os.sep, '/') in self.indexed: continue
                try:
                    if os.path.getsize(fp) > MAX_SIZE: continue
                    with open(fp, 'rb') as fh: head = fh.read(2048)
                    if b'\0' in head: continue
                except OSError: continue
                out.append(os.path.relpath(fp, self.repo).replace(os.sep, '/'))
                if len(out) > CAP: break
        self._uncached = set(out)
        return sorted(out)

    def _files_cached(self):
        known = {r[0]: (r[1], r[2], r[3], r[4]) for r in self.con.execute("SELECT rel, size, mtime, kind, id FROM files")}
        out, seen, put, now = [], set(), [], time.time()
        for root, dirs, files in os.walk(self.repo):
            dirs[:] = [d for d in dirs if d not in self.skip_dir and not d.startswith('.axiomcode')]
            for fn in files:
                ext = os.path.splitext(fn)[1].lower()
                if ext in self.skip_ext: continue
                fp = os.path.join(root, fn)
                rel = os.path.relpath(fp, self.repo).replace(os.sep, '/')
                if rel in self.indexed: continue
                try: st = os.stat(fp)
                except OSError: continue
                if st.st_size > MAX_SIZE: continue
                seen.add(rel)
                k = known.get(rel)
                if k and k[0] == st.st_size and k[1] == st.st_mtime_ns: kind = k[2]
                else:
                    kind = _classify(fp)
                    if kind is None: continue
                    if now - st.st_mtime < RACY: self._uncached.add(rel)
                    else:
                        text = None
                        if kind == 0:
                            try: text = open(fp, errors='replace').read()
                            except OSError: continue
                        put.append((rel, st.st_size, st.st_mtime_ns, kind, text))
                if kind: continue
                out.append(rel)
                if len(out) > CAP: break
        with self.con:
            stale = [known[r][3] for r in known if r not in seen] + [known[p[0]][3] for p in put if p[0] in known]
            for fid in stale:
                self.con.execute("DELETE FROM files WHERE id = ?", (fid,)); self.con.execute("DELETE FROM tok WHERE fid = ?", (fid,))
            for rel, size, mt, kind, text in put:
                fid = self.con.execute("INSERT INTO files(rel, size, mtime, kind) VALUES (?, ?, ?, ?)", (rel, size, mt, kind)).lastrowid
                if text is not None: self.con.executemany("INSERT INTO tok VALUES (?, ?)", ((w, fid) for w in words(text)))
        self._files = sorted(out); return self._files

    def hits(self, names):
        """-> [(name, file, line)] where one of `names` is written as a whole token in a non-source file"""
        names = sorted({n for n in names if n and len(n) > 2}, key=len, reverse=True)
        if not names: return []
        pat = re.compile(r'(?<![\w.$-])(' + '|'.join(re.escape(n) for n in names) + r')(?![\w$-])')
        files = self.files()
        only = None
        if self.con is not None and all(NAME_OK.fullmatch(n) for n in names):
            try:
                only = {r[0] for r in self.con.execute(
                    f"SELECT DISTINCT f.rel FROM tok t JOIN files f ON f.id = t.fid WHERE t.tok IN ({','.join('?' * len(names))})", names)} | self._uncached
            except sqlite3.Error:
                only = None
        hits = []
        for rel in files:
            if only is not None and rel not in only: continue
            try: text = open(os.path.join(self.repo, rel), errors='replace').read()
            except OSError: continue
            if not any(n in text for n in names) or out_of_scope(rel, text): continue
            for i, line in enumerate(text.split('\n'), 1):
                shaped = {}
                for m in pat.finditer(line):
                    n = m.group(1); hits.append((n, rel, i))
                    shaped[n] = shaped.get(n, False) or not is_common(n) or code_shaped(line, m.start(1), m.end(1))
                self.prose.update((n, rel, i) for n, ok in shaped.items() if not ok)
                if len(hits) > 2000: break
        return hits
