#!/usr/bin/env python3
"""The axiomcode entry as MCP tools — one tool per subcommand, each a thin shell-out to scripts/axiomcode so the answer is
exactly what the CLI prints (and stays verified there). Descriptions are short on purpose: they sit in the agent's context every turn."""
import os, subprocess, sys
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

ROOT = os.environ.get('AXIOMCODE_PLUGIN_ROOT') or os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
AX = os.path.join(ROOT, 'skills', 'axiomcode', 'scripts', 'axiomcode')
srv = MCPServer('axiomcode')

# launch.js hands over the bash it chose, because on Windows a bare `bash` is WSL's or nothing (#1233).
BASH = os.environ.get('AXIOMCODE_BASH') or 'bash'

# THE TIMER (#1305). The hooks refresh the graph while an agent works; an edit made in an editor or a terminal while the
# session sits idle is caught only at the next prompt. The server lives as long as the session, so once
# AXIOMCODE_REFRESH_INTERVAL seconds (default 900, 15 minutes; 0 turns it off) have passed since the LAST UPDATE of a
# repository it has answered for (a refresh, or a check by an edit, a prompt, a query or the timer itself) it asks the
# refresher to look: a rebuild if a file changed or HEAD moved, otherwise only the time of the check is recorded. An
# active session updates that time itself, so the timer mostly fires for one that has gone quiet.
SEEN = set()
def _timer(interval):
    import time
    while True:
        time.sleep(max(1.0, min(60.0, interval / 3)))
        for repo in list(SEEN):
            try:
                if time.time() - ax_fresh.last_update(repo) >= interval: ax_fresh.kick(repo, trigger='the timer')
            except Exception: pass

def run(args, cwd=None, timeout=900):
    for a in args[1:]:
        if os.path.isdir(a) and os.path.isdir(os.path.join(a, '.axiomcode')): SEEN.add(os.path.realpath(a))
    try:
        r = subprocess.run([BASH, AX, *args], cwd=cwd or None, capture_output=True, text=True, timeout=timeout)
    except OSError as e:
        return (f"axiomcode could not start bash ({BASH}): {e}. On Windows it needs the bash that comes with "
                "Git for Windows; install it, or set AXIOMCODE_BASH to its bin\\bash.exe.")
    out = (r.stdout or '') + (('\n' + r.stderr.strip()) if r.returncode and r.stderr.strip() else '')
    # an answer given from a graph that predates some edit says so, and names the files (#1305)
    if not r.returncode: out += ''.join('\n' + l for l in (r.stderr or '').splitlines() if l.startswith('graph refresh:'))
    return out.strip() or f"(no output, exit {r.returncode})"

@srv.tool()
def axiomcode_index(repo: str = ".", lang: str = '', src: str = '', library: str = '') -> str:
    """Build (or refresh) the call graph of a repository: parser → engine → <repo>/.axiomcode/out/graph.sqlite. Run once before path/impact/graph. lang: java|typescript|python|javascript when the repo mixes languages; src: subtree to analyse (e.g. src); library: comma-separated dependency roots so calls into them resolve."""
    a = ['index', repo] + (['--lang', lang] if lang else []) + (['--src', src] if src else []) + (['--library', library] if library else [])
    return run(a)

@srv.tool()
def axiomcode_context(task: str, repo: str = ".", in_path: str = '', budget: int = 0, source: bool = False, page: int = 1, explain: bool = False, from_: str = '') -> str:
    """[resolved]/[sound] rows are verified against the graph; the answer ends with `next:`, the one step to take. START HERE when you have a task in words and no name to ask about yet. A task that asks HOW something works ("how does X …", "explain …", or explain=True) also gets the call FLOW — every step in the order the calls are written, with ⚠ where the graph lost a call; from_ (comma-separated names) starts the flow where you choose. Pass source=True with it: each step then carries its code, so answer from that and open a file only for a step whose body was cut or a ⚠ call. Otherwise it returns the files and callables that task touches, from the problem statement alone. Deterministic — task terms scored against the graph's vocabulary by inverse document frequency, tests demoted, the closure walked from the best seed per term and ranked by nearest hop. in_path accepts SEVERAL paths, comma-separated: they are combined rather than intersected, so a change spanning two roots comes back in one call. budget is how many files are listed (default 12; the ranking is the same at any budget); source=True includes the code. A long answer comes in pages; ask for page=2 only if page 1's files are not enough. Ends by saying what it could not see."""
    a = ['context', task, repo] + (['--in', in_path] if in_path else []) + (['--budget', str(budget)] if budget else []) + (['--source'] if source else []) + (['--page', str(page)] if page and page != 1 else []) + (['--explain'] if explain else []) + [x for n in from_.split(',') if n.strip() for x in ('--from', n.strip())]
    return run(a)

@srv.tool()
def axiomcode_path(from_: str, to: str, repo: str = ".", every: bool = False, in_path: str = '', depth: int = 0, limit: int = 0, page: int = 1) -> str:
    """[resolved]/[sound] rows are verified against the graph, so a change need not re-derive them by reading (to explain how something works, read each hop's body); the answer ends with `next:`, the one step to take. A chain of calls from A to B in the graph, each hop verified, or why there is none. When you have ONE concept word you can name, a bare fragment resolves to every declaration containing it, so path('decrypt', '*') answers "what is the decryption code and what does it touch". For a whole task in words, with no name at all, use axiomcode_context first. Endpoints otherwise as written in the code: Owner.method, method, Type, Outer$Inner.m, file.java:123, file.py, @Decoration, a library call as written (new File, Files.readAllBytes). '*' on one side = everything that reaches B / everything A reaches. every=True lists every route; in_path restricts to files containing it; depth bounds a closure. A long answer comes in pages, nearest routes first, with the whole answer's counts on every page; ask for page=2 only if page 1 is not enough."""
    a = ['path', from_, to, repo] + (['--every'] if every else []) + (['--in', in_path] if in_path else []) + (['--depth', str(depth)] if depth else []) + (['--limit', str(limit)] if limit else []) + (['--page', str(page)] if page and page != 1 else [])
    return run(a)

@srv.tool()
def axiomcode_impact(targets: list[str], repo: str = ".", tests: bool = False, why: bool = False, tests_in: str = '', depth: int = 0, in_path: str = '', kind: str = '', page: int = 1, budget: int = 0) -> str:
    """Trust it: [resolved]/[sound] rows are verified against the graph, so do not re-derive them by reading; the answer ends with `next:`, the one step to take. What has to be looked at again when a declaration changes: must-change-with-it (overrides, subtypes), everything that directly uses it (with how sure each is), everything that reaches those, and the bound (unresolved calls). The tests are always counted, by rung, with the strong-route ones named and the top test files. Ask for the full list SECOND, only if you need it: tests=True returns ONLY the tests, grouped by rung and test file; why=True adds each test's route; tests_in narrows that listing to test files containing it. Long answers come in pages of ~2000 tokens: every page carries the counts of the WHOLE answer and the rows come strongest first, so page 1 is usually enough; ask for page=2 only if you need the weaker rows. budget changes the page size. Targets as written: Owner.method, Owner.field, Type, Owner.method(param), Type<T>, Owner.method:local, or file.ts:123 (the declaration at that line). When you know where the declaration is, target it by file:line: a bare name answers for EVERY declaration of that name, and two unrelated functions in different files come back as one answer. kind: method|field|type|param|typeparam|var when a name is declared as several kinds."""
    a = ['impact', *targets, repo] + (['--tests-only'] if tests else []) + (['--why'] if why else []) + (['--tests-in', tests_in] if tests_in else []) + (['--depth', str(depth)] if depth else []) + (['--in', in_path] if in_path else []) + (['--kind', kind] if kind else []) + (['--page', str(page)] if page and page != 1 else []) + (['--budget', str(budget)] if budget else [])
    return run(a)

@srv.tool()
def axiomcode_changed(repo: str = ".", files: list[str] = [], range: str = '', staged: bool = False, impact: bool = False, page: int = 1) -> str:
    """Which declarations an edit changed and HOW — signature (parameters added / removed / retyped, return type), field (its type, name, initializer), type header, body only, removed, added — the working tree against the commit the graph was built from (default), two commits (range='a..b'), or the index (staged=True); each with the target impact takes. impact=True runs impact on all of them as one change set and returns its answer."""
    a = ['changed', repo, *files] + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--impact'] if impact else []) + (['--page', str(page)] if page and page != 1 else [])
    return run(a)

@srv.tool()
def axiomcode_test_impact(repo: str = ".", range: str = '', staged: bool = False, in_path: str = '', limit: int = 0, why: bool = False, page: int = 1) -> str:
    """Which tests actually have to run for the edit in front of you: the test files that reach any changed declaration, with the chain, so the selection can be checked rather than trusted. Working tree by default, or range='a..b', or staged=True. Conservative by design — a test reached only through an edge the graph does not encode (reflection, a service loader, a runtime-built case) will NOT appear, so it is a lower bound. why=True prints the chain for each."""
    a = ['test-impact', repo] + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--in', in_path] if in_path else []) + (['--limit', str(limit)] if limit else []) + (['--why'] if why else []) + (['--page', str(page)] if page and page != 1 else [])
    return run(a)

@srv.tool()
def axiomcode_graph(repo: str = ".", out: str = '') -> str:
    """Draw the graph as one interactive HTML page (<repo>/.axiomcode/graph/graph.html, or out=<folder|page.html>); runs index first if there is no graph yet."""
    return run(['graph', repo] + (['--out', out] if out else []))

if __name__ == '__main__':
    # catch up on whatever changed while no session was running (#1305): started, never waited on
    try:
        sys.path.insert(0, os.path.dirname(AX)); import ax_fresh; ax_fresh.kick(os.getcwd(), trigger='the MCP server starting')
        if os.path.isdir(os.path.join(os.getcwd(), '.axiomcode')): SEEN.add(os.path.realpath(os.getcwd()))
        interval = float(os.environ.get('AXIOMCODE_REFRESH_INTERVAL') or 900)
        if interval > 0:
            import threading; threading.Thread(target=_timer, args=(interval,), daemon=True).start()
    except Exception:
        pass
    srv.run()
