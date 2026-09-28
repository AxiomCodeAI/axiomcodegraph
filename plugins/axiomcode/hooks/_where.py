"""_where.py: which repository's graph a hook event is about: the one above the file or directory the tool touched.

The hooks used to look for the graph in the session's working directory only. Agents rarely work there: in 309 measured
sessions, 308 had a working directory with no graph and read, grepped and edited files in indexed worktrees, fixtures
and project copies by absolute path. 190 agents made 2,115 graph calls between them and the hooks spoke 3 times, and
never once on a Read or a Grep. So each hook asks here instead:

  touched(tool, inp, cwd)   the paths the tool acts on: Read / Edit / Write file_path, Grep / Glob path, the graph's
                            own tools' repo, and for Bash the last `cd` and the path arguments that exist
  root_of(path)             the nearest directory at or above `path` holding .axiomcode/out/graph.sqlite, or a
                            per-language graph under .axiomcode/lang/<lang>/out/; None when there is none. It walks
                            up from the REAL path: a symlink into another tree finds that tree's graph (whose
                            relative paths are the ones the file has), never the graph of the directory the link
                            sits in
  locate(tool, inp, cwd)    the repository root for this event. A tool that names a path is answered from that path
                            alone: no graph above it is silence, even when the working directory has one (a search
                            of another tree says nothing about this graph). A tool that names none falls back to
                            the working directory, walked up the same way
  graph_db(root, file)      the graph a file's language is answered from: .axiomcode/lang/<lang>/out/graph.sqlite
                            when the repository has one for that extension, else the main graph
  remember / recent         the repositories touched this session, most recent first, for the events that name no
                            path (a prompt, the end of a turn)

The walk is cached per directory for the session, in the temp directory (a hook is a new process each time). A found
root is kept while its graph exists. "No graph here" is NOT kept: an agent that runs `axiomcode index` and then reads
must be answered on that read, and the uncached walk that says so is a stat per directory level (under 1 ms). Every function here returns a safe empty answer instead of raising: a hook never fails a tool call."""
import json, os, re, shlex, time

BY_EXT = {'.py': ('python',), '.pyi': ('python',), '.java': ('java',), '.cs': ('csharp',),
          '.ts': ('typescript',), '.tsx': ('typescript',), '.mts': ('typescript',), '.cts': ('typescript',),
          '.js': ('javascript', 'typescript'), '.jsx': ('javascript', 'typescript'),
          '.mjs': ('javascript', 'typescript'), '.cjs': ('javascript', 'typescript')}
# THE ONE TABLE OF WHAT A HOOK CALLS SOURCE. Each hook kept its own regex or tuple of extensions, and each drifted:
# the edit hooks had no `.cs`, so a C# edit got no graph line while a C# read did. Every hook asks these instead.
SOURCE_EXT = tuple(BY_EXT)
SOURCE_ALT = '|'.join(sorted((e[1:] for e in BY_EXT), key=len, reverse=True))   # for a regex: (?:py|java|cs|...)
# test code, in each language's convention: a tests/ or src/test/ directory, a *Test / *Tests class file, a C# test
# project (App.Tests/), a test_*.py module, a *.spec.ts / *.test.js file
TEST = re.compile(r'(^|/)(tests?|__tests__)/|/src/test/|(^|/)[\w.]+\.Tests?/|Tests?\.(java|cs)$|\.(spec|test)\.[jt]sx?$|(^|/)test_')


def is_source(path):
    """a file some language's graph is built from: a known extension, or an extensionless script with a Python
    shebang (the index reads those as modules)"""
    path = str(path or '')
    ext = os.path.splitext(path)[1].lower()
    if ext: return ext in BY_EXT
    try:
        with open(path, 'rb') as f: first = f.readline(200)
        return first.startswith(b'#!') and b'python' in first
    except OSError: return False


def is_test(rel):
    return bool(TEST.search(str(rel or '').replace(os.sep, '/')))


def lang_of(path):
    """the language a file's tests are run in, '' when none"""
    return (BY_EXT.get(os.path.splitext(str(path or ''))[1].lower()) or ('',))[0]

_session = 'x'
_cache = None


def _cache_path():
    sid = re.sub(r'[^\w.-]', '_', str(_session))[:80] or 'x'
    # not tempfile.gettempdir(): importing tempfile costs ~15 ms, on a hook that runs before and after every tool call
    tmp = os.environ.get('TMPDIR') or os.environ.get('TEMP') or os.environ.get('TMP') or ('/tmp' if os.name != 'nt' else os.path.expanduser('~'))
    return os.path.join(tmp, 'axiomcode-hooks', f'where-{sid}.json')


def _load():
    global _cache
    if _cache is None:
        try: _cache = json.load(open(_cache_path()))
        except Exception: _cache = {}
        _cache.setdefault('dirs', {}); _cache.setdefault('repos', [])
    return _cache


def _save():
    if _cache is None: return
    try:
        p = _cache_path(); os.makedirs(os.path.dirname(p), exist_ok=True)
        if len(_cache['dirs']) > 400: _cache['dirs'] = dict(list(_cache['dirs'].items())[-200:])
        tmp = f'{p}.{os.getpid()}'
        with open(tmp, 'w') as f: json.dump(_cache, f)
        os.replace(tmp, p)                                    # hooks run in parallel: a whole file or the old one
    except Exception: pass


def session(sid):
    """the session whose cache this process reads (call once, with the event's session_id)"""
    global _session, _cache
    if sid and sid != _session: _session, _cache = sid, None


def has_graph(d):
    """d holds a graph: the main one, or any language's under .axiomcode/lang/"""
    ax = os.path.join(d, '.axiomcode')
    if not os.path.isdir(ax): return False
    if os.path.isfile(os.path.join(ax, 'out', 'graph.sqlite')): return True
    try: return any(os.path.isfile(os.path.join(ax, 'lang', l, 'out', 'graph.sqlite')) for l in os.listdir(os.path.join(ax, 'lang')))
    except OSError: return False


def root_of(path):
    """the nearest directory at or above the REAL `path` holding a graph, or None"""
    try:
        cur = os.path.realpath(os.path.expanduser(str(path)))
        if not os.path.isdir(cur): cur = os.path.dirname(cur)
    except Exception: return None
    c = _load(); now = time.time(); walked = []; found = None
    while True:
        hit = c['dirs'].get(cur)
        if hit and hit[0] and has_graph(hit[0]): found = hit[0]; break
        walked.append(cur)
        if has_graph(cur): found = cur; break
        up = os.path.dirname(cur)
        if up == cur: break
        cur = up
    if found and walked:
        for d in walked: c['dirs'][d] = [found, now]
        _save()
    return found


def _abs(p, base):
    p = os.path.expanduser(str(p))
    return p if os.path.isabs(p) else os.path.join(base, p)


def bash_where(cmd, cwd):
    """(base, paths) for a shell command: `base` is where it runs (the last `cd`, else cwd); `paths` are its arguments
    that name an existing file or directory, resolved against `base`"""
    cmd = str(cmd or '')
    base = cwd
    for d in re.findall(r'(?:^|[;&|(]\s*)cd\s+([^\s;&|)]+)', cmd):
        d = d.strip('\'"')
        if d and d != '-': base = _abs(d, base)
    try: toks = shlex.split(cmd, comments=False)
    except ValueError: toks = cmd.split()
    paths = []
    for i, t in enumerate(toks):
        if not t or t.startswith('-') or (i and toks[i - 1] == 'cd') or t in ('cd', '|', '&&', ';', '||'): continue
        if not ('/' in t or t.startswith(('~', '.')) or re.search(r'\w\.\w+$', t)): continue   # a path, or a file name
        t = t.rstrip(';&|')
        try:
            p = _abs(t, base)
            if os.path.exists(p): paths.append(p)
        except Exception: continue
        if len(paths) >= 8: break
    return base, paths


def touched(tool, inp, cwd):
    """the paths this tool call acts on; [] when it names none"""
    inp = inp or {}
    if tool in ('Read', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'):
        p = inp.get('file_path') or inp.get('notebook_path')
        return [_abs(p, cwd)] if p else []
    if tool in ('Grep', 'Glob'):
        return [_abs(inp['path'], cwd)] if inp.get('path') else []
    if tool == 'Bash':
        base, paths = bash_where(inp.get('command'), cwd)
        return paths or ([base] if base != cwd else [])
    if str(tool).startswith('mcp__plugin_axiomcode_'):
        r = inp.get('repo')
        return [_abs(r, cwd)] if r and r != '.' else []
    return []


def locate(tool, inp, cwd, sid=None):
    """the repository root this event is about, or None: the graph above the first touched path that has one; with no
    touched path, the graph at or above the working directory"""
    session(sid)
    ps = touched(tool, inp, cwd)
    if ps:
        for p in ps:
            r = root_of(p)
            if r: remember(r); return r
        return None
    r = root_of(cwd)
    if r: remember(r)
    return r


def remember(root):
    c = _load()
    if c['repos'][:1] != [root]:
        c['repos'] = [root] + [x for x in c['repos'] if x != root][:7]; _save()


def recent(sid=None):
    """the repositories this session touched, most recent first, that still have a graph"""
    session(sid)
    return [r for r in _load()['repos'] if has_graph(r)]


def graph_dir(root, file=None):
    """the directory holding <dir>/out/graph.sqlite for `file`'s language: .axiomcode/lang/<lang> when the repository
    has that language's graph and it is not the main one, else .axiomcode; the first language graph when there is no
    main graph"""
    ax = os.path.join(root, '.axiomcode')
    main = os.path.isfile(os.path.join(ax, 'out', 'graph.sqlite'))
    for l in BY_EXT.get(os.path.splitext(str(file or ''))[1].lower(), ()):
        d = os.path.join(ax, 'lang', l)
        if os.path.isfile(os.path.join(d, 'out', 'graph.sqlite')): return d
    if main: return ax
    try:
        for l in sorted(os.listdir(os.path.join(ax, 'lang'))):
            if os.path.isfile(os.path.join(ax, 'lang', l, 'out', 'graph.sqlite')): return os.path.join(ax, 'lang', l)
    except OSError: pass
    return ax


def graph_db(root, file=None):
    return os.path.join(graph_dir(root, file), 'out', 'graph.sqlite')


def lang_env(root, file=None):
    """the environment the verbs read a language's graph from (as ax_langs sets it); {} for the main graph"""
    d = graph_dir(root, file)
    if os.path.dirname(d).endswith(os.path.join('.axiomcode', 'lang')):
        return {'AXIOMCODE_GRAPH': d, 'AXIOMCODE_GRAPH_LANG': os.path.basename(d)}
    return {}
