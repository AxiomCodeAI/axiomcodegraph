#!/usr/bin/env python3
"""The axiomcode entry as MCP tools — one tool per subcommand, each a thin shell-out to scripts/axiomcode so the answer is
exactly what the CLI prints (and stays verified there). Descriptions are short on purpose: they sit in the agent's context every turn."""
import inspect, os, re, subprocess, sys, typing
try:
    from mcp.server.mcpserver import MCPServer
except ImportError:
    # NOTHING INSTALLS THE SDK. The plugin is installed by copying files; npm cannot express a Python
    # requirement and a plugin install has no step that could satisfy one, so the SDK is present only by
    # accident of the host's interpreter. Exiting here left the client reporting a failed connection with
    # no sign that a missing package was the reason (#1105). The server needs three things from the SDK --
    # a constructor, a tool decorator and a stdio loop -- so it carries its own rather than require one.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from _fallback import MCPServer
    sys.stderr.write("axiomcode mcp: the Python MCP SDK is not installed for %s; "
                     "serving with the built-in fallback. `pip install mcp` to use the SDK.\n" % sys.executable)

# THE INSTALL IS LOOKED UP ON EVERY CALL, NOT ONCE AT START. The server lives as long as the session, and the install
# can move under it: a link to the install retargeted at a newer build, or a host that installs each version into a
# directory of its own (a versioned plugin cache) and records which one is current. A path fixed at start kept
# running the old build's scripts and rules, and its rows carried the old IMPACT_VERSION looking current, with only a
# footer to say so. So each call resolves the plugin directory again (plugin_root) and runs the scripts found there;
# the only thing that cannot be reloaded is this file itself (the tools and their parameters), and when the current
# install's copy of it differs, the answer's FIRST line says the server is older than the install and how to restart it.
# The cost per call is a stat of the host's install record and of the current server.py.
ROOT = os.environ.get('AXIOMCODE_PLUGIN_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SELF = os.path.realpath(os.path.abspath(__file__))
try: _SELF_ST = os.stat(_SELF); _SELF_TEXT = open(_SELF, 'rb').read()
except OSError: _SELF_ST = None; _SELF_TEXT = None

def _record():
    """the host's record of its installed plugins, under its config directory"""
    cfg = os.environ.get('CLAUDE_CONFIG_DIR') or os.path.join(os.path.expanduser('~'), '.claude')
    return os.path.join(cfg, 'plugins', 'installed_plugins.json')

_RECORD = [None, None]                          # (the record's stat signature, the root it named), read again on a change

def _recorded_root(root):
    """the directory the host's install record names as current for this plugin, when the host keeps one directory per
    version beside this one (<cache>/<marketplace>/<plugin>/<version>); None when there is no such record"""
    p = _record()
    try: st = os.stat(p)
    except OSError: return None
    sig = (p, st.st_mtime_ns, st.st_size, root)
    if _RECORD[0] == sig: return _RECORD[1]
    found = None
    try:
        import json
        with open(p, encoding='utf-8') as f: plugins = json.load(f).get('plugins') or {}
        here = os.path.normcase(os.path.normpath(root)); parent = os.path.dirname(here); cwd = os.getcwd()
        best = None
        for entries in plugins.values():
            for e in entries if isinstance(entries, list) else []:
                ip = e.get('installPath') if isinstance(e, dict) else None
                if not ip or os.path.dirname(os.path.normcase(os.path.normpath(ip))) != parent: continue
                pp = e.get('projectPath')
                if pp and not (cwd == pp or cwd.startswith(pp.rstrip(os.sep) + os.sep)): continue
                if not os.path.isdir(os.path.join(ip, 'skills', 'axiomcode', 'scripts')): continue
                key = (str(e.get('lastUpdated') or e.get('installedAt') or ''), os.path.normcase(os.path.normpath(ip)) == here)
                if best is None or key > best[0]: best = (key, ip)
        found = best[1] if best else None
    except (OSError, ValueError, AttributeError, TypeError):
        found = None
    _RECORD[0], _RECORD[1] = sig, found
    return found

def plugin_root():
    """the plugin directory of the install that is current now. The root is kept as it was spelled, never resolved, so a
    link on the way to it is followed afresh on every call"""
    return _recorded_root(ROOT) or ROOT

def scripts_dir():
    return os.path.join(plugin_root(), 'skills', 'axiomcode', 'scripts')

_SEEN_SERVER = [None, False]                    # (stat signature of the current server.py, whether it differs from this one)

def stale_note(root=None):
    """one line when the install's server.py is not the one this process runs (so its tools and parameters are the old
    ones), else ''"""
    cur = os.path.join(root or plugin_root(), 'mcp', 'server.py')
    try: st = os.stat(cur)
    except OSError: return ''
    if _SELF_ST is None: return ''
    if (st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size) == (_SELF_ST.st_dev, _SELF_ST.st_ino, _SELF_ST.st_mtime_ns, _SELF_ST.st_size): return ''
    sig = (cur, st.st_dev, st.st_ino, st.st_mtime_ns, st.st_size)
    if _SEEN_SERVER[0] != sig:
        try: differs = open(cur, 'rb').read() != _SELF_TEXT
        except OSError: differs = False
        _SEEN_SERVER[0], _SEEN_SERVER[1] = sig, differs
    if not _SEEN_SERVER[1]: return ''
    return (f"WARNING: this axiomcode MCP server is older than the install ({os.path.dirname(os.path.dirname(_SELF))} is running, "
            f"{os.path.realpath(root or plugin_root())} is installed); the answer below comes from the install's scripts, but the "
            f"tools and their parameters are the old server's until it is restarted (reconnect the axiomcode MCP server in the "
            f"client, or restart the agent session).")

_LOADED = [None, set()]                         # (signature of the scripts the in-process modules came from, their dirs)

def scripts_module(name):
    """a module of the skill's scripts (ax_fresh, ax_contract) as the current install has it: when the install moved since
    the last import, every module imported from a scripts directory is dropped and imported again from the current one"""
    import importlib
    d = scripts_dir()
    try: st = os.stat(os.path.join(d, 'ax_fresh.py')); sig = (d, st.st_dev, st.st_ino, st.st_mtime_ns)
    except OSError: sig = (d,)
    if _LOADED[0] != sig:
        old = {os.path.normcase(os.path.abspath(x)) for x in _LOADED[1] | {d}}
        for k, m in list(sys.modules.items()):
            f = getattr(m, '__file__', None)
            if f and os.path.normcase(os.path.dirname(os.path.abspath(f))) in old: del sys.modules[k]
        sys.path[:] = [x for x in sys.path if os.path.normcase(os.path.abspath(x or '.')) not in old or not x]
        sys.path.insert(0, d)
        importlib.invalidate_caches()
        _LOADED[0] = sig; _LOADED[1].add(d)
    return importlib.import_module(name)

# THE CLI'S WORDS, SPELLED AS THIS SURFACE SPELLS THEM (#1567). The answers are the CLI's, so their hints name CLI
# flags (`--in <path>`, `--tests-only`, `--limit N`); an agent that sent those back as `in=`, `tests_only=` had them
# dropped without a word by the SDK, which ignores an argument it does not know, and got the unnarrowed answer as if
# it had been narrowed. So an argument no tool parameter answers to is refused, naming the parameter the CLI flag is
# here, and every flag in an answer that is a parameter here is written as that parameter. Flags only the CLI has
# (--json, --lang on a query) are left as they are.
PARAM = {'--in': 'in_path', '--tests-only': 'tests', '--tests': 'tests', '--tests-in': 'tests_in', '--from': 'from_',
         '--why': 'why', '--source': 'source', '--explain': 'explain', '--every': 'every', '--staged': 'staged',
         '--impact': 'impact', '--delete': 'delete', '--depth': 'depth', '--limit': 'limit', '--page': 'page',
         '--budget': 'budget', '--kind': 'kind', '--range': 'range', '--fresh': 'fresh', '--no-refresh': 'refresh'}
# a CLI switch that turns a parameter OFF: `--no-refresh` is refresh=False here
NEGATED = {'--no-refresh'}
SWITCH = {'--tests-only', '--tests', '--why', '--source', '--explain', '--every', '--staged', '--impact', '--delete', '--fresh'}
PARAMS = {}                                     # tool name -> its parameter names, filled as the tools are declared
# a flag, and its value when what follows looks like one (<path>, 'x', N, 2, a.b, src/x) rather than prose ("no --in was given")
_FLAG = re.compile(r"(?<![\w-])(--[a-z][a-z-]*)(?![\w-])"
                   r"(?:([ =])(<[^>]*>|'[^']*'|N(?:\|all)?(?![\w])|\d+(?![\w])|all(?![\w])|[a-z](?![\w.])|[\w*-]*[/.:*][^\s`'\"(),;\]]*))?")
# a line of quoted source (context --source), or a site of a grep-shaped answer (`path:line: code  [tag]`, whose tag
# names no flag): never rewritten, since the code on it is the file's own text
_CODE = re.compile(r'^\s*(\d+ )?\| |^[^\s:]+:\d+: ')

def mcp_words(text):
    """An answer with each CLI flag that is an MCP parameter written as that parameter: `--in <path>` -> `in_path=<path>`,
    `--tests-only` -> `tests=True`, `--limit N` -> `limit=N`. Lines of quoted code are left alone."""
    def one(m):
        flag, sep, val = m.groups()
        p = PARAM.get(flag)
        if not p: return m.group(0)
        if flag in SWITCH: return f"{p}=True" + (sep + val if val else '')
        if flag in NEGATED: return f"{p}=False" + (sep + val if val else '')
        if val == 'all': return f'{p}="all"'                   # `--page all` is page="all", a string, not a name
        if val == 'N|all': return f'{p}=N or {p}="all"'
        return f"{p}={val}" if val else p
    return '\n'.join(l if _CODE.match(l) else _FLAG.sub(one, l) for l in text.split('\n'))

def unknown_arguments(name, arguments):
    """Why a call names an argument the tool does not take, with the parameter meant when it is a CLI flag's name
    (in -> in_path, tests_only -> tests, from -> from_), or None when every argument is a parameter."""
    params = PARAMS.get(name)
    extra = [k for k in (arguments or {}) if params is not None and k not in params]
    if not extra: return None
    said = []
    for k in extra:
        meant = PARAM.get('--' + k.lstrip('-').replace('_', '-'))
        said.append(f"{k}: unexpected argument" + (f" (the CLI's --{k.lstrip('-').replace('_', '-')} is {meant}= here)"
                                                    if meant in params else ''))
    return f"invalid arguments for {name}: " + '; '.join(said) + f". {name} takes: {', '.join(params)}"

try:
    import importlib
    ToolError = importlib.import_module(MCPServer.__module__.rsplit('.', 1)[0] + '.exceptions').ToolError
except Exception:
    ToolError = ValueError

class Server(MCPServer):
    def tool(self, *a, **k):
        deco = super().tool(*a, **k)
        def register(fn):
            PARAMS[k.get('name') or fn.__name__] = list(inspect.signature(fn).parameters)
            return deco(fn)
        return register

    def refuse(self, name, arguments):                      # the fallback asks this before its own schema check
        return unknown_arguments(name, arguments)

    async def call_tool(self, name, arguments, *a, **k):    # the SDK: refused as a tool error, as its own validation is
        bad = unknown_arguments(name, arguments)
        if bad: raise ToolError(bad)
        return await super().call_tool(name, arguments, *a, **k)

srv = Server('axiomcode')

# launch.js hands over the bash it chose, because on Windows a bare `bash` is WSL's or nothing (#1233).
BASH = os.environ.get('AXIOMCODE_BASH') or 'bash'

# THE TIMER (#1305). The hooks refresh the graph while an agent works; an edit made in an editor or a terminal while the
# session sits idle is caught only at the next prompt. The server lives as long as the session, so once
# AXIOMCODE_REFRESH_INTERVAL seconds (default 900, 15 minutes; 0 turns it off) have passed since the LAST UPDATE of a
# repository it has answered for (a refresh, or a check by an edit, a prompt, a query or the timer itself) it asks the
# refresher to look: a rebuild if a file changed or HEAD moved, otherwise only the time of the check is recorded. An
# active session updates that time itself, so the timer mostly fires for one that has gone quiet. Like the hooks, the
# timer never rebuilds a graph another axiomcode built (ax_fresh.hook_kick): only a query or `index` does, saying so.
SEEN = set()
# the flags whose next argument is their value, as the dispatcher skips them when it looks for the repository
VALUED = {'--in', '--from', '--budget', '--seeds', '--depth', '--limit', '--tests-in', '--kind', '--range', '--old',
          '--new', '--file', '--page', '--page-budget', '--out'}
def _timer(interval):
    import time
    while True:
        time.sleep(max(1.0, min(60.0, interval / 3)))
        for repo in list(SEEN):
            try:
                fresh = scripts_module('ax_fresh')
                if time.time() - fresh.last_update(repo) >= interval: fresh.hook_kick(repo, 'the timer')
            except Exception: pass

def run(args, cwd=None, timeout=900):
    for a in args[1:]:
        if os.path.isdir(a) and os.path.isdir(os.path.join(a, '.axiomcode')): SEEN.add(os.path.realpath(a))
    # A QUERY ON A REPOSITORY WITH NO GRAPH YET does not hold the call for the length of a first build (minutes; past this
    # server's timeout it came back as a bare "Error executing tool"): the build is started in the background and the
    # answer says what stage it is at (ax_contract.ensure_graph). `index` is asked for a build and still waits for it.
    env = dict(os.environ, AXIOMCODE_BUILD_NOWAIT='1', AXIOMCODE_SURFACE='mcp') if args and args[0] != 'index' else None
    root = plugin_root()
    ax = os.path.join(root, 'skills', 'axiomcode', 'scripts', 'axiomcode')
    note = stale_note(root)
    head = (note + '\n') if note else ''
    try:
        r = subprocess.run([BASH, ax, *args], cwd=cwd or None, capture_output=True, text=True, timeout=timeout, env=env)
    except OSError as e:
        return (f"axiomcode could not start bash ({BASH}): {e}. On Windows it needs the bash that comes with "
                "Git for Windows; install it, or set AXIOMCODE_BASH to its bin\\bash.exe.")
    except subprocess.TimeoutExpired:
        # a flag's value (`--in <dir>`) is not the repository
        pos = [a for i, a in enumerate(args[1:], 1) if args[i - 1] not in VALUED]
        repo = next((a for a in reversed(pos) if os.path.isdir(a)), cwd or os.getcwd())
        try:
            ax_fresh = scripts_module('ax_fresh'); ax_contract = scripts_module('ax_contract')
            if ax_fresh.building(os.path.realpath(repo)): return head + ax_contract.building_note(os.path.realpath(repo))
        except Exception: pass
        return head + (f"axiomcode {args[0] if args else ''} did not answer within {timeout} s. Nothing was changed; "
                       f"see {os.path.join(repo, '.axiomcode', 'build.log')} if a build was running, and ask again.")
    out = (r.stdout or '') + (('\n' + r.stderr.strip()) if r.returncode and r.stderr.strip() else '')
    # an answer given from a graph that predates some edit says so, and names the files (#1305); one given from a graph a
    # fallback engine built, in place of the checkout's own, names that engine
    if not r.returncode: out += ''.join('\n' + l for l in (r.stderr or '').splitlines() if l.startswith(('graph refresh:', 'graph built by:')))
    return head + (mcp_words(out.strip()) or f"(no output, exit {r.returncode})")

# SITES, ONE PER LINE, BY DEFAULT. When the answer is a list of sites (who uses it, the hops of a chain, where a task
# lands, the tests to run) it comes the way grep prints: `path:line: code  [resolved | one of a set | text | hop N]`,
# capped, the rest counted (scripts/ax_grep.py). The prose answer's sections, headers and explanations were most of what
# an agent read, and the fan-out it complained of. full=True, or asking for what only the prose carries (the code of a
# flow, test routes, a delete verdict, a later page), gives the verb's own answer, unchanged.
# A PAGE IS A NUMBER OR "all". The answers say `--page all` for the whole answer; the parameter took only an integer, so
# the hint could not be followed here, and an agent that sent page="all" was refused. page=2 and page="2" are page 2.
Page = typing.Union[int, str]

def _page_arg(page):
    p = str(page).strip().lower() if page is not None else '1'
    if p == 'all': return 'all'
    if not p.lstrip('-').isdigit():
        raise ToolError(f'page: expected a page number or "all", got {page!r}')
    return None if int(p) == 1 else str(int(p))

def _paged(page):
    return _page_arg(page) is not None

def _pg(page):
    v = _page_arg(page)
    return ['--page', v] if v else []

def NOREF(refresh):
    """refresh=False is the CLI's --no-refresh: a read-only query, which starts no rebuild of the graph"""
    return [] if refresh else ['--no-refresh']

def grep(full, limit=0):
    return [] if full else ['--grep'] + (['--grep-limit', str(limit)] if limit else [])

@srv.tool()
def axiomcode_index(repo: str = ".", lang: str = '', src: str = '', library: str = '') -> str:
    """Build (or refresh) the call graph of a repository: parser → engine → <repo>/.axiomcode/out/graph.sqlite. Run once before path/impact/graph. lang: java|typescript|python|javascript|csharp when the repo mixes languages; src: subtree to analyse (e.g. src); library: comma-separated dependency roots so calls into them resolve."""
    a = ['index', repo] + (['--lang', lang] if lang else []) + (['--src', src] if src else []) + (['--library', library] if library else [])
    return run(a)

@srv.tool()
def axiomcode_context(task: str, repo: str = ".", in_path: str = '', budget: int = 0, source: bool = False, page: Page = 1, explain: bool = False, from_: str = '', fresh: bool = False, full: bool = False, limit: int = 0, refresh: bool = True) -> str:
    """[resolved]/[sound] rows are verified against the graph; the answer ends with `next:`, the one step to take. START HERE when you have a task in words and no name to ask about yet. A task that asks HOW something works ("how does X …", "explain …", or explain=True) also gets the call FLOW — every step in the order the calls are written, with ⚠ where the graph lost a call; from_ (comma-separated names) starts the flow where you choose. Pass source=True with it: each step then carries its code, so answer from that and open a file only for a step whose body was cut or a ⚠ call. Otherwise it returns the files and callables that task touches, from the problem statement alone. Deterministic — task terms scored against the graph's vocabulary by inverse document frequency, tests demoted, the closure walked from the best seed per term and ranked by nearest hop. in_path accepts SEVERAL paths, comma-separated: they are combined rather than intersected, so a change spanning two roots comes back in one call. budget is how many files are listed (default 12; the ranking is the same at any budget); source=True includes the code. A long answer comes in pages; ask for page=2 only if page 1's files are not enough. Ends by saying what it could not see. Without source/explain/from_ the answer is one site per line (`path:line: code  [tag]`), capped with a count of the rest; limit=N lists more, full=True gives the prose. After an edit the answer comes at once from the last graph, rows in edited files marked (may be out of date); fresh=True waits for the rebuild. refresh=False: read-only, answers from the graph as it is and never starts a rebuild (an answer that did start one says so on its first line)."""
    flow = source or explain or from_.strip() or _paged(page) or budget
    a = ['context', task, repo] + grep(full or flow, limit) + (['--fresh'] if fresh else []) + (['--in', in_path] if in_path else []) + (['--budget', str(budget)] if budget else []) + (['--source'] if source else []) + _pg(page) + (['--explain'] if explain else []) + [x for n in from_.split(',') if n.strip() for x in ('--from', n.strip())]
    return run(a + NOREF(refresh))

@srv.tool()
def axiomcode_path(from_: str, to: str, repo: str = ".", every: bool = False, in_path: str = '', depth: int = 0, limit: int = 0, page: Page = 1, fresh: bool = False, full: bool = False, refresh: bool = True) -> str:
    """[resolved]/[sound] rows are verified against the graph, so a change need not re-derive them by reading (to explain how something works, read each hop's body); the answer ends with `next:`, the one step to take. A chain of calls from A to B in the graph, each hop verified, or why there is none. When you have ONE concept word you can name, a bare fragment resolves to every declaration containing it, so path('decrypt', '*') answers "what is the decryption code and what does it touch". For a whole task in words, with no name at all, use axiomcode_context first. Endpoints otherwise as written in the code: Owner.method, method, Type, Outer$Inner.m, file.java:123, file.py, @Decoration, a library call as written (new File, Files.readAllBytes). '*' on one side = everything that reaches B / everything A reaches. every=True lists every route; in_path restricts to files containing it; depth bounds a closure. A long answer comes in pages, nearest routes first, with the whole answer's counts on every page; ask for page=2 only if page 1 is not enough. fresh=True: after an edit, wait for the rebuild instead of answering from the last graph with rows in edited files marked (may be out of date). The answer is one site per line, each hop at the line its call is written on (`path:line: code  [resolved · hop 1/3 → B]`); full=True gives the prose, which also says why when there is no chain. refresh=False: read-only, answers from the graph as it is and never starts a rebuild (an answer that did start one says so on its first line)."""
    paged = _paged(page)
    a = ['path', from_, to, repo] + grep(full or paged, limit) + (['--fresh'] if fresh else []) + (['--every'] if every else []) + (['--in', in_path] if in_path else []) + (['--depth', str(depth)] if depth else []) + (['--limit', str(limit)] if limit and (full or paged) else []) + (['--page', str(page)] if paged else [])
    return run(a + NOREF(refresh))

@srv.tool()
def axiomcode_impact(targets: list[str], repo: str = ".", tests: bool = False, why: bool = False, tests_in: str = '', depth: int = 0, in_path: str = '', kind: str = '', page: Page = 1, budget: int = 0, limit: int = 0, delete: bool = False, fresh: bool = False, full: bool = False, refresh: bool = True) -> str:
    """Trust it: [resolved]/[sound] rows are verified against the graph, so do not re-derive them by reading; the answer ends with `next:`, the one step to take. What has to be looked at again when a declaration changes: must-change-with-it (overrides, subtypes), everything that directly uses it (with how sure each is), everything that reaches those, and the bound (unresolved calls). The tests are always counted, by rung, with the strong-route ones named and the top test files. Ask for the full list SECOND, only if you need it: tests=True returns ONLY the tests, grouped by rung and test file (the CLI's --tests-only); why=True adds each test's route; tests_in narrows that listing to test files containing it. Long answers come in pages of ~2000 tokens: every page carries the counts of the WHOLE answer and the rows come strongest first, so page 1 is usually enough; page=2 continues with the rows page 1 did not print (a one-page answer says there is no page 2), page="all" gives every row. budget changes the page size. Targets as written: Owner.method, Owner.field, Type, Owner.method(param), Type<T>, Owner.method:local, or file.ts:123 (the declaration at that line). When you know where the declaration is, target it by file:line: a bare name answers for EVERY declaration of that name, and two unrelated functions in different files come back as one answer. kind: method|field|type|param|typeparam|var when a name is declared as several kinds. limit: rows shown per section (the `… +N (limit=N)` lines); delete=True adds a verdict on whether it is safe to delete. fresh=True: after an edit, wait for the rebuild (use it before a delete or a rename) instead of answering from the last graph with rows in edited files marked (may be out of date). The answer is one site per line, surest first (`path:line: code  [resolved | one of a set | by name | text | hop N | test]`), capped with a count of the rest; full=True gives the sectioned prose (why, delete, budget and page give it too). refresh=False: read-only, answers from the graph as it is and never starts a rebuild (an answer that did start one says so on its first line)."""
    prose = full or why or delete or _paged(page) or budget
    a = ['impact', *targets, repo] + grep(prose, limit) + (['--fresh'] if fresh else []) + (['--tests-only'] if tests else []) + (['--why'] if why else []) + (['--tests-in', tests_in] if tests_in else []) + (['--depth', str(depth)] if depth else []) + (['--in', in_path] if in_path else []) + (['--kind', kind] if kind else []) + _pg(page) + (['--budget', str(budget)] if budget else []) + (['--limit', str(limit)] if limit and prose else []) + (['--delete'] if delete else [])
    return run(a + NOREF(refresh))

@srv.tool()
def axiomcode_changed(repo: str = ".", files: list[str] = [], range: str = '', staged: bool = False, impact: bool = False, page: Page = 1, refresh: bool = True) -> str:
    """Which declarations an edit changed and HOW — signature (parameters added / removed / retyped, return type), field (its type, name, initializer), type header, body only, removed, added (a new file is one `added` line) — the working tree against the commit the graph was built from (default), your branch's commits (range='a..b': read from `git merge-base a b`, so commits a received after you branched are not yours; a note says so when a has moved), or the index (staged=True); each with the target impact takes. When the working tree is clean but HEAD has commits of its own, it says which range=... to ask. files=[...] limits it to those files; on a copy without git (which it refuses otherwise) every declaration in a named file counts as changed. Changed files outside every indexed language (fixtures, case data, a schema) are named, never dropped. impact=True runs impact on all of them as one change set and returns its answer. refresh=False: read-only, answers from the graph as it is and never starts a rebuild (an answer that did start one says so on its first line)."""
    a = ['changed', repo, *files] + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--impact'] if impact else []) + _pg(page)
    return run(a + NOREF(refresh))

@srv.tool()
def axiomcode_test_impact(repo: str = ".", files: list[str] = [], range: str = '', staged: bool = False, in_path: str = '', limit: int = 0, why: bool = False, page: Page = 1, full: bool = False, refresh: bool = True) -> str:
    """Which tests actually have to run for the edit in front of you: the test files that reach any changed declaration, with the chain, so the selection can be checked rather than trusted, and the command that runs them. Working tree by default; range='a..b' for your branch's commits (from `git merge-base a b`, so a base branch that moved on is not counted as your change); staged=True for the index; files=[...] for named files (a named file with no edit, or any on a copy without git, counts whole: the tests of everything in it). An edited test file is itself listed to run. Changed files outside every indexed language (fixtures, case data) are named with the test files that name them in their text. Conservative by design — a test reached only through an edge the graph does not encode (reflection, a service loader, a subprocess, a runtime-built case) will NOT appear, so it is a lower bound. why=True prints the chain for each. The answer is one test per line (`path:line: code  [test · resolved · hop N]`), capped with a count of the rest, and the command that runs them; limit=N lists more, full=True gives the prose. refresh=False: read-only, answers from the graph as it is and never starts a rebuild (an answer that did start one says so on its first line)."""
    prose = full or why or _paged(page)
    a = ['test-impact', repo, *files] + grep(prose, limit) + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--in', in_path] if in_path else []) + (['--limit', str(limit)] if limit and prose else []) + (['--why'] if why else []) + _pg(page)
    return run(a + NOREF(refresh))

@srv.tool()
def axiomcode_graph(repo: str = ".", out: str = '', refresh: bool = True) -> str:
    """Draw the graph as one interactive HTML page, for a person: every language the repository was indexed in, at <repo>/.axiomcode/graph/graph.html or out=<folder|page.html>. Drawn from the existing graph when it is up to date (seconds, no engine run); a graph that is out of date is rebuilt first with the --lang, --src and --library it was indexed with, never for a language the index left out; with no graph yet the repository is indexed first. Answers with what it drew, in prose, and the page's absolute path. refresh=False: drawn from the graph as it is, never rebuilt first."""
    return run(['graph', repo] + (['--out', out] if out else []) + NOREF(refresh))

@srv.tool()
def axiomcode_diff(graph_a: str, graph_b: str, file: str = '', lang: str = '', limit: int = 40, as_json: bool = False) -> str:
    """What changed between two graphs of the SAME tree, e.g. one tree copied and indexed before and after an engine or rules change: call edges added, removed, retiered (same callee, another tier) or re-targeted (a site whose callees changed), entry points with their reason, remote and framework edges, config bindings and symbols, and the call edges per tier (A -> B). graph_a / graph_b: a graph.sqlite, or an indexed directory (every language graph in it, paired by language). Rows are matched by file, line, column, qualified name and callee, never by id (ids hash the index directory), so one tree indexed at two paths diffs to nothing. Neither graph is rebuilt. file keeps the rows with a file containing it; limit: rows per section (default 40, 0 for all; the counts are always of the whole diff); as_json=True gives every row."""
    return run(['diff', graph_a, graph_b] + (['--file', file] if file else []) + (['--lang', lang] if lang else []) + ['--limit', str(limit)] + (['--json'] if as_json else []))

if __name__ == '__main__':
    # catch up on whatever changed while no session was running (#1305): started, never waited on
    try:
        scripts_module('ax_fresh').hook_kick(os.getcwd(), 'the MCP server starting')
        if os.path.isdir(os.path.join(os.getcwd(), '.axiomcode')): SEEN.add(os.path.realpath(os.getcwd()))
        interval = float(os.environ.get('AXIOMCODE_REFRESH_INTERVAL') or 900)
        if interval > 0:
            import threading; threading.Thread(target=_timer, args=(interval,), daemon=True).start()
    except Exception:
        pass
    srv.run()
