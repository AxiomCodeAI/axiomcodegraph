#!/usr/bin/env python3
"""tests/enrich_lines.py: what one line of the Read / Grep / Edit enrichment says, where a bare number misled.

  · a caller count of 0 says why where the graph knows: `entry (http)`, `0 resolved, N by name`, `? framework (@X)`;
    a method with no signal still reads `0` (the control);
  · the Grep preview names production callers before tests (#1507), and a name declared several times lists the base
    first with its override count, two different files never print as the same line, two overloads in one file print once, and the rest are counted (#1546);
  · a grep run through the shell over another command's output or over files no graph indexes adds nothing, and a
    constant-shaped word is not looked up as a callable (#1604);
  · an edit that changes no declaration adds nothing, a body-only edit adds one line of reaching tests and the command
    that runs them, and a declaration already reported this session is not reported again.

Every silence has its control: the same hook on a near-miss input DOES speak, so a check cannot pass because the hook
had nothing to say. It indexes a small project, so it needs the engine, as run.py does.

    python3 tests/enrich_lines.py
"""
import json, os, shutil, subprocess, sys, tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOOKS = os.path.join(ROOT, 'plugins', 'axiomcode', 'hooks')
AX = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts', 'axiomcode')
P = 'core/src/main/java/app/orders/'

SRC = {
    'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>app</groupId><artifactId>app</artifactId><version>1</version></project>\n',
    P + 'OrderStore.java': 'package app.orders;\n\npublic class OrderStore {\n    public String findById(int id) {\n        return "order-" + id;\n    }\n}\n',
    P + 'OrderService.java': ('package app.orders;\n\npublic class OrderService {\n    private final OrderStore store = new OrderStore();\n\n'
                              '    public String show(int id) { return store.findById(id); }\n\n'
                              '    public String cancel(int id) { return store.findById(id); }\n\n'
                              '    public String ship(int id) { return store.findById(id); }\n}\n'),
    # sorts BEFORE OrderService: an unordered preview named these two and hid the production callers
    'core/src/test/java/app/orders/CheckoutTest.java': ('package app.orders;\n\nimport org.junit.jupiter.api.Test;\n\nclass CheckoutTest {\n'
                                                        '    @Test\n    void findsAnOrder() { new OrderStore().findById(1); }\n\n'
                                                        '    @Test\n    void findsAnotherOrder() { new OrderStore().findById(2); }\n}\n'),
    P + 'Converter.java': ('package app.orders;\n\npublic interface Converter {\n    String convert(Object value);\n\n'
                           '    abstract class Factory {\n        public abstract Converter widgetConverter(String type);\n    }\n}\n'),
    P + 'JsonConverterFactory.java': ('package app.orders;\n\npublic class JsonConverterFactory extends Converter.Factory {\n'
                                      '    public Converter widgetConverter(String type) { return v -> "json:" + v; }\n}\n'),
    P + 'WidgetClient.java': ('package app.orders;\n\npublic class WidgetClient {\n    private final java.util.Map registry = new java.util.HashMap();\n'
                              '    public String sendWidget(Converter.Factory f, Object w) {\n        return f.widgetConverter("widget").convert(w);\n    }\n'
                              '    public void prime(Object anything) {\n        registry.lookup("jobs").nudgeAll();\n    }\n}\n'),
    P + 'Jobs.java': ('package app.orders;\n\nimport org.springframework.scheduling.annotation.Scheduled;\n'
                      'import org.springframework.web.bind.annotation.GetMapping;\nimport org.springframework.web.bind.annotation.RestController;\n\n'
                      '@RestController\npublic class Jobs {\n'
                      '    @GetMapping("/orders")\n    public String listOrders() { return new Plain().countAll(); }\n\n'
                      '    @Scheduled(fixedRate = 1000)\n    public void sweepStale() { new Plain().countAll(); }\n\n'
                      '    public void nudgeAll() { new Plain().countAll(); }\n\n'
                      '    public void pokeAll() { new Plain().countAll(); }\n}\n'),
    # a library base: `run` overrides it, `tickAll` only may (the graph does not hold Runnable's methods)
    P + 'Ticker.java': ('package app.orders;\n\npublic class Ticker implements Runnable {\n'
                        '    @Override\n    public void run() { new Plain().countAll(); }\n\n'
                        '    public void tickAll() { new Plain().countAll(); }\n}\n'),
    P + 'Plain.java': ('package app.orders;\n\npublic class Plain {\n    public String countAll() { return "1"; }\n'
                       '    public int unusedCount() { return Integer.parseInt(countAll()); }\n}\n'),
    # two overloads in one file: one name to the reader, printed once
    P + 'Pricer.java': ('package app.orders;\n\npublic class Pricer {\n    public int quoteAll(int n) { return n; }\n\n'
                        '    public int quoteAll(String s) { return quoteAll(s.length()); }\n}\n'),
    # a constant with one reader, a sibling that does not read it, and a second class in the same file
    P + 'Limits.java': ('package app.orders;\n\npublic class Limits {\n    public static final int MAX_ITEMS = 3;\n\n'
                        '    public int cap() { return MAX_ITEMS; }\n\n    public int floor() { return 1; }\n}\n\n'
                        'class Spare {\n    int spareCount() { return 2; }\n}\n'),
}
# two test stubs in modules whose paths sort before core/, with the same file name and line
for m in ('json', 'xml'):
    SRC[f'adapter-{m}/src/test/java/app/{m}/StubConverterFactory.java'] = (
        f'package app.{m};\n\nimport app.orders.Converter;\n\npublic class StubConverterFactory extends Converter.Factory {{\n'
        '    public Converter widgetConverter(String type) { return v -> "stub"; }\n}\n')

fails, checked = [], []
def check(why, cond, detail=''):
    checked.append(why)
    print(('ok   ' if cond else 'FAIL ') + why + (f'\n     {detail}' if not cond and detail else ''))
    if not cond:
        fails.append(why)


def fire(repo, session, tool, inp, hook='enrich.py', event='PostToolUse'):
    ev = {'hook_event_name': event, 'tool_name': tool, 'tool_input': inp, 'cwd': repo, 'session_id': session, 'prompt': 'go on'}
    r = subprocess.run([sys.executable, os.path.join(HOOKS, hook)], input=json.dumps(ev), capture_output=True, text=True, timeout=120)
    out = r.stdout.strip()
    if not out:
        return ''
    try:
        return json.loads(out)['hookSpecificOutput']['additionalContext']
    except (ValueError, KeyError, TypeError):
        return out


def grep(repo, pattern, session=None):
    return fire(repo, session or f'g-{pattern}', 'Grep', {'pattern': pattern})


def bash(repo, command, session=None):
    return fire(repo, session or f'b-{command}', 'Bash', {'command': command})


def line_of(block, name):
    return next((l for l in block.splitlines() if name in l), '')


def git(repo, *a):
    subprocess.run(['git', '-c', 'user.email=t@t', '-c', 'user.name=t', *a], cwd=repo, capture_output=True, check=True)


with tempfile.TemporaryDirectory() as repo:
    for n, t in SRC.items():
        os.makedirs(os.path.dirname(os.path.join(repo, n)), exist_ok=True)
        open(os.path.join(repo, n), 'w').write(t)
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    built = subprocess.run(['bash', AX, 'index', repo, '--lang', 'java'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        print('FAIL could not index the project; the engine is needed\n     ' + built.stderr.strip()[-300:])
        sys.exit(1)

    # ── ← 0 says why ────────────────────────────────────────────────────────────────────────────────────
    g = grep(repo, 'listOrders|sweepStale|nudgeAll|pokeAll|unusedCount')
    check('a route handler with no caller reads as an entry point, not as 0', '← entry (http)' in line_of(g, 'Jobs.listOrders'), g)
    check('a scheduled method reads as an entry point', '← entry (scheduled)' in line_of(g, 'Jobs.sweepStale'), g)
    check('a method whose name is written at an untyped call site counts that site, before the annotation on its class',
          '← 0 resolved, 1 by name' in line_of(g, 'Jobs.nudgeAll'), g)
    check('a method of a framework-annotated class says which annotation', '← ? framework (@RestController on Jobs)' in line_of(g, 'Jobs.pokeAll'), g)
    check('control: an undecorated method nothing calls still reads 0', '← 0  →' in line_of(g, 'Plain.unusedCount'), g)
    r = fire(repo, 'r1', 'Read', {'file_path': os.path.join(repo, P + 'Ticker.java')})
    check('a Read labels a library override the same way', 'run ←? framework (overrides a library method)' in r, r)
    check('a method of a class with a library base that it may not override names the base', 'tickAll ←? framework (extends Runnable)' in r, r)
    check('control: a Read of a method with callers still counts them',
          'countAll ←6' in fire(repo, 'r2', 'Read', {'file_path': os.path.join(repo, P + 'Plain.java')}))

    # ── the preview order (#1507) and several declarations (#1546) ───────────────────────────────────────
    g = grep(repo, 'findById')
    check('production callers are named before test callers', '← 5 (cancel, ship, …; 2 in tests)' in g, g)
    check('and the test callers are not the ones named', 'findsAnOrder' not in g, g)
    g = grep(repo, 'widgetConverter')
    rows = [l for l in g.splitlines() if l.startswith('  ')]
    check('the base declaration comes first, with its override count',
          rows and rows[0].lstrip().startswith('Converter.Factory.widgetConverter') and '⇣ 3 override(s)' in rows[0], g)
    check('the production override comes before test stubs', len(rows) > 1 and 'JsonConverterFactory.widgetConverter' in rows[1], g)
    check('the declarations not shown are counted', '(+2 more declaration(s))' in g, g)
    check('two printed lines are never the same', len(rows) == len(set(rows)), g)
    g = grep(repo, 'quoteAll')
    rows = [l for l in g.splitlines() if l.startswith('  ') and 'Pricer.quoteAll' in l]
    check('two overloads in one file print as one line that says so', len(rows) == 1 and '(2 overloads)' in rows[0], g)
    sys.path.insert(0, HOOKS); import _graphline
    two = _graphline.distinct_paths(['adapter-json/src/test/java/app/json/Stub.java', 'adapter-xml/src/test/java/app/xml/Stub.java'])
    check('two same-named files in different modules print with the path that tells them apart', two == ['json/Stub.java', 'xml/Stub.java'], two)
    check('control: files with different names print as their names', _graphline.distinct_paths(['a/b/C.java', 'a/b/D.java']) == ['C.java', 'D.java'])

    # ── what the shell greps (#1604) ──────────────────────────────────────────────────────────────────────
    check('a grep over another command\'s output adds nothing', bash(repo, "mvn test 2>&1 | grep -E 'findById|FAIL'") == '')
    check('a grep over a log file adds nothing', bash(repo, 'grep -n findById build.log') == '')
    check('a constant-shaped word is not looked up as a callable', bash(repo, 'grep -rn FIND core/src') == '')
    check('a shell grep matches whole names, not prefixes', bash(repo, 'grep -rn findBy core/src') == '')
    c = bash(repo, 'grep -rn findById core/src')
    check('control: the same name grepped over source is annotated', 'OrderStore.findById' in c, c)
    c = grep(repo, 'findBy', session='g-prefix')
    check('control: the Grep tool still matches a name by (case-sensitive) prefix', 'OrderStore.findById' in c, c)

    # ── the edit hook ─────────────────────────────────────────────────────────────────────────────────────
    f = os.path.join(repo, P + 'OrderStore.java')
    orig = open(f).read()
    def edit(session, text, hook='enrich.py', event='PostToolUse'):
        open(f, 'w').write(text)
        return fire(repo, session, 'Edit', {'file_path': f}, hook, event)
    out = edit('e1', orig + '\n')
    check('an edit that changes no declaration adds nothing', out == '', out)
    body = orig.replace('"order-"', '"order:"')
    out = edit('e2', body)
    check('control: a body-only edit gets one line: the tests that reach it and the command that runs them',
          out.count('\n') == 0 and 'body edit of OrderStore.findById: 2 test(s) reach it' in out and 'mvn test -Dtest=CheckoutTest' in out, out)
    check('and not the readers, which a body edit cannot break', 'reads / uses it' not in out, out)
    out = edit('e2', orig.replace('"order-"', '"order;"'))
    check('the same declaration edited again in the session is not reported again', out == '', out)
    check('control: in a fresh session it is', 'body edit of' in edit('e3', body))
    out = edit('e4', orig.replace('findById(int id)', 'findById(long id)'))
    check('a signature edit keeps its blast radius, with impact answered', 'signature OrderStore.findById' in out
          and 'reads / uses it' in out and 'impact unavailable' not in out, out)
    open(f, 'w').write(body)
    out = fire(repo, 'u1', '', {}, 'changes.py', 'UserPromptSubmit')
    check('the prompt-time report of a body edit is the same one line', 'body edit of OrderStore.findById' in out and 'reads / uses it' not in out, out)
    open(f, 'w').write(orig)
    # a declaration beside it in the file (a sibling, another class) is not a reader: `reads / uses it` counts readers only
    f = os.path.join(repo, P + 'Limits.java')
    orig = open(f).read()
    out = edit('e5', orig.replace('    public static final int MAX_ITEMS = 3;\n\n', ''))
    check('a removed constant lists its reader and not the declarations beside it',
          'reads / uses it (1): ' in out and 'Limits.cap' in out and 'Limits.floor' not in out and 'Spare.spareCount' not in out, out)
    open(f, 'w').write(orig)

# ── what a Read of a script says: a call in the text read is not an edge the text does not show ─────────────
PY = {
    'tool.py': ('from lib import fetch\n\n\n'
                'def helper(x):\n    return fetch(x)\n\n\n'
                'def main():\n    return helper(1)\n\n\n'
                'def untyped(o):\n    return o.go()\n\n\n'
                'if __name__ == "__main__":\n    main()\n'),
    'lib.py': ('def fetch(x):\n    return x\n\n\n'
               'def untyped2(o):\n    return o.go()\n'),
    'app.py': ('from lib import untyped2\n\n\ndef run(o):\n    return untyped2(o)\n'),
    'many.py': ''.join(f'def f{i}(o):\n    return o.go()\n\n\n' for i in range(7))
               + 'g1 = lambda o: o.a()\ng2 = lambda o: o.b()\n\n\n'
               # an owner-qualified one (`Walker.<lambda>`) is as anonymous as a bare one
               + 'class Walker:\n    h = lambda self, o: o.c()\n',
    'use_many.py': 'import many\n\n\ndef use(o):\n' + ''.join(f'    many.f{i}(o)\n' for i in range(7))
                   + '    many.g1(o)\n    many.g2(o)\n',
}
with tempfile.TemporaryDirectory() as repo:
    for n, t in PY.items(): open(os.path.join(repo, n), 'w').write(t)
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    subprocess.run(['bash', AX, 'index', repo, '--lang', 'python'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        check('the python project indexes', False)
    else:
        tool = os.path.join(repo, 'tool.py')
        r = fire(repo, 'p1', 'Read', {'file_path': tool})
        check('a whole-script read does not list its own top level as a caller', '<module>' not in r, r)
        check('control: the cross-file callee it cannot show is still there', 'helper ← callers in range →1' in r, r)
        check('a declaration whose only caller is in the lines read does not read as ←0', 'helper ←0' not in r, r)
        r = fire(repo, 'p2', 'Read', {'file_path': tool, 'offset': 8, 'limit': 3})
        check('control: a range that leaves out the top-level call names it, at the line of the call',
              'main L8' in r and 'tool.<module> L17' in r, r)
        r = fire(repo, 'p3', 'Read', {'file_path': tool, 'offset': 12, 'limit': 3})
        check('a block of nothing but unresolved counts is not emitted', r == '', r)
        r = fire(repo, 'p4', 'Read', {'file_path': os.path.join(repo, 'lib.py'), 'offset': 5, 'limit': 3})
        check('control: the same unresolved call on a declaration with a caller is kept',
              'untyped2 L5  ← run' in r and 'unresolved' in r, r)
        r = fire(repo, 'p5', 'Read', {'file_path': os.path.join(repo, 'many.py')})
        more = line_of(r, '+')
        check('anonymous functions, bare or owner-qualified, are counted in +N more but not named',
              ('+5 more' in more or '+4 more' in more) and '<lambda>' not in more, r)
        check('control: the named ones left over are still named there', 'f' in more.split(':', 1)[-1], r)

# ── one reader for "why nothing calls it" (graph_sql.no_caller_reasons), and callers through an interface ──────────
CASES = os.path.join(ROOT, 'tests', 'cases')
with tempfile.TemporaryDirectory() as repo:
    shutil.copytree(os.path.join(CASES, 'python', 'why-no-caller-one-reader', 'src'), os.path.join(repo, 'src'))
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    subprocess.run(['bash', AX, 'index', repo, '--lang', 'python'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        check('the reader project indexes', False)
    else:
        g = grep(repo, 'get_standings|refresh_board|load_user|_unused_helper', session='g-why')
        check('a caching wrapper is not the reason: the Grep line counts the call sites that write the name, as impact does',
              '← 0 resolved, 1 by name' in line_of(g, 'get_standings') and 'memoize' not in g, g)
        check('near-miss control: a library decoration a framework reads is still the reason',
              '← ? framework (@app_hooks.before_request)' in line_of(g, 'load_user'), g)
        check('control: a private helper with no reason still reads 0', '← 0  →' in line_of(g, '_unused_helper'), g)
with tempfile.TemporaryDirectory() as repo:
    shutil.copytree(os.path.join(CASES, 'java', 'callers-through-the-interface', 'src'), os.path.join(repo, 'src'))
    git(repo, 'init', '-q'); git(repo, 'add', '-A'); git(repo, 'commit', '-qm', 'init')
    subprocess.run(['bash', AX, 'index', repo, '--lang', 'java'], capture_output=True, text=True, timeout=1800)
    if not os.path.exists(os.path.join(repo, '.axiomcode', 'out', 'graph.sqlite')):
        check('the interface project indexes', False)
    else:
        rd = lambda f, sid: fire(repo, sid, 'Read', {'file_path': os.path.join(repo, 'src', 'app', *f.split('/'))})
        r = rd('store/Store.java', 'r-iface')
        check('an interface method whose callers hold an interface-typed field lists them, as impact does (#1542)',
              'Store.save L4  ← CtorIface.place, FieldIface.place' in r, r)
        r = rd('widgets/WidgetService.java', 'r-iface2')
        check('a caller through the interface is listed beside a resolved one', 'WidgetReport.line' in r and 'WidgetController.get' in r, r)
        r = rd('shapes/Circle.java', 'r-area')
        check('near-miss control: a caller typed on the other implementation is not a caller of this one',
              'Circle.area' in r and 'squareOnly' not in r, r)

print()
print(f"{len(checked) - len(fails)} of {len(checked)} check(s) held" if not fails else f"{len(fails)} FAILED: " + '; '.join(fails))
sys.exit(1 if fails else 0)
