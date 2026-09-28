#!/usr/bin/env python3
"""ax_fresh.py — keep the graph current without anyone running `axiomcode index` (#1305).

The graph is one whole-program solve, so an edit cannot be patched into it file by file: the incremental
part is knowing WHAT changed, cheaply, and rebuilding in the background while every verb keeps reading
the previous graph. Three pieces:

  the file table   every file the language's parser reads (sources and the config it resolves from) with
                   size, mtime and a content hash, recorded by axiomcode-build BEFORE the parser reads
                   anything. Fresh = the same file set, and every stat equal or, where it is not, the hash.
                   No git needed; a checkout, a pull or a rebase shows up like any other edit.
  the worker       one per repository, detached, single-flight under a lock the OS drops if it dies. It
                   waits out a burst of edits, rebuilds with the language / --src / --library of the graph
                   it replaces, and checks again: an edit made DURING the build is caught by the next pass.
  the triggers     hooks (after an edit, a shell command, a turn, at session start, on a prompt) only START
                   the worker and return. Query verbs start it and answer from the previous graph at once, with
                   every row that lies in a file changed since marked (`query`); they wait only when the answer
                   touches such a file and the refresh is expected within a small budget, or when asked (--fresh).

  ax_fresh.py snapshot <repo> <lang> <src>     print the file table (JSON) — axiomcode-build stores it
  ax_fresh.py status <repo> [--json]           fresh | stale (+ the changed files) | building | no graph
  ax_fresh.py kick <repo>                      start the worker if the graph is stale; never waits
  ax_fresh.py wait <repo> [<seconds>]          kick, then wait up to <seconds> for a fresh graph
  ax_fresh.py query <repo> <verb> -- <argv>    run a query verb stale-while-revalidate: marked rows, a wait only when
                                               it matters (#1595)
  ax_fresh.py baseline <repo> [<seconds>]      when HEAD moved, wait for the baseline to follow it (changed, test-impact)
  ax_fresh.py worker <repo>                    the worker itself (what kick detaches)
  ax_fresh.py lock <fd>                        take the build lock on an fd the calling shell holds open
  ax_fresh.py count <dir>                      the source files of each language, walked as the parser walks

Environment: AXIOMCODE_NO_REFRESH=1 turns every trigger off; AXIOMCODE_REFRESH_DEBOUNCE (seconds, default 2)
is the quiet window; AXIOMCODE_FRESH_WAIT (seconds, default 30) is the most a query whose answer touches an edited file
waits for a refresh expected to finish within it, AXIOMCODE_FRESH=1 (--fresh) makes it wait for the refresh whatever it
takes, up to AXIOMCODE_FRESH_MAX (default 600); AXIOMCODE_BUILD_WAIT
(seconds, default 900) is how long a query that finds no graph waits for a build that is running rather than starting
its own; AXIOMCODE_NO_GITIGNORE=1 watches (and indexes) directories git ignores."""
import re, errno, hashlib, json, os, subprocess, sys, time

H = os.path.dirname(os.path.abspath(__file__))

# what each language's parser reads: extensions, and file names read whatever their extension. Mirrors
# parser/src/extract.ts: Java also reads .properties / XML / YAML / Gradle / lombok.config and
# META-INF/services; TypeScript reads JavaScript beside it and resolves through tsconfig and package.json.
EXT = {
    'java': ('.java', '.properties', '.xml', '.yml', '.yaml', '.gradle', '.kts', '.toml'),
    'typescript': ('.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'),
    'javascript': ('.js', '.jsx', '.mjs', '.cjs'),
    'python': ('.py', '.pyi'),
    'csharp': ('.cs', '.csproj', '.props', '.targets', '.sln'),
}
# the SOURCE files of each language: what makes a repository "have" that language (axiomcode-build counts the same)
SOURCE = {'java': ('.java',), 'typescript': ('.ts', '.tsx'), 'python': ('.py',), 'javascript': ('.js', '.mjs', '.cjs', '.jsx'), 'csharp': ('.cs',)}
NAMES = {
    'java': ('lombok.config',),
    'typescript': ('package.json',),
    'javascript': ('package.json',),
    'python': ('pyproject.toml', 'setup.cfg', 'setup.py'),
    'csharp': ('global.json', 'Directory.Build.props'),
}
# TOOL OUTPUT NOBODY PARSES: what the non-source scan of `impact` (axiomcode-impact) leaves out. NOT what the file table
# prunes: that is SKIP below, per language.
PRUNE_ALL = {'.git', '.hg', '.svn', '.axiomcode', 'node_modules', 'bower_components', 'dist', 'build', 'out',
             'coverage', '.next', '.nuxt', '.turbo', '.cache', '.yarn', '.venv', 'venv', 'site-packages',
             '__pycache__', '.tox', '.mypy_cache', '.pytest_cache', 'target', '.gradle', '.idea', '.vs'}
# WHAT EACH LANGUAGE'S PARSER SKIPS, and nothing more (#1594). The file table watches exactly the files the parser
# reads: a directory pruned here that the parser DOES read is an edit no refresh ever sees and that `index` calls up to
# date, which is what one shared list did to `out`, `build`, `target` and `coverage` in Python and C# (and `coverage`
# in Java). A directory watched here that the parser skips costs only a needless rebuild. Each set is the parser's own:
#   java        parser/src/constants/consts.ts EXCLUDED_DIRS, and every directory whose name starts with a dot
#   typescript  parser/src/constants/typescript-constants.ts TS_SKIP_DIRECTORIES, and dot directories
#   javascript  parser/src/constants/javascript-constants.ts JS_SKIP_DIRECTORIES
#   python      parser/src/workflows/python/python-project-analyzer.ts DEFAULT_EXCLUDES, `*.egg-info`, and under a
#               `build` directory the setuptools output shapes (BUILD_ARTIFACT_SHAPE); a `build` package itself is read
#   csharp      parser/src/workflows/csharp/csharp-project-analyzer.ts DEFAULT_EXCLUDES
# .axiomcode (the graph's own directory) and .git are pruned for every language: the build puts .axiomcode in
# .git/info/exclude, so the parser skips it too. Directories git ignores are pruned for every language (git_ignored_dirs).
SKIP = {
    'java': frozenset({'node_modules', '.git', '.idea', '.vscode', 'dist', 'build', 'target', 'out', '__pycache__',
                       '.pytest_cache', 'venv', 'env'}),
    'typescript': frozenset({'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt', '.turbo',
                             '.cache', '.yarn', 'bower_components'}),
    'javascript': frozenset({'node_modules', 'bower_components', '.git', 'dist', 'build', 'out', 'coverage', '.next',
                             '.nuxt', '.turbo', '.cache', '.yarn'}),
    'python': frozenset({'__pycache__', '.git', 'node_modules', '.venv', 'venv', '.tox', 'dist', '.eggs', '.mypy_cache',
                         '.pytest_cache', '_build', 'site-packages'}),
    'csharp': frozenset({'obj', 'bin', '.git', 'node_modules', 'packages', '.vs'}),
}
SKIP_HIDDEN = {'java', 'typescript'}                     # the parsers that skip every directory named .<something>
ALWAYS = frozenset({'.axiomcode', '.git'})
PY_BUILD_ARTIFACT = re.compile(r'^(lib(\.|$)|temp\.|scripts-|bdist\.)')

def prunes(lang, name, parent=''):
    """True when the parser of `lang` never enters a directory called `name` (whose parent directory is `parent`)"""
    if name in ALWAYS: return True
    if lang not in SKIP: return name in PRUNE_ALL
    if name in SKIP[lang] or (lang in SKIP_HIDDEN and name.startswith('.')): return True
    if lang == 'python': return name.endswith('.egg-info') or (parent == 'build' and bool(PY_BUILD_ARTIFACT.match(name)))
    return False

# A BUILD'S OUTPUT (#1545). The JavaScript and TypeScript parsers also skip a directory a build wrote, recognised by what
# owns it and never by its name: Maven's `target` beside a pom.xml, a javadoc output directory (index.html with
# element-list or package-list) and a Dokka one (index.html with navigation.html and scripts/sourceset_dependencies.js),
# wherever they sit (parser/src/utils/generated-output.ts). Their SKIP sets above carry no `target`, as the parser's
# lists carry none, so a directory merely named target stays watched (#531); this adds the anchored ones.
WEB = frozenset({'javascript', 'typescript'})

def generated_output(parent, name):
    """True when `parent`/`name` is a directory a build wrote, whose JavaScript and TypeScript are not the project's"""
    if name == 'target' and os.path.isfile(os.path.join(parent, 'pom.xml')): return True
    d = os.path.join(parent, name)
    if not os.path.isfile(os.path.join(d, 'index.html')): return False
    return os.path.isfile(os.path.join(d, 'element-list')) or os.path.isfile(os.path.join(d, 'package-list')) or \
        (os.path.isfile(os.path.join(d, 'navigation.html')) and os.path.isfile(os.path.join(d, 'scripts', 'sourceset_dependencies.js')))

def out_dir(repo): return os.path.join(repo, '.axiomcode', 'out')
def table_path(repo): return os.path.join(out_dir(repo), 'files.json')
def state_path(repo): return os.path.join(repo, '.axiomcode', 'refresh.json')

PY_SHEBANG = re.compile(r'#![^\n]*\bpython[0-9.]*\b')

def python_script(p, name=None):
    """an executable Python script with no extension: its first line is a python shebang. The parser analyses it as a
    module (#1376), so it is watched and counted like a .py file"""
    if '.' in (name or os.path.basename(p)): return False
    try:
        with open(p, 'rb') as fh: head = fh.read(128)
    except OSError: return False
    return bool(PY_SHEBANG.match(head.decode('utf-8', 'replace')))

_IGNORED = {}

def git_ignored_dirs(root):
    """the directories under root that git ignores (.gitignore, .git/info/exclude, the global excludes file), as
    absolute paths. The parser skips them too (parser/src/utils/git-ignored.ts, the same git command), so a generated
    tree that only .gitignore names — a framework's build cache, a vendored bundle — is neither parsed nor watched:
    a whole-repository index read 15,108 files of a 431-file project, and every write into such a tree cost a rebuild.
    A directory holding a tracked file is not listed (git lists it only when all of it is ignored), so a file
    committed on purpose under an ignored name is still read. Empty outside a work tree, or with
    AXIOMCODE_NO_GITIGNORE=1."""
    root = os.path.realpath(root)
    if root in _IGNORED: return _IGNORED[root]
    out = set()
    if not os.environ.get('AXIOMCODE_NO_GITIGNORE'):
        try:
            r = subprocess.run(['git', '-C', root, 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z', '--', '.'],
                               capture_output=True, timeout=60)
            if r.returncode == 0:
                for e in r.stdout.decode('utf-8', 'replace').split('\0'):
                    if e.endswith('/'): out.add(os.path.normpath(os.path.join(root, e)))
        except (OSError, subprocess.SubprocessError): pass
    _IGNORED[root] = out
    return out

def watched(root, lang):
    """every file the parser of `lang` reads under root; `lang` may be a comma list (a repository in several
    languages, each with its own graph), and a file two of them read is yielded once"""
    # ONE WALK FOR EVERY LANGUAGE. A repository in five languages was walked five times on every freshness check, that is
    # before every query; the tree is walked once now, a directory only one language prunes (C#'s obj/bin/packages)
    # entered for the others and its files kept from that one. The files yielded are the same set.
    langs = [l for l in lang.split(',') if l] if lang else ['']
    spec = [(l, EXT.get(l, ()), NAMES.get(l, ())) for l in langs]
    hidden = {root: frozenset()}                                   # the languages that pruned each directory walked
    ignored = git_ignored_dirs(root); real = os.path.realpath(root)   # a .gitignore'd directory is pruned for every language
    web = WEB.intersection(langs)                                   # the languages that skip a build's output (#1545)
    for d, subdirs, files in os.walk(root):
        off = hidden.pop(d, frozenset())
        rd = os.path.join(real, os.path.relpath(d, root)) if ignored else d
        parent, keep = os.path.basename(d), []
        for s in subdirs:
            if ignored and os.path.normpath(os.path.join(rd, s)) in ignored: continue
            o = off | {l for l in langs if prunes(l, s, parent)}
            if web and not web <= o and generated_output(d, s): o = o | web     # a build's output (#1545)
            if all(l in o for l in langs): continue
            keep.append(s); hidden[os.path.join(d, s)] = o
        subdirs[:] = keep
        for f in files:
            for l, exts, names in spec:
                if l in off: continue
                if f.endswith(exts) or f in names or (l == 'java' and os.path.basename(d) == 'services' and 'META-INF' in d) \
                        or (l == 'python' and python_script(os.path.join(d, f), f)):
                    yield os.path.join(d, f); break

def digest(p):
    h = hashlib.sha1()
    with open(p, 'rb') as fh:
        for b in iter(lambda: fh.read(1 << 20), b''): h.update(b)
    return h.hexdigest()

def snapshot(repo, lang, src):
    """the file table: {rel: [size, mtime_ns, sha1]} of every file the parser would read under src"""
    files = {}
    for p in watched(src, lang):
        try: st = os.stat(p); files[os.path.relpath(p, repo)] = [st.st_size, st.st_mtime_ns, digest(p)]
        except OSError: pass
    return files

def load_table(repo):
    try: return json.load(open(table_path(repo)))
    except (OSError, ValueError): return None

def changes(repo, table=None):
    """the files that differ from the table: (changed, added, removed), or None when there is no table to
    compare with (a graph built before the table existed, or none at all). A stat mismatch is confirmed by
    the hash, so `touch`, a checkout that restores the same bytes or an editor that rewrites on save does
    not cost a rebuild."""
    t = table or load_table(repo)
    if not t: return None
    old = t.get('files', {}); src = os.path.join(repo, t.get('src') or '')
    changed, added, seen = [], [], set()
    for p in watched(src, t.get('lang', '')):
        rel = os.path.relpath(p, repo); seen.add(rel)
        try: st = os.stat(p)
        except OSError: continue
        o = old.get(rel)
        if o is None: added.append(rel); continue
        if o[0] == st.st_size and o[1] == st.st_mtime_ns: continue
        try:
            if digest(p) != o[2]: changed.append(rel)
        except OSError: changed.append(rel)
    if 'lang_auto' not in t:
        # A TABLE FROM BEFORE EVERY LANGUAGE WAS INDEXED watches its one language, so a repository whose other languages
        # were dropped looked fresh until that language's files changed. Another language's source is new to it: the
        # refresh that follows detects the languages again (worker), once, and records a table that knows them all.
        mine = set(t.get('lang', '').split(','))
        for l in SOURCE:
            if l in mine: continue
            for p in watched(src, l):
                rel = os.path.relpath(p, repo)
                if p.endswith(SOURCE[l]) and rel not in old: added.append(rel); break
    return sorted(changed), sorted(added), sorted(set(old) - seen)

def read_state(repo):
    try: return json.load(open(state_path(repo)))
    except (OSError, ValueError): return {}

def write_state(repo, **kv):
    st = read_state(repo); st.update(kv)
    tmp = state_path(repo) + f'.{os.getpid()}'
    try:
        json.dump(st, open(tmp, 'w')); os.replace(tmp, state_path(repo))
    except OSError: pass

def has_graph(repo):
    """a graph was built here: graph.sqlite exists, or is a pointer whose target is gone. A broken pointer is a graph to
    REPAIR, not a repository without one: taken for the latter, the refresher stopped for good and the next query
    started a full, explicit build that also moved the baseline `changed` measures against"""
    return os.path.lexists(os.path.join(out_dir(repo), 'graph.sqlite'))

def graph_broken(repo):
    return has_graph(repo) and not os.path.exists(os.path.join(out_dir(repo), 'graph.sqlite'))

def graph_lang():
    """the language whose graph a verb reads when it is not the main one (AXIOMCODE_GRAPH_LANG, set by the dispatcher
    as it asks each language's graph in turn), else ''"""
    return os.environ.get('AXIOMCODE_GRAPH_LANG', '')

def graph_dir(repo):
    """the directory holding the current graph (<dir>/out/graph.sqlite) of the language being asked: .axiomcode for
    the main language, .axiomcode/lang/<lang> for any other"""
    l = graph_lang()
    return os.path.join(repo, '.axiomcode', 'lang', l) if l else os.path.join(repo, '.axiomcode')

def baseline_graph(repo):
    """the graph directory that describes the BASELINE `changed` measures edits against, when it is not the current
    graph: after a background refresh the current graph describes the edited tree, and the one it replaced is kept
    in .axiomcode/base (axiomcode-build, keep_base_graph); another language's beside it, in .axiomcode/base/lang/<lang>.
    None when the current graph is the baseline's."""
    root = os.path.join(repo, '.axiomcode', 'base')
    b = os.path.join(root, 'lang', graph_lang()) if graph_lang() else root
    try:
        base = open(os.path.join(out_dir(repo), 'base-tree')).read().strip()
        indexed = open(os.path.join(out_dir(repo), 'indexed-tree')).read().strip()
        if base and base != indexed and open(os.path.join(root, 'tree')).read().strip() == base and os.path.exists(os.path.join(b, 'out', 'graph.sqlite')):
            return b
    except OSError: pass
    return None

def head(repo):
    r = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 else None

def base_moved(repo):
    """HEAD is not the commit the baseline was set at: a commit, a merge, a pull or a checkout since. The baseline has
    to follow it even when no file differs from the graph (committing edits the graph already holds), or `changed`
    keeps reporting every committed edit and test-impact selects for all of them, more with each commit."""
    try: bc = open(os.path.join(out_dir(repo), 'base-commit')).read().strip()
    except OSError: return False
    h = head(repo)
    return bool(h) and bool(bc) and bc != h

def legacy_params(repo):
    """a graph built before the file table: the language, --src and --library it was built with, from its run table"""
    import sqlite3
    try:
        con = sqlite3.connect(f"file:{os.path.join(out_dir(repo), 'graph.sqlite')}?mode=ro", uri=True)
        run = dict(con.execute("SELECT key, value FROM run").fetchall()); con.close()
    except Exception: return None
    src = os.path.relpath(os.path.realpath(run.get('source_dir') or repo), os.path.realpath(repo))
    return dict(lang=run.get('language', ''), src_arg='' if src == '.' or src.startswith('..') else src, library=run.get('library_roots') or '')

def _flock(fd, block):
    """an advisory lock on fd; the OS releases it when the last holder of the file description exits, so a
    killed build never leaves a lock behind (no stale-lock timeout to guess)"""
    try:
        import fcntl
        fcntl.flock(fd, fcntl.LOCK_EX | (0 if block else fcntl.LOCK_NB)); return True
    except ImportError:                                        # Windows: msvcrt locks a byte range instead
        import msvcrt
        while True:
            try: msvcrt.locking(fd, msvcrt.LK_NBLCK, 1); return True
            except OSError as e:
                # Git Bash's fd 9 is not a descriptor in a native python.exe, which inherits only 0-2 (#1331). There is
                # no lock to take; waiting for one looped forever, so the build runs unlocked, as a single build did.
                if e.errno == errno.EBADF: return True
                if not block: return False
                time.sleep(0.5)
    except OSError: return False

def building(repo):
    """True while a build holds the build lock (the worker's or an explicit `axiomcode index`)"""
    p = os.path.join(repo, '.axiomcode', 'build.lock')
    if not os.path.exists(p): return False
    fd = os.open(p, os.O_RDWR)
    try:
        if _flock(fd, False):
            return False
        return True
    finally: os.close(fd)                                     # closing drops a lock this probe took

def wait_build(repo, seconds, say=True):
    """wait while a build holds the build lock, up to `seconds`, with one progress line on stderr every 15 s. A query
    that arrives mid-build waits for it this way instead of starting another build (which queued behind the lock and
    then rebuilt everything again) or reading a graph that is being swapped. True when no build is running any more."""
    end = time.time() + seconds; t0 = time.time(); last = 0
    while building(repo):
        if time.time() >= end: return False
        if say and time.time() - last >= 15:
            st = read_state(repo); since = st.get('started')
            print(f"a graph build is running for {repo}" + (f" ({int(time.time() - since)} s so far)" if since else '') +
                  f" — waiting for it (up to {int(seconds)} s, AXIOMCODE_BUILD_WAIT)", file=sys.stderr, flush=True)
            last = time.time()
        time.sleep(0.5)
    return True

def pending(repo):
    """what a running build has still to publish once the main graph is out (axiomcode-build, #1555): {} when nothing,
    or when no build holds the lock (a build that was killed leaves the file, and it means nothing then). Else
    `pending` (the languages, in solve order), `pending_old` (those a previous graph still answers for), and `first`
    (a first build: there is no earlier graph of anything to wait for)."""
    try: rows = [l.split() for l in open(os.path.join(out_dir(repo), 'building')) if l.strip()]
    except OSError: return {}
    if not rows or not building(repo): return {}
    langs = [r[0] for r in rows]
    old = [l for l in langs if os.path.isfile(os.path.join(repo, '.axiomcode', 'lang', l, 'out', 'graph.sqlite'))]
    return dict(pending=langs, pending_old=old, first=all(len(r) > 1 and r[1] == 'first' for r in rows))

def status(repo):
    if not has_graph(repo): return dict(state='no graph')
    if graph_broken(repo): return dict(state='building' if building(repo) else 'stale', changed=['.axiomcode/out/graph.sqlite (the pointer to the graph is broken)'], added=[], removed=[])
    c = changes(repo)
    st = read_state(repo)
    if c is None: return dict(state='unknown', note='the graph predates the file table; the next `axiomcode index` records it')
    changed, added, removed = c
    busy = building(repo)
    if not (changed or added or removed):
        # a build that already published this tree's main graph and is still solving other languages: the graph a query
        # reads is current, and waiting would be waiting for other languages' compiles
        return dict(state='building', **pending(repo)) if busy else dict(state='fresh')
    d = dict(state='building' if busy else 'stale', changed=changed, added=added, removed=removed)
    if not busy and st.get('failed_table') == change_key(c): d['failed'] = st.get('failed_log', ''); d['failed_reason'] = st.get('failed_reason', '')
    return d

def change_key(c):
    """identifies a change set, so a build that failed on it is not retried until the files move again"""
    return hashlib.sha1(json.dumps(c).encode()).hexdigest()

def enabled(repo):
    return not os.environ.get('AXIOMCODE_NO_REFRESH') and not os.environ.get('AXIOMCODE_GRAPH') and has_graph(repo)

def refresh_off(repo):
    """the refresher is switched off (AXIOMCODE_NO_REFRESH) over a graph of this repository's own: nothing rebuilds it,
    but an answer from it can still say which files it predates. A graph placed by AXIOMCODE_GRAPH has no file table
    of this tree to compare with"""
    return bool(os.environ.get('AXIOMCODE_NO_REFRESH')) and not os.environ.get('AXIOMCODE_GRAPH') and has_graph(repo)

def kick(repo, trigger='an edit'):
    """start the worker and return at once; a no-op without a graph (the FIRST build takes minutes and is
    the caller's decision, see ax_contract.ensure_graph) or when one is already running"""
    if not enabled(repo): return False
    lock = os.path.join(repo, '.axiomcode', 'refresh.lock')
    fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        if not _flock(fd, False): return False                # a worker is running; it re-checks before it exits
    finally: os.close(fd)
    log = open(os.path.join(repo, '.axiomcode', 'refresh.log'), 'a')
    env = dict(os.environ, AXIOMCODE_REFRESH_TRIGGER=trigger)
    argv = [sys.executable, os.path.abspath(__file__), 'worker', repo]
    if os.name != 'nt':
        subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, env=env, start_new_session=True)
        return True
    # A HOOK ON WINDOWS MAY RUN IN A JOB OBJECT that is closed, with every process in it, when the hook returns: a worker
    # merely DETACHED died with it, and the rebuild it had started was lost. CREATE_BREAKAWAY_FROM_JOB leaves the job; a
    # job that forbids it refuses the flag, and the worker is started without it, as before.
    for flags in (0x00000008 | 0x00000200 | 0x01000000, 0x00000008 | 0x00000200):   # DETACHED | NEW_GROUP (| BREAKAWAY)
        try:
            subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=log, stderr=log, close_fds=True, env=env, creationflags=flags)
            return True
        except OSError: continue
    return False

def worker(repo):
    lock = os.path.join(repo, '.axiomcode', 'refresh.lock')
    fd = os.open(lock, os.O_RDWR | os.O_CREAT, 0o644)
    if not _flock(fd, False): return 0                        # single flight
    debounce = float(os.environ.get('AXIOMCODE_REFRESH_DEBOUNCE') or 2); legacy_done = False
    try:
        for _ in range(8):                                    # bounded: a tree rewritten faster than it builds must not spin forever
            time.sleep(debounce)
            t = load_table(repo)
            if not has_graph(repo): return 0
            if not t:
                # a graph from before the file table: one build with its own parameters, which rebuilds only if git
                # says the tree moved, and records the table either way; nothing to compare until then
                t = legacy_params(repo)
                if not t or legacy_done: return 0
                legacy_done = True; c = [['(no file table yet)'], [], []]
            else:
                c = changes(repo, t)
                if graph_broken(repo) and not (c and any(c)): c = [['.axiomcode/out/graph.sqlite (broken pointer)'], [], []]
                if (c is None or not any(c)) and not base_moved(repo):
                    write_state(repo, state='fresh', checked=time.time(), checked_by=os.environ.get('AXIOMCODE_REFRESH_TRIGGER', '')); return 0
                c = c or [[], [], []]
            st = read_state(repo)
            # a build that FAILED on exactly this tree is not retried on every trigger: the next edit retries it
            fp = change_key(c)
            if st.get('failed_table') == fp: return 0
            n = sum(len(x) for x in c)
            why = (f"{n} file(s) changed" if n else f"HEAD moved to {(head(repo) or '')[:10]}") + f", found by {os.environ.get('AXIOMCODE_REFRESH_TRIGGER') or 'an edit'}"
            # languages DETECTED are detected again (a language the repository gained since gets its graph); only a
            # --lang the user gave is kept. A table from before this was recorded counts as detected: it was built with
            # one language even where the repository had several, and keeping that would keep the others out for good
            env = dict(os.environ, AXIOMCODE_LANG='' if t.get('lang_auto', True) else t.get('lang', ''), AXIOMCODE_SRC=t.get('src_arg', ''),
                       AXIOMCODE_BACKGROUND='1', AXIOMCODE_REFRESH_REASON=why)
            env.pop('AXIOMCODE_LIBRARY', None)
            env.pop('AXIOMCODE_LANG_AUTO', None); env.pop('AXIOMCODE_GRAPH_LANG', None)
            if t.get('library'): env['AXIOMCODE_LIBRARY'] = t['library']
            t0 = time.time(); write_state(repo, state='building', started=t0, files=sum(len(x) for x in c))
            if any(c): print(f"{time.strftime('%H:%M:%S')} refresh: {sum(len(x) for x in c)} file(s) changed ({', '.join((c[0] + c[1] + c[2])[:5])}) — rebuilding", flush=True)
            else: print(f"{time.strftime('%H:%M:%S')} refresh: HEAD moved — moving the baseline to it", flush=True)
            # the worker is detached and has no console, so Windows would give the console program bash a new, visible
            # window for the length of every rebuild; CREATE_NO_WINDOW keeps it hidden
            r = subprocess.run([os.environ.get('AXIOMCODE_BASH') or 'bash', os.path.join(H, 'axiomcode-build'), repo], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                               **(dict(creationflags=0x08000000) if os.name == 'nt' else {}))
            took = round(time.time() - t0, 1)
            if r.returncode != 0:
                write_state(repo, state='failed', finished=time.time(), seconds=took, failed_table=fp,
                            failed_log=os.path.join(repo, '.axiomcode', 'refresh.log'), failed_reason=failure_reason(r.stdout))
                print(f"refresh: build failed after {took}s; the previous graph is kept\n{r.stdout[-800:]}", flush=True)
                return 1
            write_state(repo, state='fresh', finished=time.time(), checked=time.time(), seconds=took, failed_table=None, reason=why)
            print(f"refresh: done in {took}s", flush=True)
    finally:
        os.close(fd)                                          # the lock goes with it
    # an edit that landed after the last check but while the lock was still held found the worker busy and
    # returned; it is picked up here, after the lock is released, by starting over
    c = changes(repo)
    if (c and any(c) and read_state(repo).get('failed_table') != change_key(c)) or base_moved(repo): kick(repo)
    return 0

def failure_reason(out):
    """the line of a failed build's output that says why: "no engine found", "build failed", the engine's own ❌ line"""
    lines = [l.strip() for l in (out or '').splitlines() if l.strip()]
    for l in lines:
        if 'no engine found' in l or l.startswith(('❌', 'build failed', 'could not')): return l[:300]
    return lines[-1][:300] if lines else 'no output'

def wait(repo, seconds):
    """kick, then wait until the graph is fresh or `seconds` have passed. Returns the status at the end."""
    if not enabled(repo):                                        # switched off, or a graph placed by AXIOMCODE_GRAPH: nothing to say,
        p = {} if os.environ.get('AXIOMCODE_GRAPH') or not has_graph(repo) else pending(repo)   # but the languages a build
        return dict(state='building', **p) if p else dict(state='off')                          # has yet to publish
    end = time.time() + seconds
    while True:
        s = status(repo)
        if s['state'] == 'unknown': kick(repo, 'a query'); return s     # a graph from before the file table: its first refresh records one
        # a FIRST build's other languages are not waited for: there is no graph of theirs to refresh, only a compile
        # that can take an hour (#1555). A rebuild's are, for the bounded while any refresh is.
        if s['state'] in ('fresh', 'no graph') or s.get('failed') or s.get('first'): return s
        if s['state'] == 'stale': kick(repo, 'a query')       # idempotent: a no-op while a worker holds its lock
        if time.time() >= end: return s
        time.sleep(0.5)

def wait_baseline(repo, seconds):
    """for `changed` and `test-impact`: when HEAD moved since the baseline was set, start the refresher and wait for it
    to move the baseline (0.2 s when no file changed, a build of HEAD's text when the tree is dirty). '' or a note."""
    if not enabled(repo) or not base_moved(repo): return ''
    kick(repo, 'a query'); end = time.time() + seconds
    while time.time() < end:
        time.sleep(0.3)
        if not base_moved(repo): return ''
        if read_state(repo).get('state') == 'failed': break
        kick(repo, 'a query')
    return (f"graph refresh: HEAD moved since the baseline was set ({head(repo)[:10]}); the baseline is still being moved, "
            "so this answer also counts what the new commits changed")

def last_update(repo):
    """the last time anything looked at this graph's freshness or rebuilt it: a check, a refresh, a build"""
    st = read_state(repo); ts = [st.get('checked') or 0, st.get('finished') or 0]
    try: ts.append(os.path.getmtime(table_path(repo)))
    except OSError: pass
    return max(ts)

def refreshed(repo):
    """when the graph was built and why (index_meta, written by axiomcode-build), and when it was last checked"""
    import sqlite3
    d = {}
    try:
        con = sqlite3.connect(f"file:{os.path.join(out_dir(repo), 'graph.sqlite')}?mode=ro", uri=True)
        d = dict(con.execute("SELECT key, value FROM index_meta WHERE key IN ('refreshed_at','refresh_reason','refreshed_commit')").fetchall()); con.close()
    except Exception: pass
    st = read_state(repo)
    if st.get('checked'): d['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime(st['checked'])); d['checked_by'] = st.get('checked_by') or st.get('reason', '')
    return d

def edited(s):
    """the files a stale graph predates: changed, added and removed since it was built"""
    return list(s.get('changed', [])) + list(s.get('added', [])) + list(s.get('removed', []))

def pending_note(s):
    """one line naming the languages a build has published the main graph without, or '' (#1555)"""
    if not s.get('pending'): return ''
    new = [l for l in s['pending'] if l not in s.get('pending_old', [])]; old = s.get('pending_old', [])
    says = []
    if new: says.append(f"this answer has no {', '.join(new)} code yet")
    if old: says.append(f"its {', '.join(old)} code comes from the previous graph")
    return (f"graph refresh: the {', '.join(s['pending'])} graph{'s are' if len(s['pending']) > 1 else ' is'} still being built; "
            + '; '.join(says) + "; ask again when `axiomcode index` finishes")

def note(s, marked=None, named=None, off=False):
    """one line for an answer given from a graph that is behind the files, or '' when it is not. `marked` is how many
    of the answer's rows lie in those files (and carry the mark), None when the answer was not looked at. `named` is
    [(name, file)]: a name the query asked about that is written in one of those files, so a "nothing named X" is the
    graph predating the edit that wrote X, not X being absent. `off`: the refresher is switched off, nothing rebuilds"""
    # the languages a running build has still to publish (#1555) get a line of their own, before any line about edits
    first = pending_note(s)
    if s.get('state') not in ('stale', 'building'): return first
    files = edited(s)
    if not files: return first
    first = first + '\n' if first else ''
    head = ', '.join(files[:5]) + (f" … +{len(files) - 5}" if len(files) > 5 else '')
    rows = ('' if marked is None else
            f"; {marked} row(s) lie in those files and are marked {MARK.strip()}: read them for their current text" if marked else
            "; no row of this answer lies in those files")
    if named:
        rows += '; ' + ', '.join(f"'{n}' is written in {f}" for n, f in named[:3]) + \
                ", edited since the graph was built: a declaration added there is not in this graph yet, so finding nothing by that name does not mean it is absent"
    if off:
        return first + (f"graph refresh: OFF (AXIOMCODE_NO_REFRESH is set), no refresh is running — this answer is from a graph that "
                f"predates edits to {head}" + (rows if marked is not None else '; read those files for their current text') +
                "; `axiomcode index` rebuilds it")
    if s.get('failed'):
        why = s.get('failed_reason') or ''
        return first + (f"graph refresh: the last rebuild FAILED" + (f" — {why}" if why else '') + f" (see {s['failed']}); this answer is from the "
                f"previous graph, which predates edits to {head}" + rows)
    return first + (f"graph refresh: {'rebuilding' if s['state'] == 'building' else 'queued'} — this answer is from the previous graph, "
            f"which predates edits to {head}" + (rows if marked is not None else '; read those files for their current text') +
            "; --fresh waits for the rebuild")

# ── STALE-WHILE-REVALIDATE (#1595) ──────────────────────────────────────────────────────────────────────────────────
# A query never blocks on a refresh by default: it answers from the last good graph and says precisely what is stale.
# Every row whose declaration or call site lies in a file edited, added or removed since the graph was built is marked;
# rows from untouched files are exactly as current as the graph and carry nothing. It WAITS only when that matters and
# will pay off: the answer (a row, or the name asked about) touches an edited file, the rebuild is not compiling the
# engine's rules, and the last build of this repository says it will be done within AXIOMCODE_FRESH_WAIT seconds
# (default 30). A fixed wait (10 s) was shorter than every rebuild measured, so it was spent and the answer came from
# the old graph anyway. --fresh (MCP fresh=true) waits for the rebuild whatever it costs, saying so as it goes.
MARK = '  (may be out of date)'
_CODE_LINE = re.compile(r'^\s*(\d+ )?\| ')             # a line of quoted source (context --source): never marked
_TOKEN = re.compile(r'[\w.$+@/-]+')
_LOC_KEYS = ('at', 'declared_at', 'call_at', 'file', 'path', 'site', 'location')
# how impact and path say a name matched nothing (axiomcode-impact, axiomcode-path), and the name they say it of
NOT_FOUND = re.compile(r"(?:nothing named|nothing of kind \w+ named|no type named|no declaration in the graph contains|no declaration named)"
                       r" '?([^\s',]+?)'?(?=[\s,.]|$)", re.M)

def not_found(named, out, code):
    """the (name, file) of `named` the answer found nothing by: those its refusal line names, or, for a refusal that
    names none, all of them. `path A B` with only A missing blames A, not B"""
    said = {re.split(r'[.#:/$()<>,\s]+', m.strip('()'))[-1] for m in NOT_FOUND.findall(out)} - {''}
    if said: return [(n, f) for n, f in named if re.split(r'[.#:/$()<>,\s]+', n.strip('()'))[-1] in said]
    return list(named) if code != 0 else []

class Stale:
    """the set of edited files, and whether a path printed in an answer is one of them. Answers print paths relative to
    the repository (or to --src), so a path matches when one ends with the other at a '/'"""
    def __init__(self, files):
        self.files = [f.replace(os.sep, '/') for f in files]
        self.base = {f.rsplit('/', 1)[-1] for f in self.files}

    def hit(self, token):
        t = token.strip('./').split(':', 1)[0] if token else ''
        if not t or t.rsplit('/', 1)[-1] not in self.base: return False
        return any(t == f or f.endswith('/' + t) or t.endswith('/' + f) for f in self.files)

    def line(self, text):
        return any(self.hit(t) for t in _TOKEN.findall(text))

def mark_text(text, stale):
    """(text with every row that names an edited file marked, rows marked, lines naming one at all)"""
    out, n, seen = [], 0, 0
    for l in text.split('\n'):
        if l.strip() and not _CODE_LINE.match(l) and stale.line(l):
            seen += 1
            if not l.lstrip().startswith(('next:', 'verified:', 'bound:')) and MARK not in l: l += MARK; n += 1
        out.append(l)
    return '\n'.join(out), n, seen

def mark_json(obj, stale):
    """the same for a --json answer: a row (an object with a location) in an edited file gets "stale": true, and prose
    lines are marked as the text is. Returns rows marked"""
    n = 0
    if isinstance(obj, dict):
        if any(isinstance(obj.get(k), str) and stale.hit(obj[k]) for k in _LOC_KEYS):
            obj['stale'] = True; n += 1
        for k, v in obj.items():
            if k == 'prose' and isinstance(v, list):
                obj[k] = [mark_text(x, stale)[0] if isinstance(x, str) else x for x in v]
            elif isinstance(v, (dict, list)): n += mark_json(v, stale)
    elif isinstance(obj, list):
        for v in obj: n += mark_json(v, stale)
    return n

def mark_answer(out, stale, as_json):
    """(the answer with its stale rows marked, rows marked, whether it touches an edited file at all)"""
    if as_json:
        try: obj = json.loads(out)
        except ValueError: obj = None
        if isinstance(obj, dict):
            n = mark_json(obj, stale)
            return json.dumps(obj, indent=1, ensure_ascii=False) + '\n', n, n > 0 or stale.line(out)
    text, n, seen = mark_text(out, stale)
    return text, n, seen > 0

_FLAG_VALUE = {'--depth', '--in', '--limit', '--kind', '--page', '--budget', '--tests-in', '--range', '--paths', '--from', '--out'}

def query_names(verb, args, repo):
    """the names a query asks about (impact's targets, path's endpoints, context's --from), as written"""
    names, i, pos = [], 0, []
    while i < len(args):
        a = args[i]
        if a in _FLAG_VALUE:
            if a == '--from' and i + 1 < len(args): names.append(args[i + 1])
            i += 2; continue
        if not a.startswith('-') and not (os.path.isdir(a) and os.path.realpath(a) == repo): pos.append(a)
        i += 1
    if verb in ('impact', 'path'): names += [p for p in pos if p != '*']
    return names

def names_in_edits(repo, names, stale):
    """[(name, file)] for each name asked about that is declared or written in an edited file: a target given as
    file:line in one, or a name whose last part appears as a word in one (a declaration just added is in no graph yet).
    Empty when none is"""
    words, found = {}, []
    for n in names:
        if stale.hit(n): found.append((n, n.split(':', 1)[0])); continue
        w = re.split(r'[.#:/$()<>,\s]+', n.strip('()'))
        w = [x for x in w if re.match(r'^\w+$', x)]
        if w: words.setdefault(w[-1], n)
    if not words: return found
    pat = re.compile(r'\b(' + '|'.join(re.escape(w) for w in sorted(words)) + r')\b')
    for f in stale.files:
        try:
            with open(os.path.join(repo, f), 'rb') as fh: text = fh.read(4 << 20).decode('utf-8', 'replace')
        except OSError: continue
        for w in sorted(set(pat.findall(text))):
            if words.pop(w, None) is not None: found.append((w, f))
        if not words: break
    return found

def build_seconds(repo):
    """(seconds the last build of this repository took to a usable graph, whether it compiled the engine's rules), from
    what axiomcode-build records, or (None, False)"""
    try:
        f = open(os.path.join(out_dir(repo), 'build-seconds')).read().split()
        return float(f[0]), len(f) > 1 and f[1] == '1'
    except (OSError, ValueError, IndexError): return None, False

def compiling(repo):
    """True when the build running now is compiling the engine's rules: minutes, never waited for by default"""
    st = read_state(repo); log = os.path.join(repo, '.axiomcode', 'build.log')
    try:
        if os.path.getmtime(log) + 1 < (st.get('started') or 0): return False       # the log of an earlier build
        with open(log, errors='replace') as fh: return 'compiling souffle program' in fh.read(1 << 16)
    except OSError: return False

def expected_left(repo):
    """seconds until the refresh in flight is expected to swap in its graph, from the last build's duration; None when
    there is nothing to estimate from (no build recorded, or the last one compiled rules, which a refresh does not)"""
    secs, compiled = build_seconds(repo)
    if secs is None or compiled: return None
    st = read_state(repo)
    if st.get('state') == 'building' and st.get('started'): return secs - (time.time() - st['started'])
    return secs + float(os.environ.get('AXIOMCODE_REFRESH_DEBOUNCE') or 2)

def wait_fresh(repo, seconds, say=False):
    """wait until the graph matches the files again (the refresh swapped in its graph), a rebuild fails, or `seconds`
    pass. With `say`, a progress line on stderr every 10 s: a wait is never silent. True when the graph is current"""
    end = t0 = time.time(); end += seconds; last = t0
    while True:
        s = status(repo)
        if s['state'] in ('fresh', 'no graph', 'unknown') or not edited(s): return True
        if s.get('failed'): return False
        if s['state'] == 'stale': kick(repo, 'a query')
        now = time.time()
        if now >= end: return False
        if say and now - last >= 10:
            left = expected_left(repo)
            print(f"waiting for the graph to refresh: {int(now - t0)} s so far" + (f", about {max(1, int(left))} s to go" if left and left > 0 else '') +
                  (" (compiling the engine's rules first)" if compiling(repo) else '') + " …", file=sys.stderr, flush=True)
            last = now
        time.sleep(0.3)

def query(repo, verb, argv, fresh=False):
    """run a query verb (argv) against the last good graph, the stale-while-revalidate way (above). Returns its exit code"""
    def run():
        return subprocess.run(argv, stdout=subprocess.PIPE)
    def passthrough(): os.execvp(argv[0], argv)
    def with_note(n):                                   # the answer as it is, then one line about it on stderr
        r = subprocess.run(argv); print(n, file=sys.stderr); return r.returncode
    # REFRESH SWITCHED OFF IS NOT "UP TO DATE". With AXIOMCODE_NO_REFRESH nothing rebuilds the graph, which is exactly when
    # an answer from it most needs to say which edits it predates: a "nothing named X" for an X an edit just added read
    # as X not existing. It is checked, marked and noted as below; it only never kicks a refresh or waits for one.
    off = not enabled(repo) and refresh_off(repo)
    if not enabled(repo) and not off:
        # the refresh switched off still leaves a build that is solving the repository's other languages (#1555); a
        # graph placed by AXIOMCODE_GRAPH is not this build's, and says nothing
        n = '' if os.environ.get('AXIOMCODE_GRAPH') or not has_graph(repo) else pending_note(pending(repo))
        if not n: passthrough()
        return with_note(n)
    s = status(repo)
    if s['state'] == 'unknown':
        if not off: kick(repo, 'a query')
        passthrough()
    if s['state'] in ('fresh', 'no graph') or not edited(s):
        # a build that published this tree's main graph and is solving the others (#1555): the answer is current and is
        # given now, and says which languages it cannot see yet
        if not pending_note(s): passthrough()
        return with_note(pending_note(s))
    if not s.get('failed') and not off: kick(repo, 'a query')
    as_json = '--json' in argv
    if fresh and not s.get('failed') and not off:
        left = expected_left(repo)
        print(f"waiting for the graph to refresh (--fresh): {len(edited(s))} file(s) changed since the graph was built" +
              (f", the last build took {int(build_seconds(repo)[0])} s" if left is not None else '') + " …", file=sys.stderr, flush=True)
        if wait_fresh(repo, float(os.environ.get('AXIOMCODE_FRESH_MAX') or 600), say=True): passthrough()
        s = status(repo)
    stale = Stale(edited(s)); r = run()
    out = r.stdout.decode('utf-8', 'replace')
    marked, n, touched = mark_answer(out, stale, as_json)
    named = names_in_edits(repo, query_names(verb, argv, repo), stale)
    touched = touched or bool(named)
    if touched and not fresh and not s.get('failed') and not off:
        budget = float(os.environ.get('AXIOMCODE_FRESH_WAIT') or 30)
        left = expected_left(repo)
        if budget > 0 and not compiling(repo) and (left is None or left <= budget):
            print(f"waiting for the graph to refresh: this answer touches {', '.join(stale.files[:3])}" + (' …' if len(stale.files) > 3 else '') +
                  f", edited since the graph was built; up to {int(budget)} s" + (f" (the last build took {int(build_seconds(repo)[0])} s)" if left is not None else '') + " …",
                  file=sys.stderr, flush=True)
            if wait_fresh(repo, budget, say=True): passthrough()
            s = status(repo); stale = Stale(edited(s))
            if edited(s):
                r = run(); out = r.stdout.decode('utf-8', 'replace')
                marked, n, _ = mark_answer(out, stale, as_json)
            else: passthrough()
    # a name asked about that an edit wrote is worth a word only when the answer found nothing by it: a refusal (the
    # verb's non-zero exit) or, in a repository in several languages whose other graph did answer, that graph's line
    missed = not_found(named, out, r.returncode) if named else []
    if as_json:
        try:
            obj = json.loads(marked)
            if isinstance(obj, dict):
                obj['freshness'] = dict(state='off' if off else s['state'], edited=edited(s), rows_marked=n,
                                        **({'failed': s['failed']} if s.get('failed') else {}),
                                        **({'named_in_edits': [dict(name=a, file=b) for a, b in missed]} if missed else {}))
                marked = json.dumps(obj, indent=1, ensure_ascii=False) + '\n'
        except ValueError: pass
    sys.stdout.write(marked); sys.stdout.flush()
    msg = note(s, n, named=missed, off=off)
    if msg: print(msg, file=sys.stderr)
    return r.returncode

def main(argv):
    if len(argv) < 2: print(__doc__); return 2
    cmd = argv[1]
    if cmd == 'lock':
        return 0 if _flock(int(argv[2]), '--try' not in argv) else 75
    repo = os.path.realpath(argv[2]) if len(argv) > 2 else os.getcwd()
    if cmd == 'snapshot':
        lang, src_arg = argv[3], (argv[4] if len(argv) > 4 else '')
        lib = os.environ.get('AXIOMCODE_LIBRARY', '')
        json.dump(dict(lang=lang, lang_auto=bool(os.environ.get('AXIOMCODE_LANG_AUTO')), src=src_arg.strip('/'), src_arg=src_arg, library=lib, built=time.time(),
                       files=snapshot(repo, lang, os.path.join(repo, src_arg))), sys.stdout); return 0
    if cmd == 'count':
        # the SOURCE files of each language under repo, walked as the refresher walks (the parser's skip list and git's
        # ignore rules): java typescript python javascript csharp. axiomcode-build picks the main language from these, and
        # a `find` that saw a generated tree the parser skips could pick a different main language than the last build did
        n = {l: 0 for l in SOURCE}
        for l in SOURCE:
            for p in watched(repo, l):
                if p.endswith(SOURCE[l]) or (l == 'python' and python_script(p)): n[l] += 1
        print(n['java'], n['typescript'], n['python'], n['javascript'], n['csharp']); return 0
    if cmd == 'pyscripts':
        # how many extensionless python scripts are under repo: added to the build's .py count when it picks a language
        n = 0
        for d, subdirs, files in os.walk(repo):
            subdirs[:] = [x for x in subdirs if not prunes('python', x, os.path.basename(d))]
            n += sum(1 for f in files if python_script(os.path.join(d, f), f))
        print(n); return 0
    if cmd == 'uptodate':
        # exit 0 when the recorded table was built with this language / --src / --library and no file differs
        lang, src_arg, lib = argv[3], argv[4] if len(argv) > 4 else '', argv[5] if len(argv) > 5 else ''
        t = load_table(repo)
        if not t or t.get('lang') != lang or t.get('src_arg', '') != src_arg or (t.get('library') or 'nolib') != (lib or 'nolib'): return 1
        c = changes(repo, t)
        return 0 if c is not None and not any(c) else 1
    if cmd == 'status':
        s = status(repo)
        if '--json' in argv: print(json.dumps(dict(s, **refreshed(repo))))
        else:
            r = refreshed(repo)
            print(s['state'] + (': ' + note(s) if note(s) else ''))
            if r.get('refreshed_at'): print(f"built {r['refreshed_at']} ({r.get('refresh_reason', '')})" + (f"; last checked {r['checked_at']}" if r.get('checked_at') else ''))
        return 0
    if cmd == 'kick': kick(repo); return 0
    if cmd == 'baseline':
        n = wait_baseline(repo, float(argv[3]) if len(argv) > 3 else 30)
        if n: print(n, file=sys.stderr)
        return 0
    if cmd == 'worker': return worker(repo)
    if cmd == 'query':
        # ax_fresh.py query <repo> <verb> -- <the verb's command line>: what the dispatcher runs a query verb through
        rest = argv[argv.index('--') + 1:]
        return query(repo, argv[3], rest, fresh=bool(os.environ.get('AXIOMCODE_FRESH')))
    if cmd == 'wait':
        s = wait(repo, float(argv[3]) if len(argv) > 3 else float(os.environ.get('AXIOMCODE_FRESH_WAIT') or 10))
        n = note(s)
        if n: print(n, file=sys.stderr)
        return 0
    print(__doc__); return 2

if __name__ == '__main__':
    sys.exit(main(sys.argv))
