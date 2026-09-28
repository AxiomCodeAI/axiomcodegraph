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
