#!/usr/bin/env python3
"""tests/front_door.py — the four questions answer as numbered places with their code, at the front door only.

The product's surface is `find`, `impact`, `path` and `tests` (plus `index`), each answered as a numbered list of places,
every place with the code of the function it sits in, in a fenced block. That shape is given at the front doors — the
installed command (bin/axiomcode sets AXIOMCODE_FRONT) and the MCP server (AXIOMCODE_SURFACE=mcp) — when no flag is
passed. Everything that calls the dispatcher directly (the hooks, the case suite, loops) or passes a flag gets the verb's
own answer, unchanged.

  a. bin/axiomcode on a small repository (copied to a temporary directory, committed, indexed): find, impact <name> and
     path answer with numbered places and a fenced code block; after an edit, impact with no name starts with
     `your edits:`, and tests lists the test with its code and ends with a `run:` line.
  b. the MCP server lists exactly find, impact, path and tests, each with at most two parameters, and a call to one
     answers in the same shape.
  c. CONTROLS: the dispatcher run directly, bin/axiomcode with --json, and AXIOMCODE_RAW=1 give the old answer — no
     fenced block — for the same question.

    python3 tests/front_door.py      indexes one small Python repository, so it needs the engine
"""
import json, os, re, shutil, subprocess, sys, tempfile, threading

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CLI = os.path.join(ROOT, 'bin', 'axiomcode')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
SERVER = os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp', 'server.py')
FILES = {
    'shop/__init__.py': '',
    'shop/rates.py': 'def vat_rate():\n    return 0.2\n',
    'shop/pricing.py': ('from shop.rates import vat_rate\n\n\n'
                        'def total(prices):\n    net = sum(prices)\n    return net * (1 + vat_rate())\n\n\n'
                        'def invoice(prices):\n    return {"total": total(prices), "net": sum(prices)}\n'),
    'tests/__init__.py': '',
    'tests/test_pricing.py': ('from shop.pricing import invoice\n\n\n'
                              'def test_invoice_total():\n    assert abs(invoice([10])["total"] - 12) < 1e-9\n'),
}
# the caller's own settings must not choose the engine or the shape
ENV = {k: v for k, v in os.environ.items() if k not in ('AXIOMCODE_ENGINE', 'AXIOMCODE_RAW', 'AXIOMCODE_FRONT', 'AXIOMCODE_SURFACE')}
ENV['AXIOMCODE_REFRESH_INTERVAL'] = '0'
PLACE = re.compile(r'^\d+\. \S+:\d+', re.M)
FENCE = re.compile(r'^\s*```python\s*$', re.M)

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond: fails.append(why)


def cli(repo, *args, env=None):
    r = subprocess.run(['bash', CLI, *args], cwd=repo, capture_output=True, text=True, timeout=600, env=env or ENV)
    return r.returncode, r.stdout, r.stderr


def places(out):
    return bool(PLACE.search(out)) and bool(FENCE.search(out)) and '→' in out


def mcp(repo, calls):
    """tools/list, then each (name, arguments) as tools/call, on the SDK-free server started in repo"""
    frames = [{'jsonrpc': '2.0', 'id': 1, 'method': 'initialize',
               'params': {'protocolVersion': '2025-06-18', 'capabilities': {}, 'clientInfo': {'name': 'tests', 'version': '0'}}},
              {'jsonrpc': '2.0', 'method': 'notifications/initialized'},
              {'jsonrpc': '2.0', 'id': 2, 'method': 'tools/list'}]
    frames += [{'jsonrpc': '2.0', 'id': 3 + i, 'method': 'tools/call', 'params': {'name': n, 'arguments': a}}
               for i, (n, a) in enumerate(calls)]
    p = subprocess.Popen([sys.executable, '-S', SERVER], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL, cwd=repo, text=True, env=ENV)
    timer = threading.Timer(600, p.kill); timer.start()
    got = {}
    try:
        for f in frames:
            p.stdin.write(json.dumps(f) + '\n'); p.stdin.flush()
            if 'id' not in f: continue
            while f['id'] not in got:
                line = p.stdout.readline()
                if not line: return got
                try: m = json.loads(line)
                except ValueError: continue
                if 'id' in m: got[m['id']] = m.get('result') or {}
        return got
    finally:
        timer.cancel(); p.stdin.close(); p.wait()


def main():
    work = tempfile.mkdtemp(prefix='ax-front-door-')
    try:
        repo = os.path.join(work, 'shop')
        for rel, text in FILES.items():
            os.makedirs(os.path.dirname(os.path.join(repo, rel)), exist_ok=True)
            with open(os.path.join(repo, rel), 'w') as f: f.write(text)
        git = lambda *a: subprocess.run(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', *a], cwd=repo, capture_output=True, text=True)
        git('init', '-q'); git('add', '-A'); git('commit', '-qm', 'init')
        rc, out, err = cli(repo, 'index', '--lang', 'python')
        check('the repository indexes', rc == 0 and os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')), (out + err)[-400:])
        if fails: return 1

        # ── a. the installed command, no flags ───────────────────────────────────────────────────────────────────
        rc, out, err = cli(repo, 'find', 'how is the invoice total computed')
        check('find: numbered places, each with its code in a fenced block', rc == 0 and places(out) and 'def invoice' in out, out[:600] + err[-300:])
        rc, out, err = cli(repo, 'impact', 'vat_rate')
        check('impact <name>: its caller, which spells the name, by location on the grep line (no code)', rc == 0 and 'grep -nw vat_rate' in out and 'shop/pricing.py:6' in out
              and 'return net * (1 + vat_rate())' not in out, out[:600] + err[-300:])
        check('impact <name>: the test that reaches it is one of the places', 'tests/test_pricing.py' in out, out[:800])
        rc, out, err = cli(repo, 'path', 'invoice', 'vat_rate')
        check('path: every hop a numbered place with the code at the call', rc == 0 and places(out)
              and 'shop/pricing.py:10' in out and 'shop/pricing.py:6' in out, out[:600] + err[-300:])

        with open(os.path.join(repo, 'shop', 'rates.py'), 'w') as f: f.write('def vat_rate():\n    return 0.25\n')
        rc, out, err = cli(repo, 'impact')
        first = out.lstrip().split('\n', 1)[0]
        check('impact with no name: the answer starts with "your edits:" and names the edited declaration',
              rc == 0 and first.startswith('your edits:') and 'vat_rate' in first, out[:600] + err[-300:])
        check('impact with no name: then what the edit reaches, its grep-visible caller by location', 'shop/pricing.py:6' in out, out[:600])
        rc, out, err = cli(repo, 'tests')
        last = [l for l in out.splitlines() if l.strip()][-1:] or ['']
        check('tests: the reached test as a numbered place with its code', rc == 0 and places(out) and 'tests/test_pricing.py' in out, out[:600] + err[-300:])
        check('tests: the answer ends with the "run:" line', last[0].startswith('run:') and 'test_pricing' in last[0], last)

        # ── b. the MCP server ──────────────────────────────────────────────────────────────────────────────────────
        got = mcp(repo, [('path', {'start': 'total', 'end': 'vat_rate'}), ('impact', {'name': 'vat_rate'})])
        tools = {t['name']: list((t.get('inputSchema') or {}).get('properties', {})) for t in got.get(2, {}).get('tools', [])}
        check('MCP tools/list is exactly impact, path and tests (search is grep\'s)', set(tools) == {'impact', 'path', 'tests'}, tools)
        check('MCP: every tool takes at most two parameters', bool(tools) and all(len(p) <= 2 for p in tools.values()), tools)
        text = lambda i: ''.join(c.get('text', '') for c in got.get(i, {}).get('content', []))
        check('MCP path answers as numbered places with their code', places(text(3)), text(3)[:600])
        check('MCP impact names the caller grep also finds, by location', 'shop/pricing.py:6' in text(4) and 'grep -nw vat_rate' in text(4), text(4)[:600])

        # ── c. controls: the same question anywhere else gets the verb's own answer ──────────────────────────────────
        r = subprocess.run(['bash', AX, 'impact', 'vat_rate', repo], cwd=repo, capture_output=True, text=True, timeout=600, env=ENV)
        check('CONTROL: the dispatcher run directly gives the old answer, no fenced block',
              r.returncode == 0 and '```' not in r.stdout and 'reads or uses it' in r.stdout, r.stdout[:600])
        rc, out, err = cli(repo, 'impact', 'vat_rate', '--json')
        try: doc = json.loads(out)
        except ValueError: doc = None
        check('CONTROL: bin/axiomcode with --json gives the old answer, the JSON document, no fenced block',
              isinstance(doc, dict) and '```' not in out, out[:400])
        rc, out, err = cli(repo, 'impact', 'vat_rate', env=dict(ENV, AXIOMCODE_RAW='1'))
        check('CONTROL: AXIOMCODE_RAW=1 at the installed command gives the old answer, no fenced block',
              rc == 0 and '```' not in out and 'reads or uses it' in out, out[:600])
        rc, out, err = cli(repo, 'tests', '--why')
        check('CONTROL: tests with a flag gives the old answer, no fenced block', '```' not in out and bool(out.strip()), out[:600])
    finally:
        shutil.rmtree(work, ignore_errors=True)
    print(f'\n{len(checked) - len(fails)} of {len(checked)} check(s) held')
    return 1 if fails else 0


if __name__ == '__main__':
    sys.exit(main())
