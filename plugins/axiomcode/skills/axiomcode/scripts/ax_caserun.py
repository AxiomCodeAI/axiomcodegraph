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


def plan(repo, files):
    """({command: [files]}, {file: runner}) for the files that are a case runner, its inputs or the rules it mirrors;
    the rest are not this module's"""
    cmds, owner = {}, {}
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
    # one case run is part of a whole-runner run: say the whole one only
    wholes = {c for c in cmds if c.count(' ') == 1}
    for c in list(cmds):
        if c not in wholes and any(c.startswith(w + ' ') for w in wholes):
            w = next(w for w in wholes if c.startswith(w + ' ')); cmds[w] = sorted(set(cmds[w]) | set(cmds.pop(c)))
    return cmds, owner


def in_case_dir(repo, rel):
    """whether `rel` is an input under a case runner's `cases/` (data, never a test of its own)"""
    c = case_of(repo, rel)
    return bool(c) and '/' + CASES + '/' in '/' + rel


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
