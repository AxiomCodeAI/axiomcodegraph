#!/usr/bin/env python3
"""The axiomcode entry as MCP tools — one tool per subcommand, each a thin shell-out to scripts/axiomcode so the answer is
exactly what the CLI prints (and stays verified there). Descriptions are short on purpose: they sit in the agent's context every turn."""
import inspect, os, re, subprocess, sys
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

# AN ARGUMENT NO TOOL PARAMETER ANSWERS TO IS REFUSED (#1567): the SDK ignores an argument it does not know, so a
# call that sent one got the unnarrowed answer as if it had been narrowed. The tools take no options, so anything
# beyond their declared parameters is named back to the caller.
PARAMS = {}                                     # tool name -> its parameter names, filled as the tools are declared

def unknown_arguments(name, arguments):
    """Why a call names an argument the tool does not take, or None when every argument is a parameter."""
    params = PARAMS.get(name)
    extra = [k for k in (arguments or {}) if params is not None and k not in params]
    if not extra: return None
    said = [f"{k}: unexpected argument" for k in extra]
    return f"invalid arguments for {name}: " + '; '.join(said) + f". {name} takes: {', '.join(params) or 'no arguments'}"

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
    return head + (out.strip() or f"(no output, exit {r.returncode})")

# THE TOOLS TAKE NO OPTIONS, so an answer never tells the agent to pass one. The notes the verbs add (a stale
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


# THE SMALL SURFACE. Search is grep's job; the graph answers what grep cannot. Three questions, each answered as
# numbered places with the code of the function each sits in, so a place is understood without opening its file,
# plus context, the one narrative verb: a task in words answered as the verb's own flow. No options beyond
# context's source: the repository is the one the session works in.
@srv.tool()
def context(task: str, source: bool = False) -> str:
    """How something works, from a task in words: the files and callables the task touches, and for a "how does X
    work" question the call FLOW — every step in the order the calls are written, with ⚠ where the graph lost a
    call. source=True asks for the flow with each step's code, so it is read without opening files."""
    return plain(run(['context', task] + (['--source'] if source else []) + [os.getcwd()]))

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
