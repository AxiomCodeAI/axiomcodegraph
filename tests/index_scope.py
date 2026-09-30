#!/usr/bin/env python3
"""tests/index_scope.py: `axiomcode index` builds the languages the repository is written in, and nothing it started
outlives it.

A C# web application compiled the whole JavaScript engine for the copied scripts it serves from wwwroot/lib (and that
build then failed), and the compiler's worker went on at full CPU for half an hour after the index had returned.

  vendored     with the languages detected (no --lang), vendored code is neither counted nor parsed: a `vendor`
               directory, an ASP.NET wwwroot/lib, *.min.js and *.bundle.js. A language left with no file, or with files
               that hold only comments, is not built, and one line says so with how to include it
  controls     the same repository with JavaScript of its own builds it; an explicit --lang and
               AXIOMCODE_INCLUDE_VENDORED=1 read the vendored files as before; a Java package named `vendor` is source;
               a tree that is nothing but vendored code is read whole
  parser       the parser skips the same files under AXIOMCODE_SKIP_VENDORED=1 and reads them without it
  stopped      a build killed outright (SIGKILL, which no trap sees) or with TERM takes its engine's whole process group
               with it, a slow compiler child included; the MCP server's timeout ends the command's whole group

A stand-in engine (bin/axiomcode, graph/, package.json) records the languages it is asked to solve, so no Souffle program
is compiled; the parser check runs the real parser of this checkout.

    python3 tests/index_scope.py [-v]
"""
import json, os, shutil, signal, subprocess, sys, tempfile, time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode', 'scripts')
BUILD = os.path.join(SCRIPTS, 'axiomcode-build')
FRESH = os.path.join(SCRIPTS, 'ax_fresh.py')
VERBOSE = '-v' in sys.argv
FAILS = []


def check(ok, what, detail=''):
    print(('PASS ' if ok else 'FAIL ') + what)
    if not ok:
        FAILS.append(what)
        if detail: print('   ' + str(detail)[-1500:].replace('\n', '\n   '))
    elif VERBOSE and detail: print('   ' + str(detail)[-600:].replace('\n', '\n   '))


def make(root, files):
    for rel, text in files.items():
        p = os.path.join(root, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
        with open(p, 'w') as fh: fh.write(text)
    subprocess.run(['git', 'init', '-q', root], check=True)


def alive(pid):
    try: os.kill(pid, 0)
    except ProcessLookupError: return False
    except PermissionError: return True
    # a zombie is gone for this purpose: it runs nothing
    r = subprocess.run(['ps', '-o', 'stat=', '-p', str(pid)], capture_output=True, text=True)
    return bool(r.stdout.strip()) and not r.stdout.strip().startswith('Z')


def until(pred, secs):
    end = time.time() + secs
    while time.time() < end:
        if pred(): return True
        time.sleep(0.2)
    return pred()


# a stand-in engine: `all` records its --language and, with SLOW set, starts a child that runs for minutes (a C++
# compile), records both pids, and waits for it
FAKE_ENGINE = r'''#!/bin/bash
[ "$1" = all ] || exit 0
while [ $# -gt 0 ]; do case "$1" in --language) echo "$2" > "$FAKE_LOG/languages";; esac; shift; done
if [ -n "${SLOW:-}" ]; then
  sleep 300 & echo "$$ $!" > "$FAKE_LOG/pids.tmp"; mv "$FAKE_LOG/pids.tmp" "$FAKE_LOG/pids"; wait
fi
if [ -n "${ORPHAN:-}" ]; then
  # what a compiler driver stopped with TERM leaves: its worker, reparented, still running; the engine goes on and ends
  ( sleep 300 & echo $! > "$FAKE_LOG/orphan" ) ; wait
  # and one started on purpose in a session of its own (the query rules' compile is), which is not the build's to end
  python3 -c 'import subprocess,sys; print(subprocess.Popen(["sleep", "300"], start_new_session=True).pid)' > "$FAKE_LOG/detached"
fi
exit 1
'''


def fake_engine(tmp):
    e = os.path.join(tmp, 'engine'); os.makedirs(os.path.join(e, 'bin')); os.makedirs(os.path.join(e, 'graph'))
    os.makedirs(os.path.join(e, 'parser', 'dist'))
    open(os.path.join(e, 'parser', 'dist', 'index.js'), 'w').close()
    json.dump({'name': 'stand-in', 'version': '0.0.0'}, open(os.path.join(e, 'package.json'), 'w'))
    p = os.path.join(e, 'bin', 'axiomcode'); open(p, 'w').write(FAKE_ENGINE); os.chmod(p, 0o755)
    return e


def build(repo, engine, log, lang=None, **extra):
    env = dict(os.environ, AXIOMCODE_ENGINE=engine, FAKE_LOG=log, AXIOMCODE_NO_REFRESH='1', **extra)
    for k in ('AXIOMCODE_LANG', 'AXIOMCODE_SRC', 'AXIOMCODE_LIBRARY', 'AXIOMCODE_SKIP_VENDORED', 'AXIOMCODE_INCLUDE_VENDORED'):
        if k not in extra: env.pop(k, None)
    if lang: env['AXIOMCODE_LANG'] = lang
    try: os.remove(os.path.join(log, 'languages'))
    except OSError: pass
    r = subprocess.run(['bash', BUILD, repo], capture_output=True, text=True, env=env, timeout=300)
    try: langs = open(os.path.join(log, 'languages')).read().strip()
    except OSError: langs = None
    return r, langs


CSPROJ = '<Project Sdk="Microsoft.NET.Sdk.Web">\n  <PropertyGroup><TargetFramework>net8.0</TargetFramework></PropertyGroup>\n</Project>\n'
WEB = {
    'src/Web/Web.csproj': CSPROJ,
    'src/Web/Program.cs': 'namespace Web;\n\npublic static class Program\n{\n    public static int Main() => Helper.Two();\n}\n',
    'src/Web/Helper.cs': 'namespace Web;\n\npublic static class Helper\n{\n    public static int Two() => 2;\n}\n',
    'src/Web/wwwroot/lib/jquery/jquery.js': 'function jQuery(s) {\n  return s\n}\n',
    'src/Web/wwwroot/lib/jquery-validation-unobtrusive/jquery.validate.unobtrusive.js': 'function v(a) {\n  return a\n}\n',
    'src/Web/wwwroot/lib/bootstrap/bootstrap.bundle.js': 'function b(a) {\n  return a\n}\n',
    'src/Web/wwwroot/js/site.js': '// Please see documentation for details on configuring this project.\n\n// Write your JavaScript code.\n',
    'src/Web/wwwroot/js/chart.min.js': 'function c(a){return a}\n',
}


def vendored(tmp, engine, log):
    web = os.path.join(tmp, 'web'); make(web, WEB)
    r, langs = build(web, engine, log)
    check(langs == 'csharp', 'vendored: a C# application whose JavaScript is vendored or comments only builds C# alone', f'{langs}\n{r.stdout}')
    notes = [l for l in r.stdout.splitlines() if l.startswith('javascript: not indexed')]
    check(len(notes) == 1 and 'vendored' in notes[0] and 'hold no code' in notes[0] and '--lang' in notes[0]
          and 'AXIOMCODE_INCLUDE_VENDORED=1' in notes[0], 'vendored: one line names the language left out, why, and how to include it', r.stdout)
    check('javascript 0' in r.stdout, 'vendored: the build line counts no JavaScript', r.stdout)
    # the table is committed only by a build that succeeds; take the snapshot that build takes
    snap = json.loads(subprocess.run([sys.executable, FRESH, 'snapshot', web, 'csharp,javascript', ''], capture_output=True, text=True,
                                     env=dict(os.environ, AXIOMCODE_SKIP_VENDORED='1')).stdout)
    files = sorted(snap['files'])
    check(snap.get('skip_vendored') is True and 'src/Web/wwwroot/js/site.js' in files and not any('/lib/' in f or f.endswith('.min.js') for f in files),
          'vendored: the file table watches what the parser reads, and records that vendored code was skipped', files)
    # CONTROL: JavaScript of its own beside the vendored copy is built
    with open(os.path.join(web, 'src/Web/wwwroot/js/site.js'), 'a') as fh: fh.write('function start() {\n  return 1\n}\n')
    r, langs = build(web, engine, log)
    check(langs == 'csharp,javascript' and 'javascript: not indexed' not in r.stdout,
          'control: the same application with a script of its own builds JavaScript too', f'{langs}\n{r.stdout}')
    check('javascript 1' in r.stdout, 'control: and counts only that script, not the vendored ones', r.stdout)
    # CONTROL: an explicit --lang reads the vendored files as before
    with open(os.path.join(web, 'src/Web/wwwroot/js/site.js'), 'w') as fh: fh.write(WEB['src/Web/wwwroot/js/site.js'])
    r, langs = build(web, engine, log, lang='csharp,javascript')
    check(langs == 'csharp,javascript' and 'not indexed' not in r.stdout and 'javascript 5' in r.stdout,
          'control: --lang csharp,javascript builds JavaScript and counts the vendored scripts, as before', f'{langs}\n{r.stdout}')
    shutil.rmtree(os.path.join(web, '.axiomcode'))
    r, langs = build(web, engine, log, AXIOMCODE_INCLUDE_VENDORED='1')
    check(set((langs or '').split(',')) == {'csharp', 'javascript'} and 'not indexed' not in r.stdout and 'javascript 5' in r.stdout,
          'control: AXIOMCODE_INCLUDE_VENDORED=1 builds the vendored JavaScript', f'{langs}\n{r.stdout}')
    # a Java package named vendor is source; a JavaScript vendor directory beside it is not
    jv = os.path.join(tmp, 'javavendor')
    make(jv, {'pom.xml': '<project><modelVersion>4.0.0</modelVersion><groupId>a</groupId><artifactId>b</artifactId><version>1</version></project>\n',
              'src/main/java/app/vendor/Vendor.java': 'package app.vendor;\n\npublic class Vendor {\n    public int id() { return 1; }\n}\n',
              'src/main/java/app/Shop.java': 'package app;\n\npublic class Shop {\n    int f() { return new app.vendor.Vendor().id(); }\n}\n',
              'src/main/resources/static/vendor/lib.js': 'function lib(a) {\n  return a\n}\n'})
    c = subprocess.run([sys.executable, FRESH, 'count', jv], capture_output=True, text=True, env=dict(os.environ, AXIOMCODE_SKIP_VENDORED='1')).stdout.split('\n')
    check(c[0].split() == ['2', '0', '0', '0', '0'] and c[1].split()[3] == '1:0',
          'vendored: a Java package named vendor is counted; a vendor/ directory of scripts is not', c)
    # nothing but vendored code: read as before
    only = os.path.join(tmp, 'onlyvendor'); make(only, {'vendor/a/index.js': 'function a(x) {\n  return x\n}\n'})
    r, langs = build(only, engine, log)
    check(langs == 'javascript' and 'not indexed' not in r.stdout, 'control: a tree that is nothing but vendored code is read whole', f'{langs}\n{r.stdout}')


def parser(tmp):
    ax = os.path.join(ROOT, 'bin', 'axiomcode')
    if not os.path.isfile(os.path.join(ROOT, 'parser', 'dist', 'index.js')):
        print('SKIP parser: parser/dist is not built'); return
    src = os.path.join(tmp, 'jsrepo')
    make(src, {'package.json': '{ "name": "app", "version": "1.0.0" }\n',
               'src/app.js': "function start() {\n  return 1\n}\nmodule.exports = { start }\n",
               'vendor/left/left.js': 'function left(a) {\n  return a\n}\n',
               'public/wwwroot/lib/jq/jq.js': 'function jq(a) {\n  return a\n}\n',
               'public/app.min.js': 'function m(a){return a}\n',
               'public/app.bundle.js': 'function n(a){return a}\n'})
    def modules(**extra):
        ir = tempfile.mkdtemp(dir=tmp)
        env = dict(os.environ, **extra); env.pop('AXIOMCODE_SKIP_VENDORED', None); env.update(extra)
        subprocess.run([ax, 'parser', src, ir], capture_output=True, text=True, env=env, timeout=300)
        out = set()
        for d, _, fs in os.walk(ir):
            for f in fs:
                if f == 'all-javascript-modules.csv':
                    for line in open(os.path.join(d, f)).read().splitlines()[1:]:
                        out.update(c for c in line.split('\t') if c.endswith('.js'))
        return out
    on, off = modules(AXIOMCODE_SKIP_VENDORED='1'), modules()
    check(any(m.endswith('src/app.js') for m in on) and not any(('vendor/' in m or 'wwwroot/lib' in m or '.min.' in m or '.bundle.' in m) for m in on),
          'parser: with AXIOMCODE_SKIP_VENDORED=1 the project is read and its vendored scripts are not', sorted(on))
    check(any('vendor/left' in m for m in off) and any('wwwroot/lib' in m for m in off) and any(m.endswith('app.min.js') for m in off),
          'control: without it the parser reads them, as before', sorted(off))


def stopped(tmp, engine, log):
    web = os.path.join(tmp, 'slow'); make(web, {k: v for k, v in WEB.items() if k.endswith('.cs') or k.endswith('.csproj')})
    for sig in (signal.SIGKILL, signal.SIGTERM):
        shutil.rmtree(os.path.join(web, '.axiomcode'), ignore_errors=True)
        try: os.remove(os.path.join(log, 'pids'))
        except OSError: pass
        env = dict(os.environ, AXIOMCODE_ENGINE=engine, FAKE_LOG=log, SLOW='1', AXIOMCODE_NO_REFRESH='1')
        env.pop('AXIOMCODE_LANG', None)
        p = subprocess.Popen(['bash', BUILD, web], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=env, start_new_session=True)
        ok = until(lambda: os.path.exists(os.path.join(log, 'pids')), 120)
        pids = [int(x) for x in open(os.path.join(log, 'pids')).read().split()] if ok else []
        # the caller's timeout: it ends the build's own process group, which is not the engine's
        os.killpg(p.pid, sig); p.wait()
        gone = until(lambda: not any(alive(x) for x in pids), 20)
        check(ok and len(pids) == 2 and gone, f'stopped: a build ended with {sig.name} leaves nothing of its engine running (its slow child included)', pids)
        for x in pids:
            if alive(x):
                try: os.kill(x, signal.SIGKILL)
                except OSError: pass
    # a compiler's worker orphaned inside the engine (its driver was stopped with TERM, the engine went on and ended):
    # the build that returns ends it; one detached on purpose into a session of its own is left alone
    shutil.rmtree(os.path.join(web, '.axiomcode'), ignore_errors=True)
    for f in ('orphan', 'detached'):
        try: os.remove(os.path.join(log, f))
        except OSError: pass
    env = dict(os.environ, AXIOMCODE_ENGINE=engine, FAKE_LOG=log, ORPHAN='1', AXIOMCODE_NO_REFRESH='1'); env.pop('AXIOMCODE_LANG', None)
    subprocess.run(['bash', BUILD, web], capture_output=True, text=True, env=env, timeout=300)
    orphan = int(open(os.path.join(log, 'orphan')).read()) if os.path.exists(os.path.join(log, 'orphan')) else 0
    detached = int(open(os.path.join(log, 'detached')).read()) if os.path.exists(os.path.join(log, 'detached')) else 0
    check(orphan and until(lambda: not alive(orphan), 10), 'stopped: a compiler worker orphaned inside the engine does not outlive the build that returned', orphan)
    check(detached and alive(detached), 'control: a process the engine detached into a session of its own is not the build\'s to end', detached)
    for x in (orphan, detached):
        if x and alive(x):
            try: os.kill(x, signal.SIGKILL)
            except OSError: pass
    # CONTROL: the stand-in's child does outlive a plain kill of its parent when nothing takes its group down
    sys.path.insert(0, os.path.join(ROOT, 'plugins', 'axiomcode', 'mcp'))
    pidf = os.path.join(log, 'mcp-pid')
    q = subprocess.Popen(['bash', '-c', f'sleep 300 & echo $! > {pidf}; wait'], start_new_session=True)
    until(lambda: os.path.exists(pidf) and open(pidf).read().strip(), 10); child = int(open(pidf).read())
    q.kill(); q.wait()
    check(alive(child), 'control: killing only the parent leaves the child running (what the watchdog is for)')
    try: os.kill(child, signal.SIGKILL)
    except OSError: pass
    os.remove(pidf)
    import server
    t0 = time.time()
    try:
        server.run_group(['bash', '-c', f'sleep 300 & echo $! > {pidf}; wait'], timeout=2); timed = False
    except subprocess.TimeoutExpired: timed = True
    child = int(open(pidf).read()) if os.path.exists(pidf) else 0
    check(timed and child and until(lambda: not alive(child), 10) and time.time() - t0 < 30,
          'stopped: the MCP server\'s timeout ends the command\'s whole process group, its children included', child)
    r = server.run_group(['bash', '-c', 'echo hi; echo err >&2; exit 3'], timeout=20)
    check(r.returncode == 3 and r.stdout == 'hi\n' and r.stderr == 'err\n', 'control: a command that finishes in time answers as subprocess.run did', r)


def main():
    tmp = tempfile.mkdtemp(prefix='axiomcode-scope-')
    try:
        engine = fake_engine(tmp); log = os.path.join(tmp, 'log'); os.makedirs(log)
        vendored(tmp, engine, log)
        parser(tmp)
        stopped(tmp, engine, log)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    print(f"\n{'FAILED: ' + str(len(FAILS)) if FAILS else 'all passed'}")
    return 1 if FAILS else 0


if __name__ == '__main__':
    sys.exit(main())
