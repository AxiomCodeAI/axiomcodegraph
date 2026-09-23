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

def run(args, cwd=None, timeout=900):
    r = subprocess.run(['bash', AX, *args], cwd=cwd or None, capture_output=True, text=True, timeout=timeout)
    out = (r.stdout or '') + (('\n' + r.stderr.strip()) if r.returncode and r.stderr.strip() else '')
    return out.strip() or f"(no output, exit {r.returncode})"

@srv.tool()
def axiomcode_index(repo: str, lang: str = '', src: str = '', library: str = '') -> str:
    """Build (or refresh) the call graph of a repository: parser → engine → <repo>/.axiomcode/out/graph.sqlite. Run once before path/impact/graph. lang: java|typescript|python|javascript when the repo mixes languages; src: subtree to analyse (e.g. src); library: comma-separated dependency roots so calls into them resolve."""
    a = ['index', repo] + (['--lang', lang] if lang else []) + (['--src', src] if src else []) + (['--library', library] if library else [])
    return run(a)

@srv.tool()
def axiomcode_context(task: str, repo: str, in_path: str = '', budget: int = 0, source: bool = False) -> str:
    """START HERE when you have a task in words and no name to ask about yet: the files and callables that task touches, from the problem statement alone. Deterministic — task terms scored against the graph's vocabulary by inverse document frequency, tests demoted, the closure walked from the best seed per term and ranked by nearest hop. in_path accepts SEVERAL paths, comma-separated: they are combined rather than intersected, so a change spanning two roots comes back in one call. budget is how many files are listed (default 12; the ranking is the same at any budget); source=True includes the code. Ends by saying what it could not see."""
    a = ['context', task, repo] + (['--in', in_path] if in_path else []) + (['--budget', str(budget)] if budget else []) + (['--source'] if source else [])
    return run(a)

@srv.tool()
def axiomcode_path(from_: str, to: str, repo: str, every: bool = False, in_path: str = '', depth: int = 0, limit: int = 0) -> str:
    """A chain of calls from A to B in the graph, each hop verified, or why there is none. When you have ONE concept word you can name, a bare fragment resolves to every declaration containing it, so path('decrypt', '*') answers "what is the decryption code and what does it touch". For a whole task in words, with no name at all, use axiomcode_context first. Endpoints otherwise as written in the code: Owner.method, method, Type, Outer$Inner.m, file.java:123, file.py, @Decoration, a library call as written (new File, Files.readAllBytes). '*' on one side = everything that reaches B / everything A reaches. every=True lists every route; in_path restricts to files containing it; depth bounds a closure."""
    a = ['path', from_, to, repo] + (['--every'] if every else []) + (['--in', in_path] if in_path else []) + (['--depth', str(depth)] if depth else []) + (['--limit', str(limit)] if limit else [])
    return run(a)

@srv.tool()
def axiomcode_impact(targets: list[str], repo: str, tests: bool = False, why: bool = False, tests_in: str = '', depth: int = 0, in_path: str = '', kind: str = '') -> str:
    """What has to be looked at again when a declaration changes: must-change-with-it (overrides, subtypes), everything that directly uses it (with how sure each is), everything that reaches those, and the bound (unresolved calls). The tests are always counted, by rung, with the strong-route ones named and the top test files. Ask for the full list SECOND, only if you need it: tests=True returns ONLY the tests, grouped by rung and test file; why=True adds each test's route; tests_in narrows that listing to test files containing it. Targets as written: Owner.method, Owner.field, Type, Owner.method(param), Type<T>, Owner.method:local. kind: method|field|type|param|typeparam|var when a name is declared as several kinds."""
    a = ['impact', *targets, repo] + (['--tests-only'] if tests else []) + (['--why'] if why else []) + (['--tests-in', tests_in] if tests_in else []) + (['--depth', str(depth)] if depth else []) + (['--in', in_path] if in_path else []) + (['--kind', kind] if kind else [])
    return run(a)

@srv.tool()
def axiomcode_changed(repo: str, files: list[str] = [], range: str = '', staged: bool = False, impact: bool = False) -> str:
    """Which declarations an edit changed and HOW — signature (parameters added / removed / retyped, return type), field (its type, name, initializer), type header, body only, removed, added — the working tree against the commit the graph was built from (default), two commits (range='a..b'), or the index (staged=True); each with the target impact takes. impact=True runs impact on all of them as one change set and returns its answer."""
    a = ['changed', repo, *files] + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--impact'] if impact else [])
    return run(a)

@srv.tool()
def axiomcode_test_impact(repo: str, range: str = '', staged: bool = False, in_path: str = '', limit: int = 0, why: bool = False) -> str:
    """Which tests actually have to run for the edit in front of you: the test files that reach any changed declaration, with the chain, so the selection can be checked rather than trusted. Working tree by default, or range='a..b', or staged=True. Conservative by design — a test reached only through an edge the graph does not encode (reflection, a service loader, a runtime-built case) will NOT appear, so it is a lower bound. why=True prints the chain for each."""
    a = ['test-impact', repo] + (['--range', range] if range else []) + (['--staged'] if staged else []) + (['--in', in_path] if in_path else []) + (['--limit', str(limit)] if limit else []) + (['--why'] if why else [])
    return run(a)

@srv.tool()
def axiomcode_graph(repo: str, out: str = '') -> str:
    """Draw the graph as one interactive HTML page (<repo>/.axiomcode/graph/graph.html, or out=<folder|page.html>); runs index first if there is no graph yet."""
    return run(['graph', repo] + (['--out', out] if out else []))

if __name__ == '__main__':
    srv.run()
