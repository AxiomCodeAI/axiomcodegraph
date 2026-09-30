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
         '--budget': 'budget', '--kind': 'kind', '--range': 'range', '--fresh': 'fresh', '--no-refresh': 'refresh',
         '--drop': 'drop', '--exact': 'exact', '--alongside': 'alongside'}
# a CLI switch that turns a parameter OFF: `--no-refresh` is refresh=False here
NEGATED = {'--no-refresh'}
SWITCH = {'--tests-only', '--tests', '--why', '--source', '--explain', '--every', '--staged', '--impact', '--delete', '--fresh',
          '--exact', '--alongside'}
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
        if flag == '--drop' and val: return f'{p}=["{val}"]'   # a list of rows: `--drop a.ts:3` is drop=["a.ts:3"]
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

def run_group(argv, cwd=None, timeout=900, env=None):
    """subprocess.run(argv, capture_output=True, text=True, timeout=timeout), with the command in a process group of its
    own that is ended WHOLE when the timeout passes. subprocess.run kills only the bash it started, with SIGKILL, which no
    trap can see: an `index` that ran past the timeout left its engine compiling and solving with no caller (a C++
    compile at full CPU for half an hour after the call had answered). A build a query starts in the background is in a
    session of its own (ax_contract._start_build) and is not reached."""
    if os.name == 'nt':
        return subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=timeout, env=env)
    p = subprocess.Popen(argv, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env, start_new_session=True)
    try:
        out, err = p.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        stop_group(p.pid)
        try: p.communicate(timeout=10)          # a detached grandchild that kept a pipe must not hold this call
        except subprocess.TimeoutExpired: p.kill()
        raise
    return subprocess.CompletedProcess(argv, p.returncode, out, err)

def stop_group(pgid, grace=5.0):
    """TERM to process group `pgid`, then KILL to whatever of it is still there after `grace` seconds"""
    import signal, time
    try: os.killpg(pgid, signal.SIGTERM)
    except OSError: return
    end = time.time() + grace
    while time.time() < end:
        try: os.killpg(pgid, 0)
        except OSError: return
        time.sleep(0.1)
    try: os.killpg(pgid, signal.SIGKILL)
    except OSError: pass

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
        r = run_group([BASH, ax, *args], cwd=cwd or None, timeout=timeout, env=env)
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

# A REPOSITORY THAT IS NOT THERE IS REFUSED, NOT REPLACED. The dispatcher took the last argument that was a directory,
# else the working directory, so a repo= naming nothing answered for the server's working directory instead, and on one
# with no graph started a full build of it. The repo parameter is always the repository, so any value that is not a
# directory is an error that names it, and nothing is run.
def need_repo(repo):
    if repo and not os.path.isdir(repo):
        raise ToolError(f"repo: no such directory: {repo}. Nothing was built or asked; pass a directory that exists "
                        f"(an absolute path), or leave repo out to use {os.getcwd()}.")

# EVIDENCE FOR THE UNCERTAIN ROWS (scripts/ax_evidence.py): evidence="on" gives each of the five strongest rows that is
# not an exact edge the line that decides it and what stands on it; "off" turns it off; empty leaves AXIOMCODE_EVIDENCE
# (off by default) to decide. drop=[file:line] asks again without those rows, exact=True with exact edges only.
EV_DOC = (' evidence="on"|"off": each of the 5 strongest rows that is not an exact edge ([by name], [one of a set], '
          '[registered] …) carries the line that decides it (where its receiver or key gets its value) and how many '
          'callables and tests are reached only through it; drop=["file:line"] asks again without those rows, exact=True '
          'with exact edges only, alongside=True lists the `alongside` rows the evidence view counts.')

def ev(evidence='', drop=(), exact=False, alongside=False):
    e = str(evidence or '').strip().lower()
    a = (['--evidence'] if e in ('on', '1', 'true', 'yes') else ['--no-evidence'] if e in ('off', '0', 'false', 'no') else [])
    return a + [x for d in (drop or []) if str(d).strip() for x in ('--drop', str(d).strip())] + (['--exact'] if exact else []) + (['--alongside'] if alongside else [])

def _doc(f):
    f.__doc__ = (f.__doc__ or '') + EV_DOC
    return f

# THE FOUR TOOLS TAKE NO OPTIONS, so an answer never tells the agent to pass one. The notes the verbs add (a stale
# graph, a refresh in flight) are kept for what they say; a clause that names a flag or a parameter to set is dropped.
_OPTION = re.compile(r"(?<![\w-])--[a-z][a-z-]*|\b[a-z_]+=(?:True|False|N\b|<|\d|\"|')")
def plain(text):
    out = []; code = False
    for line in (text or '').split('\n'):
        if line.strip().startswith('```'): code = not code; out.append(line); continue
        if code or not _OPTION.search(line): out.append(line); continue      # a code block is the file's own text
        keep = [c for c in re.split(r'(?<=[;.])\s+|\s+—\s+', line) if not _OPTION.search(c)]
        if keep and ''.join(keep).strip(): out.append(' '.join(keep).rstrip(' ;,'))
    return '\n'.join(out)


# THE SMALL SURFACE. Three questions, each answered as numbered places with the code of the function each sits in, so
# a place is understood without opening its file. No options: the repository is the one the session works in.
@srv.tool()
def find(question: str) -> str:
    """Where the code for a task lives. Describe what you need in words (the feature, the behaviour, a name you saw);
    get the functions involved, each with its code, most relevant first. A name the code calls but nothing declares
    is listed with its call sites: that is code you have to write."""
    return plain(run(['find', question, os.getcwd()]))

@srv.tool()
def impact(name: str = '') -> str:
    """What a change reaches. With a name (as written in the code: Owner.method, function, Type, or file.py:123): who
    calls it, what depends on it further out, and which tests exercise it, each with its code. With no name: the same
    for the declarations your uncommitted edits changed."""
    return plain(run(['impact'] + ([name] if name.strip() else []) + [os.getcwd()]))

@srv.tool()
def path(start: str, end: str) -> str:
    """How one declaration reaches another: every hop of the call chain with the code at the line the call is
    written on. start / end as written in the code (Owner.method, function, Type)."""
    return plain(run(['path', start, end, os.getcwd()]))

@srv.tool()
def tests() -> str:
    """The tests your uncommitted edits reach, each with its code, and the command that runs exactly those."""
    return plain(run(['tests', os.getcwd()]))

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
