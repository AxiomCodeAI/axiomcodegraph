#!/usr/bin/env python3
"""The axiomcode entry as MCP tools — one tool per subcommand, each a thin shell-out to scripts/axiomcode so the answer is
exactly what the CLI prints (and stays verified there). Descriptions are short on purpose: they sit in the agent's context every turn."""
import os, subprocess, sys
from mcp.server.mcpserver import MCPServer

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
def axiomcode_path(from_: str, to: str, repo: str, every: bool = False, in_path: str = '', depth: int = 0, limit: int = 0) -> str:
    """A chain of calls from A to B in the graph, each hop verified, or why there is none. Endpoints exactly as written in the code: Owner.method, method, Type, Outer$Inner.m, file.java:123, file.py, @Decoration, a library call as written (new File, Files.readAllBytes). '*' on one side = everything that reaches B / everything A reaches. every=True lists every route; in_path restricts to files containing it; depth bounds a closure."""
    a = ['path', from_, to, repo] + (['--every'] if every else []) + (['--in', in_path] if in_path else []) + (['--depth', str(depth)] if depth else []) + (['--limit', str(limit)] if limit else [])
    return run(a)

@srv.tool()
def axiomcode_impact(targets: list[str], repo: str, tests: bool = False, depth: int = 0, in_path: str = '', kind: str = '') -> str:
    """What has to be looked at again when a declaration changes: must-change-with-it (overrides, subtypes), everything that directly uses it (with how sure each is), everything that reaches those, the tests among them (tests=True), and the bound (unresolved calls). Targets as written: Owner.method, Owner.field, Type, Owner.method(param), Type<T>, Owner.method:local. kind: method|field|type|param|typeparam|var when a name is declared as several kinds."""
    a = ['impact', *targets, repo] + (['--tests'] if tests else []) + (['--depth', str(depth)] if depth else []) + (['--in', in_path] if in_path else []) + (['--kind', kind] if kind else [])
    return run(a)

@srv.tool()
def axiomcode_graph(repo: str, out: str = '') -> str:
    """Draw the graph as one interactive HTML page (<repo>/.axiomcode/graph/graph.html, or out=<folder|page.html>); runs index first if there is no graph yet."""
    return run(['graph', repo] + (['--out', out] if out else []))

if __name__ == '__main__':
    srv.run()
