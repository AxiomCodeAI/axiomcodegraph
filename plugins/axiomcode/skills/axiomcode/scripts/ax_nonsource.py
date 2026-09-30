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
#
#   LOCKFILES AND MANIFEST LISTS. A lockfile is written by a package manager, never by hand, and every word in it is a
#   package name, a version or a flag: `"optional": true`, `"debug": "^4.1.0"`. A manifest's metadata (name,
#   description, keywords) and its dependency lists are the same: they name packages, not callables. A method named
#   `debug`, `optional` or `string` matched there is a package or a word, never a binding, and in a JavaScript
#   repository it outnumbered every real one (a context question's next step became a line of package-lock.json).
#   The rest of a manifest (scripts, tasks, tool configuration) is kept: that is where a name can be referred to. A
#   JSON manifest's KEYS are not: `"start":` names an npm script and `"testEnvironment":` an option, so only the values
#   are searched. What is skipped is decided by where the word sits in the file's structure (the entry, table, block or
#   element that holds it), not by the line alone: a one-line manifest holds its scripts and its dependencies together.
OUT_OF_SCOPE_EXT = {'.sh', '.bash', '.zsh', '.ksh', '.dl', '.lock', '.lockfile'}
SHELL_SHEBANG = re.compile(r'#!\s*\S*(?:/|\s)(?:env\s+)?(?:ba|z|k|da)?sh\b')
LOCKFILES = {'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lock', 'deno.lock',
             'packages.lock.json', 'project.assets.json', 'paket.lock', 'gradle.lockfile', 'poetry.lock', 'uv.lock',
             'pipfile.lock', 'pdm.lock', 'conda-lock.yml', 'composer.lock', 'gemfile.lock', 'cargo.lock', 'go.sum'}
# JSON manifests: the top-level keys that describe the package or list other packages
_JSON_META = r'name|version|description|keywords|authors?|contributors|maintainers|license|homepage|repository|bugs|funding|private'
JSON_LIST_KEY = {
    'package.json': re.compile(r'(?i)^(' + _JSON_META + r'|type|engines|os|cpu|publishConfig|workspaces|packageManager|'
                               r'overrides|resolutions|pnpm|\w*dependencies(Meta)?)$'),
    'bower.json': re.compile(r'(?i)^(' + _JSON_META + r'|ignore|resolutions|\w*dependencies)$'),
    'deno.json': re.compile(r'^(name|version|imports|scopes|importMap|lock|nodeModulesDir|vendor|workspace|patch|links)$'),
    'composer.json': re.compile(r'(?i)^(' + _JSON_META + r'|type|support|require(-dev)?|conflict|replace|provide|suggest|'
                                r'repositories|minimum-stability|prefer-stable)$')}
JSON_LIST_KEY['deno.jsonc'] = JSON_LIST_KEY['deno.json']
# YAML manifests: the top-level blocks that list packages (a conda environment, a pnpm workspace and its catalog)
YAML_LIST_KEY = {
    'environment.yml': re.compile(r'^(name|channels|dependencies|prefix)$'),
    'pnpm-workspace.yaml': re.compile(r'^(packages|catalogs?|overrides|patchedDependencies|\w*BuiltDependencies|'
                                      r'peerDependencyRules|allowedDeprecatedVersions|packageExtensions)$')}
YAML_LIST_KEY['environment.yaml'] = YAML_LIST_KEY['environment.yml']
# TOML manifests: the tables and keys that list packages
PY_DEP_TABLE = re.compile(r'^\[\s*(dependency-groups|project\.optional-dependencies|tool\.poetry(\.group\.[^\]]+)?\.(dev-)?dependencies|'
                          r'tool\.pdm\.dev-dependencies|tool\.uv)\s*\]')
PIPFILE_TABLE = re.compile(r'^\[\s*(packages|dev-packages|requires|source|[\w-]+-packages)\s*\]')
PY_DEP_KEY = re.compile(r'^\s*(dependencies|requires|dev-dependencies|optional-dependencies)\s*=')
# a file that is nothing but a list of packages
REQUIREMENTS = re.compile(r'^(requirements|constraints)[\w.-]*\.(txt|in)$')
# XML manifests: the elements that name a package (MSBuild, packages.config, .nuspec) and a POM's dependency blocks
XML_PKG_LINE = re.compile(r'<\s*(PackageReference|PackageVersion|package|dependency)\b[^>]*\b(Include|Update|id)\s*=')
POM_BLOCK = re.compile(r'<(/?)(dependencies|dependencyManagement|parent|exclusions)>')
POM_COORD = re.compile(r'^\s*<(groupId|artifactId|version|packaging|name|description|url|scope|type|classifier|optional|'
                       r'modelVersion|id|tags|authors|owners)>[^<]*</\1>\s*$')


def is_lockfile(rel):
    """a file a package manager writes: every word in it is a package, a version or a flag"""
    return os.path.basename(rel).lower() in LOCKFILES


def _json_spans(text, list_key):
    """{line: [(start col, end col)]} of the strings a word is not matched in: each string under a top-level key that
    `list_key` matches, and each key at any depth. A string-aware scan, so a minified manifest is split by entry too."""
    out, depth, want_key, listed, line, bol, i, n = {}, 0, False, False, 1, 0, 0, len(text)
    while i < n:
        c = text[i]
        if c == '"':
            j = i + 1
            while j < n and text[j] != '"': j += 2 if text[j] == '\\' else 1
            k = j + 1
            while k < n and text[k] in ' \t\r\n': k += 1
            if depth == 1 and want_key: want_key, listed = False, bool(list_key.match(text[i + 1:j]))
            if (k < n and text[k] == ":") or (depth >= 1 and listed):
                out.setdefault(line, []).append((i - bol, j + 1 - bol))
            nl = text.count('\n', i, j)
            if nl: line += nl; bol = text.rindex('\n', i, j) + 1
            i = j + 1
            continue
        if text.startswith('//', i):                    # a JSONC comment (deno.jsonc)
            j = text.find('\n', i); i = n if j < 0 else j
            continue
        if c in '{[':
            depth += 1
            if depth == 1: want_key = c == '{'
        elif c in '}]': depth -= 1
        elif c == ',' and depth == 1: want_key = True
        elif c == '\n': line += 1; bol = i + 1
        i += 1
    return out


def _unquoted(s):
    """a TOML line without its strings and its comment: what is left are the brackets that open and close a list"""
    return re.sub(r'"(?:\\.|[^"\\])*"|\'[^\']*\'', '""', s).split('#', 1)[0]


def _toml_lines(text, table, key=None):
    """the lines inside a table `table` matches, and those of a `key = [ ... ]` list outside one"""
    out, in_table, open_brackets = set(), False, 0
    for i, ln in enumerate(text.split('\n'), 1):
        if open_brackets > 0:                          # inside a `dependencies = [ ... ]` spread over lines
            out.add(i); s = _unquoted(ln); open_brackets += s.count('[') - s.count(']'); continue
        if ln.lstrip().startswith('['): in_table = bool(table.match(ln.strip())); continue
        if in_table: out.add(i); continue
        if key and key.match(ln):
            out.add(i); s = _unquoted(ln); open_brackets = s.count('[') - s.count(']')
    return out


def _yaml_lines(text, block):
    """the lines of the top-level YAML blocks `block` matches: the key's line and every indented or list line under it"""
    out, inside = set(), False
    for i, ln in enumerate(text.split('\n'), 1):
        m = re.match(r'([\w.-]+)\s*:', ln)
        if m: inside = bool(block.match(m.group(1)))
        elif ln[:1] not in ('', ' ', '\t', '-', '#'): inside = False
        if inside: out.add(i)
    return out


def _xml_lines(base, text):
    """the lines of an XML manifest that name a package: a POM's dependency blocks and coordinates, a NuGet element"""
    lines, out, depth = text.split('\n'), set(), 0
    for i, ln in enumerate(lines, 1):
        if base == 'pom.xml':
            opened = depth > 0
            for m in POM_BLOCK.finditer(ln): depth += -1 if m.group(1) else 1
            if opened or depth > 0 or POM_COORD.match(ln): out.add(i)
        elif XML_PKG_LINE.search(ln) or (base.endswith('.nuspec') and POM_COORD.match(ln)): out.add(i)
    return out


def manifest_skip(rel, text):
    """-> skip(line, col): True where a word written there sits in a lockfile, a manifest's metadata or one of its
    dependency lists (see LOCKFILES AND MANIFEST LISTS); None for any other file"""
    base = os.path.basename(rel).lower()
    if is_lockfile(rel) or REQUIREMENTS.match(base): return lambda _l, _c: True
    if base in JSON_LIST_KEY:
        spans = _json_spans(text, JSON_LIST_KEY[base])
        return lambda l, c: any(a <= c < b for a, b in spans.get(l, ()))
    if base in YAML_LIST_KEY: lines = _yaml_lines(text, YAML_LIST_KEY[base])
    elif base == 'pyproject.toml': lines = _toml_lines(text, PY_DEP_TABLE, PY_DEP_KEY)
    elif base == 'pipfile': lines = _toml_lines(text, PIPFILE_TABLE)
    elif base in ('pom.xml', 'packages.config') or base.endswith(('.csproj', '.fsproj', '.vbproj', '.props', '.targets', '.nuspec')):
        lines = _xml_lines(base, text)
    else: return None
    return lambda l, _c: l in lines
COMMON = re.compile(r'[a-z]+')
_QUOTES = '"\'`'
QUALIFIER = re.compile(r'[\w$)\]>](?:#|::|->)$')      # `Owner#note`, `Owner::note`, `$obj->note`; not a CSS `#note` selector


def out_of_scope(rel, text):
    """a shell script, a Datalog file or a lockfile: a name matched there is never a binding (owner's rule)"""
    if os.path.splitext(rel)[1].lower() in OUT_OF_SCOPE_EXT or is_lockfile(rel): return True
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
            skip = manifest_skip(rel, text)
            for i, line in enumerate(text.split('\n'), 1):
                shaped = {}
                for m in pat.finditer(line):
                    if skip and skip(i, m.start(1)): continue
                    n = m.group(1); hits.append((n, rel, i))
                    shaped[n] = shaped.get(n, False) or not is_common(n) or code_shaped(line, m.start(1), m.end(1))
                self.prose.update((n, rel, i) for n, ok in shaped.items() if not ok)
                if len(hits) > 2000: break
        return hits
