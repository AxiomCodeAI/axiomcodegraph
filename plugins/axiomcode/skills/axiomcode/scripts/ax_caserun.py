"""ax_caserun: a data-driven test suite, read the way it runs.

A CASE RUNNER is a script beside a `cases/` directory that walks it: `tests/run.py` indexing each
`tests/cases/<lang>/<case>/` and checking what its case.json asks, `graph/test/<lang>/run-tests.sh` solving each
`cases/<case>/src`. The files under `cases/` are its INPUTS: a `test_jobs.py` inside a case is a fixture's source,
not a test anyone collects, and handing it to pytest (or running a case's `main.py`) runs nothing that checks
anything. So a changed file in a case directory is mapped to the runner, with the command that runs that one case
as the runner's own usage line spells it; a golden beside the cases (`expected/<case>.edges`) maps the same way.

A runner also tests the tree its own directory MIRRORS: `graph/test/python/run-tests.sh` solves every case with the
rules under `graph/python/`, so a changed rule file there (a file no graph reads, which no call edge can reach) maps
to that runner, whole. The mirror must keep at least one segment below the test directory: a top-level `tests/`
would otherwise claim the whole repository.

A test file that merely sits NEXT TO a case directory is still its own framework's test (a `tests/test_x.py` beside
`tests/cases/` runs with pytest); only the files under `cases/` are data.
"""
import os, re, shlex

CASES = 'cases'
TEST_DIR = re.compile(r'^(test|tests|spec|specs|__tests__|it)$', re.I)
LANGS = ('python', 'java', 'csharp', 'typescript', 'javascript', 'go', 'kotlin', 'ruby', 'rust')
_PY_MAIN = re.compile(r'''^if\s+__name__\s*==\s*['"]__main__['"]|^#!.*\bpython''', re.M)
_PY_ARGS = re.compile(r'\bsys\.argv\b|\bargparse\b')
_SH_ARGS = re.compile(r'"\$@"|\$@|\$\*|"\$1"|\$\{1[:}-]|\$1\b')
_NAMES_CASES = re.compile(r'''[\'"/]''' + CASES + r'''[\'"/]''')
# a line that walks the case directory: `os.listdir(os.path.join(HERE, 'cases'))`, `"$HERE"/cases/*/`, a glob
_WALKS_CASES = re.compile(r'''^.*(?:(?:listdir|scandir|iterdir|glob|walk)\b.*[\'"/]''' + CASES + r'''[\'"/]|[\'"/]''' + CASES
                          + r'''[\'"/].*(?:listdir|scandir|iterdir|glob|walk)\b|/''' + CASES + r'''/\*).*$''', re.M)
_FLAG_ALTS = re.compile(r'(--[\w-]+)[ =]\[?<?([\w-]+(?:\|[\w-]+)+)>?\]?')
_FLAG_LANG = re.compile(r'''(--lang(?:uage)?)\b''')

_cache = {}


def _read(repo, rel, n=200_000):
    k = (repo, rel, n)
    if k not in _cache:
        try: _cache[k] = open(os.path.join(repo, rel), errors='replace').read(n)
        except OSError: _cache[k] = ''
    return _cache[k]


def _is_script(repo, rel):
    """a file run as a program: a shell script, a Python file with a main guard or a python shebang"""
    if rel.endswith('.sh'): return True
    t = _read(repo, rel)
    if rel.endswith('.py'): return bool(_PY_MAIN.search(t))
    return False


def _walks_cases(text):
    """a line of CODE that walks `cases/`: a comment saying the loop does, or a string holding a sample test that
    does (a test of this very rule writes one), is not the script walking it"""
    return any(_WALKS_CASES.match(ln) for ln in text.splitlines() if not ln.lstrip().startswith(('#', '"', "'", '//')))


def runners_in(repo, d):
    """the case runners in directory `d` (repo-relative): scripts directly in it that walk its `cases/` directory.
    A script that only names one case (`cases/java/one-case`) is that case's reader, not the suite's: `readers`"""
    k = ('runners', repo, d)
    if k in _cache: return _cache[k]
    out = []
    if os.path.isdir(os.path.join(repo, d, CASES)):
        try: names = sorted(os.listdir(os.path.join(repo, d)))
        except OSError: names = []
        for n in names:
            rel = f"{d}/{n}" if d else n
            if os.path.isfile(os.path.join(repo, rel)) and n.endswith(('.py', '.sh')) and _is_script(repo, rel) \
                    and _walks_cases(_read(repo, rel)):
                out.append(rel)
    _cache[k] = out
    return out


def _under_test_tree(parts):
    return any(TEST_DIR.match(p) for p in parts)


def _manifests(repo, runner):
    """file names the runner quotes (`case.json`): a directory holding one is a case"""
    return set(re.findall(r'''['"/]([\w.-]+\.(?:json|ya?ml|toml|txt))['"]''', _read(repo, runner)))


def _case_dirs(repo, root):
    try: return sorted(n for n in os.listdir(os.path.join(repo, root)) if os.path.isdir(os.path.join(repo, root, n)))
    except OSError: return []


def case_of(repo, rel):
    """(runner, selectors, case) when `rel` is an input of a case runner, else None. `selectors` are the directory
    levels between `cases/` and the case (a language), `case` is the case's directory name, or None when the file
    is shared by every case (it lies directly in `cases/`, or it is a golden no case is named for)."""
    parts = rel.split('/')
    for i in range(len(parts) - 2, -1, -1):
        if parts[i] != CASES: continue
        d = '/'.join(parts[:i])
        if not _under_test_tree(parts[:i]): continue
        rs = runners_in(repo, d)
        if not rs: continue
        below = parts[i + 1:-1]                     # directories between cases/ and the file
        if not below: return rs, [], None
        man = set().union(*(_manifests(repo, r) for r in rs))
        k = next((k for k in range(1, len(below) + 1) if man and any(
            os.path.isfile(os.path.join(repo, d, CASES, *below[:k], m)) for m in man)), 1)
        return rs, below[:k - 1], below[k - 1]
    # a golden beside the cases: `expected/<case>.edges` below a runner's directory, named after one of its cases
    stem = parts[-1].split('.')[0]
    for j in range(len(parts) - 2, -1, -1):
        d = '/'.join(parts[:j])
        if parts[j] == CASES or not _under_test_tree(parts[:j]): continue
        rs = runners_in(repo, d)
        if rs and stem in _case_dirs(repo, f"{d}/{CASES}" if d else CASES):
            return rs, [], stem
    return None


def readers(repo, runner_dir, case):
    """scripts beside a case runner that read one case by its name (`cases/java/one-case`): run whole for it"""
    if not case: return []
    pat = re.compile(r'''[\'"/]''' + re.escape(case) + r'''[\'"/]''')
    out = []
    try: names = sorted(os.listdir(os.path.join(repo, runner_dir)))
    except OSError: names = []
    for n in names:
        rel = f"{runner_dir}/{n}" if runner_dir else n
        if n.endswith(('.py', '.sh')) and os.path.isfile(os.path.join(repo, rel)) and _is_script(repo, rel) \
                and pat.search(_read(repo, rel)):
            out.append(rel)
    return out


def mirrored_runners(repo, rel):
    """the case runners whose test directory mirrors a directory holding `rel` (graph/test/python/run-tests.sh for
    graph/python/engine/x.dl): the rules they solve their cases with"""
    parts = rel.split('/')
    if _under_test_tree(parts[:-1]): return []
    for i in range(len(parts) - 1):
        prefix, rest = parts[:i], parts[i:-1]
        for t in ('test', 'tests'):
            for k in range(len(rest), 0, -1):
                d = '/'.join(prefix + [t] + rest[:k])
                rs = runners_in(repo, d)
                if rs: return rs
    return []


def _usage_lines(text, base):
    """the runner's own usage lines: a comment or docstring line that starts with its file name"""
    pat = re.compile(r'(?:^|[\s#"])(?:\./|[\w./-]*/)?' + re.escape(base) + r'(?=\s)(.*)$')
    out = []
    for ln in text.splitlines()[:120]:
        m = pat.search(ln)
        if m: out.append(m.group(1))
    return out


def command(repo, runner, selectors=(), case=None):
    """the command that runs `runner` on one case, as its usage line spells it; the whole runner without a case, or
    when the runner takes no argument"""
    text = _read(repo, runner)
    base = os.path.basename(runner)
    interp = 'python3' if runner.endswith('.py') else 'bash'
    head = f"{interp} {shlex.quote(runner)}"
    if case is None: return head
    if not (_PY_ARGS if runner.endswith('.py') else _SH_ARGS).search(text): return head
    cases_dir = os.path.join(os.path.dirname(runner), CASES, *selectors)
    names = set(_case_dirs(repo, cases_dir))
    # the case goes on the command line only as the runner's own usage line puts it: a placeholder for the case, or a
    # sample argument that selects one (`04`, `03-target-typed-new`), with the flag in front of it if there is one.
    # A runner whose usage shows neither takes its arguments for something else, and runs whole
    form = None
    for u in _usage_lines(text, base):
        toks = u.split()
        for j, tk in enumerate(toks):
            w = tk.strip('[]<>…,')
            flag = toks[j - 1].strip('[') if j and toks[j - 1].lstrip('[').startswith('--') and not toks[j - 1].endswith(']') else ''
            if w in ('case', 'name', 'case-name') and '<' in tk:
                form = flag; break
            if w and not w.startswith('-') and any(w == n or (len(w) >= 2 and w in n) for n in names):
                form = flag; break
        if form is not None: break
    if form is None: return head
    args = [f"{form} {shlex.quote(case)}" if form else shlex.quote(case)]
    for s in selectors:
        m = next((m for m in _FLAG_ALTS.finditer(text) if s in m.group(2).split('|')), None)
        flag = m.group(1) if m else None
        if not flag and s in LANGS:
            lm = _FLAG_LANG.search(text); flag = lm.group(1) if lm else None
        if flag: args.append(f"{flag} {shlex.quote(s)}")
    return f"{head} {' '.join(args)}"


# ---------------------------------------------------------------------------------------------------------------------
# FIXTURE TREES IN GENERAL. `cases/` beside a runner is one shape of case data; a test tree holds others under any name
# (fixtures/, testdata/, TestData/, a project a test builds, a directory of goldens). What makes a directory under a
# test root DATA is its shape, never its name:
#   - a runner or a test outside it names it by path (`os.path.join(HERE, 'fastpath_cases')`, `Path.Combine("TestData",
#     ...)`, `"$HERE"/projects/*/`): it is read as input;
#   - it holds goldens (`expected/`, `x.expected`, `expected.edges`) and no script or test of its own;
#   - it is a project of its own that no build around it includes (a pyproject.toml or setup.py inside a test tree, a
#     pom.xml no parent pom lists as a <module>, a .csproj no solution names);
#   - on a JVM layout, it is src/test/<x> beside the compiled src/test/java (resources: copied, never compiled).
# A directory whose own files are scripts or collected tests is a test directory, never data, whatever it holds below.
# A file inside such a tree maps to the runner or test that reads it, with that one's command; never to pytest, JUnit or
# a test named like the file.
# ---------------------------------------------------------------------------------------------------------------------
RUNNER_NAME = re.compile(r'^(?:run[-_]tests?[\w.-]*|test\.sh|run\.py)$', re.I)
GOLDEN = re.compile(r'^(?:expected|goldens?|baselines?|ground[-_]truth)(?:$|[._-])|[._-](?:expected|golden|approved)(?:$|\.)', re.I)
COLLECTED_TEST = re.compile(r'^(?:test_[^/]*\.py|[^/]*_test\.py|conftest\.py|[^/]*Tests?\.(?:java|kt|cs)|[^/]*IT\.java)$')
READER_EXT = ('.py', '.sh', '.java', '.kt', '.cs')
JVM_SRC = ('java', 'kotlin', 'groovy', 'scala')
_SKIP = ('node_modules', '.git', 'dist', 'build', 'target', '.axiomcode', 'bin', 'obj', '__pycache__', '.venv', 'venv')
_Q = '[\'"`]'


def _test_root(dirs):
    return next((i for i, p in enumerate(dirs) if TEST_DIR.match(p)), None)


def _entries(repo, d):
    try: return sorted(os.listdir(os.path.join(repo, d)))
    except OSError: return []


def _is_file(repo, rel): return os.path.isfile(os.path.join(repo, rel))


_TEST_ATTR = re.compile(r'^\s*(?:\[(?:\w+\.)*(?:Fact|Theory|Test|TestMethod|TestCase|TestFixture|TestClass)\b|@(?:\w+\.)*(?:Test|ParameterizedTest|RepeatedTest|TestFactory)\b)', re.M)


def _runs_itself(repo, rel):
    """a file that runs: a script (a runner by name, a shell script, a Python main), or a test a framework collects (by
    its name, or a C#/Java/Kotlin file declaring a test method: `[Fact]`, `[Test]`, `@Test`, whatever the file is named)"""
    n = os.path.basename(rel)
    if RUNNER_NAME.match(n) or COLLECTED_TEST.match(n): return True
    if n.endswith(('.py', '.sh')): return _is_script(repo, rel)
    return n.endswith(('.cs', '.java', '.kt')) and bool(_TEST_ATTR.search(_read(repo, rel)))


def _is_runner(repo, rel):
    """a script that runs a suite: it runs itself and is not a test module a framework collects"""
    n = os.path.basename(rel)
    return bool(RUNNER_NAME.match(n) or (not COLLECTED_TEST.match(n) and n.endswith(('.py', '.sh')) and _is_script(repo, rel)))


def _test_dir(repo, d):
    """a directory whose OWN files run (scripts, collected tests): the test code, not data, whatever lies below it"""
    k = ('testdir', repo, d)
    if k not in _cache:
        _cache[k] = any(_is_file(repo, f"{d}/{n}") and _runs_itself(repo, f"{d}/{n}") for n in _entries(repo, d))
    return _cache[k]


def _holds_golden(repo, d, depth=2):
    for n in _entries(repo, d):
        if GOLDEN.search(n): return True
        if depth > 1 and os.path.isdir(os.path.join(repo, d, n)) and _holds_golden(repo, f"{d}/{n}", depth - 1): return True
    return False


def _included(repo, d, marker):
    """whether the build around `d` includes the project in it: a parent pom's <module>, a settings.gradle include, a
    solution naming the .csproj. Nothing includes a fixture project; a real module is always included"""
    parts = d.split('/')
    for i in range(len(parts) - 1, -1, -1):
        up = '/'.join(parts[:i])
        for n in _entries(repo, up):
            f = f"{up}/{n}" if up else n
            if marker == 'pom.xml' and n == 'pom.xml':
                rel = '/'.join(parts[i:])
                if re.search(r'<module>\s*(?:\./)?' + re.escape(rel) + r'/?\s*</module>', _read(repo, f)): return True
            elif marker.startswith('build.gradle') and n.startswith('settings.gradle'):
                if re.search('[\'":]' + re.escape(parts[-1]) + '[\'"]', _read(repo, f)): return True
            elif marker.endswith('.csproj') and n.endswith(('.sln', '.slnx', '.slnf')):
                if marker in _read(repo, f, 2_000_000): return True
    return False


def _fixture_project(repo, d):
    """a project of its own inside a test tree that no build around it includes"""
    for n in _entries(repo, d):
        if n in ('pyproject.toml', 'setup.py', 'setup.cfg'): return True
        if (n in ('pom.xml', 'build.gradle', 'build.gradle.kts') or n.endswith('.csproj')) and _is_file(repo, f"{d}/{n}") \
                and not _included(repo, d, n):
            return True
    return False


_STR = re.compile(r'''(['"`])([^'"`\s]{1,240}|[^'"`\n]{0,120}/[^'"`\n]{0,120})\1|(?<![\w'"`])((?:[\w.$*{}-]*/)+[\w.*{}-]+/?)''')


def _paths_in(text):
    """the path-like strings a file writes: a quoted string with no space in it or with a slash in it ("Test Data/a.nfo"),
    or an unquoted path with a slash (`"$HERE"/projects/*/`); prose with no slash is never one"""
    for m in _STR.finditer(text):
        s = m.group(2) or m.group(3)
        if s: yield s


def _reader_index(repo, limit=8000):
    """who names what, read once per repository: every file that can read a fixture (code or a script under a test
    root, or a runner by its name); for each the path strings it writes, split into parts ({reader: [[parts]]}); and
    the inverse, every path part ({name: readers}) and every run of two or more parts ({'a/b': readers})"""
    k = ('readers', repo)
    if k in _cache: return _cache[k]
    files, segs, tails, strs = [], {}, {}, {}
    for root, dirs, fs in os.walk(repo):
        dirs[:] = sorted(d for d in dirs if d not in _SKIP and not d.startswith('.'))
        rd = os.path.relpath(root, repo).replace(os.sep, '/')
        rd = '' if rd == '.' else rd
        in_test = bool(rd) and _test_root(rd.split('/')) is not None
        for f in sorted(fs):
            if not ((in_test and f.endswith(READER_EXT)) or RUNNER_NAME.match(f)): continue
            rel = f"{rd}/{f}" if rd else f
            files.append(rel)
            mine = strs[rel] = []
            for s in _paths_in(joined_paths(_read(repo, rel))):
                ps = [x for x in re.split(r'[/\\]', s) if x and x not in ('.', '..')]
                if not ps: continue
                mine.append(ps)
                for x in ps: segs.setdefault(x, set()).add(rel)
                for i in range(len(ps)):
                    for j in range(i + 2, min(len(ps), i + 8) + 1): tails.setdefault('/'.join(ps[i:j]), set()).add(rel)
            if len(files) >= limit: break
        if len(files) >= limit: break
    _cache[k] = r = (files, segs, tails, strs)
    return r


_GLOBBY = re.compile(r'[*?{$]')


def _leads_to(repo, reader, a, rel, bare):
    """whether `reader` writes a path to `a` that goes on to `rel` or stops there (or globs past it): `"TestData",
    "a.json"` for TestData/a.json, `cases/*/case.json` for any case, `src/test/resources` alone. A path that carries
    on into another file (`src/test/resources/other.yml`) reads that file, not this one. `bare`: a one-part match counts"""
    ap = a.split('/')
    nxt = rel[len(a) + 1:].split('/')[0] if rel and rel != a and rel.startswith(a + '/') else None
    for ps in _reader_index(repo)[3].get(reader, ()):
        for k in range(len(ap), 0 if bare else 1, -1):
            tail = ap[-k:]
            for i in range(len(ps) - k + 1):
                if ps[i:i + k] != tail: continue
                # a part written before the match that is not a's own (`app/orders` for tests/.../python/orders) is
                # another directory of that name
                if i and k < len(ap) and ps[i - 1] != ap[-k - 1] and not _GLOBBY.search(ps[i - 1]): continue
                after = ps[i + k] if i + k < len(ps) else None
                if after is None or nxt is None or after == nxt or _GLOBBY.search(after): return True
    return False


def _namers(repo, d, rel=None, root=None):
    """the readers outside `d` that name it as a path: its repo path or a run of two or more of its last parts, from
    anywhere; its bare name only quoted or in a path, from a reader under d's parent (`os.path.join(HERE,
    'fixtures')`, `Path(__file__).parent / "fixtures"`, `"$HERE"/projects/*/`), or, with `root`, from a reader anywhere
    under that test root (`fixture_project("demo-package")`, a classpath resource by its name). A reader in another
    project (above the test root) counts only when it writes d's whole path. With `rel`, only the readers whose path
    goes on to `rel` (_leads_to)"""
    files, segs, tails, strs = _reader_index(repo)
    parts = d.split('/')
    many = set()
    for i in range(len(parts) - 1): many |= tails.get('/'.join(parts[i:]), set())
    parent = '/'.join(parts[:-1])
    one = {r for r in segs.get(parts[-1], ()) if (not parent or r.startswith(parent + '/')) or (root and r.startswith(root + '/'))}
    # a relative path (`src/test/resources`, `testdata/x`) is its reader's own project's: only a reader in d's project
    # (the directories above its test root) means this tree by it
    t = _test_root(parts)
    home = '/'.join(parts[:t]) if t else ''
    out = []
    for r in sorted(many | one):
        if r.startswith(d + '/') or r == d: continue
        if home and not r.startswith(home + '/') and d not in {'/'.join(ps) for ps in strs.get(r, ())}: continue
        if rel is None or _leads_to(repo, r, d, rel, r in one): out.append(r)
    return out


def data_tree(repo, rel):
    """(the data directory holding `rel`, why) when `rel` lies in a fixture tree under a test root, else None"""
    k = ('data', repo, rel)
    if k in _cache: return _cache[k]
    _cache[k] = r = _data_tree(repo, rel)
    return r


def _data_tree(repo, rel):
    dirs = rel.split('/')[:-1]
    t = _test_root(dirs)
    if t is None: return None
    if dirs[t].lower() == 'test' and t and dirs[t - 1] == 'src' and len(dirs) > t + 1:
        if dirs[t + 1] in JVM_SRC: return None                    # compiled test sources: code, not data
        return '/'.join(dirs[:t + 2]), 'not compiled: the build copies it beside the test classes'
    for k in range(t + 1, len(dirs)):
        d = '/'.join(dirs[:k + 1])
        if _test_dir(repo, d): continue
        if _namers(repo, d):
            return d, 'read by path'
        if GOLDEN.search(dirs[k]) or _holds_golden(repo, d):
            return d, 'holds goldens'
        if _fixture_project(repo, d):
            return d, 'a project of its own no build includes'
    return None


def data_readers(repo, d, rel):
    """the runners and tests that read the file `rel` in the fixture tree `d`, or a directory between them, nearest
    first: named as a path that leads to `rel` (_namers), or by the bare name from anywhere in the same test root when
    at most a few files there carry that name (`fixture_project("demo-package")`, a classpath resource). A name every
    case repeats (`case.json`) is no one file's. Failing those, a runner by its name above it in the same test root.
    [(reader, how)]"""
    parts = rel.split('/')
    t = _test_root(parts[:-1])
    root = '/'.join(parts[:t + 1])
    chain = ['/'.join(parts[:k]) for k in range(len(parts), 0, -1) if len('/'.join(parts[:k])) >= len(d)]
    for a in chain:
        n = a.rsplit('/', 1)[-1]
        # a plain word (`orders`, `projects`) is every fixture's vocabulary; a compound name (`demo-package`,
        # `pypi.json`) is one thing's
        few = len(n) >= 4 and bool(re.search(r'[-_.]', n)) and 0 < _count_under(repo, root, n, a != rel) <= 3
        rs = [r for r in _namers(repo, a, rel, root if few else None) if not r.startswith(d + '/')]
        if rs:
            return [(r, 'names ' + a) for r in sorted(rs, key=lambda r: (not _is_runner(repo, r), not _runs_itself(repo, r), r))]
    return [(r, 'a runner by its name; it does not name this path') for r in _reader_index(repo)[0]
            if RUNNER_NAME.match(os.path.basename(r)) and r.startswith(root + '/') and not r.startswith(d + '/')
            and d.startswith(os.path.dirname(r) + '/')]


def _count_under(repo, root, name, is_dir):
    """how many files (directories) named `name` lie under `root`"""
    k = ('under', repo, root)
    if k not in _cache:
        fc, dc = {}, {}
        for r, ds, fs in os.walk(os.path.join(repo, root)):
            ds[:] = [x for x in ds if x not in _SKIP and not x.startswith('.')]
            for f in fs: fc[f] = fc.get(f, 0) + 1
            for x in ds: dc[x] = dc.get(x, 0) + 1
        _cache[k] = (fc, dc)
    return _cache[k][1 if is_dir else 0].get(name, 0)


def _data_plan(repo, f, cmds, owner, labels, test_command):
    dt = data_tree(repo, f)
    if not dt: return
    d, why = dt
    rd = data_readers(repo, d, f)
    runs = [(r, how) for r, how in rd if _is_runner(repo, r)]
    tests = [(r, how) for r, how in rd if not _is_runner(repo, r) and _runs_itself(repo, r)]
    helpers = [(r, how) for r, how in rd if not _runs_itself(repo, r)]         # a conftest, a resource reader: no test of its own
    picked = runs[:3] or tests[:12] or helpers[:2]
    owner[f] = picked[0][0] if picked else d
    if not picked:
        c = f"# no runner or test names {d}/ by path: grep the test tree for '{os.path.basename(d)}'"
        cmds.setdefault(c, []).append(f); labels.setdefault(c, f"case data in {d}/ ({why})"); return
    if not runs and tests:
        # the tests that read it, as ONE command of their framework
        rs = [r for r, _ in tests]
        c = (test_command(rs) if test_command else None) or f"# run {', '.join(rs[:4])}"
        cmds.setdefault(c, []).append(f)
        labels.setdefault(c, f"case data for {', '.join(rs[:3])}" + (f" … +{len(rs) - 3}" if len(rs) > 3 else '')
                          + ('' if tests[0][1].startswith('names') else f" ({tests[0][1]})"))
        return
    for r, how in picked:
        if _is_runner(repo, r):
            # the whole runner: a fixture tree is not its case list, so no case goes on the line; a language level below
            # the tree (fastpath_cases/python/...) selects with the runner's own --lang flag when it has one
            c = command(repo, r)
            lang = next((s for s in f[len(d) + 1:].split('/')[:-1] if s in LANGS), None)
            lm = _FLAG_LANG.search(_read(repo, r)) if lang else None
            if lm: c += f" {lm.group(1)} {lang}"
        else:
            c = (test_command([r]) if test_command else None) or f"# run the tests that use {r}"
        cmds.setdefault(c, []).append(f)
        labels.setdefault(c, f"case data for {r}" + ('' if how.startswith('names') else f" ({how})")
                          + (' (a helper with no test of its own: the tests beside it)' if not _runs_itself(repo, r) else ''))


def plan(repo, files, test_command=None):
    """({command: [files]}, {file: runner}) for the files that are a case runner, its inputs, the rules it mirrors, or
    a file in a fixture tree; the rest are not this module's. After a call `plan.labels` says what each command is for
    (`case data for <runner>`); `test_command([test files])` builds the command of the TESTS that read a fixture tree"""
    cmds, owner = {}, {}
    plan.labels = labels = {}
    for f in files:
        if f in runners_in(repo, os.path.dirname(f)):              # the runner itself: it runs whole
            cmds.setdefault(command(repo, f), []).append(f); owner[f] = f; continue
        c = case_of(repo, f)
        if c:
            rs, sel, case = c
            for r in rs:
                cmds.setdefault(command(repo, r, sel, case), []).append(f)
            for r in readers(repo, os.path.dirname(rs[0]), case):
                if r not in rs: cmds.setdefault(command(repo, r), []).append(f)
            owner[f] = rs[0]; continue
    for f in files:
        if f in owner: continue
        rs = mirrored_runners(repo, f)
        for r in rs:
            cmds.setdefault(command(repo, r), []).append(f)
        if rs: owner[f] = rs[0]
    for f in files:
        if f not in owner: _data_plan(repo, f, cmds, owner, labels, test_command)
    # one case run is part of a whole-runner run: say the whole one only
    wholes = {c for c in cmds if c.count(' ') == 1}
    for c in list(cmds):
        if c not in wholes and any(c.startswith(w + ' ') for w in wholes):
            w = next(w for w in wholes if c.startswith(w + ' ')); cmds[w] = sorted(set(cmds[w]) | set(cmds.pop(c)))
            if c in labels: labels.setdefault(w, labels.pop(c))
    return cmds, owner


def in_case_dir(repo, rel):
    """whether `rel` is an input under a case runner's `cases/` or in a fixture tree (data, never a test of its own)"""
    c = case_of(repo, rel)
    return (bool(c) and '/' + CASES + '/' in '/' + rel) or bool(data_tree(repo, rel))


_JOIN = re.compile(r'''(['"][\w./-]+)['"]\s*,\s*['"](?=[\w./-]+['"])''')


_JOIN_CALL = re.compile(r'\b(?:join|Path|get|of|Combine|resolve)\(([^()\n]*)\)')


def joined_paths(text):
    """`os.path.join(ROOT, 'plugins', 'scripts', 'tool')` (Paths.get, Path.Combine) read as the path it builds
    (`'plugins/scripts/tool'`): a test that starts a program by a joined path names that path, and a text search for
    it must see it"""
    if "', '" not in text and '", "' not in text and "','" not in text and '","' not in text: return text

    def one(m):
        inner = m.group(1)
        for _ in range(16):
            t = _JOIN.sub(r'\1/', inner)
            if t == inner: break
            inner = t
        return m.group(0).replace(m.group(1), inner)
    return _JOIN_CALL.sub(one, text)


def dispatcher_of(repo, rel):
    """the dispatcher a program is started through: `d/tool` for `d/tool-verb`, when `d/tool` is a script that execs
    `tool-<its argument>` (the subcommand convention git and many CLIs use)"""
    d, base = os.path.split(rel)
    if '-' not in base: return None
    head = base.split('-', 1)[0]
    for cand in (head, head + '.sh', head + '.py'):
        p = f"{d}/{cand}" if d else cand
        if os.path.isfile(os.path.join(repo, p)):
            t = _read(repo, p)
            if re.search(re.escape(head) + r'-\$(?:\{?\w+\}?|\d)|' + re.escape(head) + r"-['\"]?\s*\+|" + re.escape(base), t):
                return p
    return None


def name_count(repo, base, dirs=False):
    """how many files (`dirs`: directories) in the repository carry the name `base`: a data file's name that several
    files share (every case's `case.json`) says nothing about which of them a test reads, so it is no test-name match"""
    k = ('names', repo)
    if k not in _cache:
        cnt, dcnt = {}, {}
        for root, ds, fs in os.walk(repo):
            ds[:] = [d for d in ds if d not in _SKIP and not d.startswith('.')]
            for f in fs: cnt[f] = cnt.get(f, 0) + 1
            for d in ds: dcnt[d] = dcnt.get(d, 0) + 1
        _cache[k] = (cnt, dcnt)
    return _cache[k][1 if dirs else 0].get(base, 0)
