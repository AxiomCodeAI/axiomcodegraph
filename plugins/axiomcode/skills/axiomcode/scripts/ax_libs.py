#!/usr/bin/env python3
"""ax_libs.py <repo> <engine> <library list> — the --library list as compiled library roots, comma-separated on stdout.

An entry is one of
  auto        the project's dependencies, found where it installed them: a Python package in its virtual environment
              (.venv, venv, env, .env, $VIRTUAL_ENV) or a JavaScript / TypeScript package under node_modules, kept only
              when the project's own source imports it
  an IR root  a directory already holding the parser's CSV tables (flat, or one level down), passed through
  a source    a dependency's source directory, compiled once with `bin/axiomcode parser <src> <dir> --library` into
              ~/.cache/axiomcode/libir/ and reused until a file in it changes

Without the cache a source entry was parsed again on every rebuild the graph's refresher started after an edit.
Notes go to stderr; a failure to compile one entry drops that entry and says so, it never fails the build.
"""
import hashlib, json, os, re, subprocess, sys

MARKERS = ('all-types.csv', 'all-typescript-modules.csv', 'all-python-modules.csv', 'all-javascript-modules.csv',
           'all-csharp-modules.csv')
SKIP = {'.git', 'node_modules', '.venv', 'venv', 'env', '.env', '__pycache__', '.axiomcode', 'dist', 'build', '.tox',
        '.mypy_cache', '.pytest_cache', 'site-packages'}
PY_IMPORT = re.compile(r'^\s*(?:from\s+([A-Za-z_][\w]*)[\w.]*\s+import|import\s+([A-Za-z_][\w]*))', re.M)
JS_IMPORT = re.compile(r'''(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]((?:@[\w.-]+/)?[\w.-]+)''')


def note(msg):
    print(f'▶ library: {msg}', file=sys.stderr)


def is_ir(d):
    for m in MARKERS:
        if os.path.isfile(os.path.join(d, m)):
            return True
        try:
            if any(os.path.isfile(os.path.join(d, s, m)) for s in os.listdir(d)):
                return True
        except OSError:
            return False
    return False


def source_files(repo, exts):
    for root, dirs, files in os.walk(repo):
        dirs[:] = [x for x in dirs if x not in SKIP and not x.startswith('.')]
        for f in files:
            if f.endswith(exts):
                yield os.path.join(root, f)


def python_sites(repo):
    envs = [os.path.join(repo, n) for n in ('.venv', 'venv', 'env', '.env')]
    if os.environ.get('VIRTUAL_ENV'):
        envs.append(os.environ['VIRTUAL_ENV'])
    for e in envs:
        if not os.path.isfile(os.path.join(e, 'pyvenv.cfg')):
            continue
        sites = []
        for root in (os.path.join(e, 'lib'), os.path.join(e, 'Lib')):
            if os.path.isdir(os.path.join(root, 'site-packages')):
                sites.append(os.path.join(root, 'site-packages'))
            if os.path.isdir(root):
                sites += [os.path.join(root, d, 'site-packages') for d in sorted(os.listdir(root))
                          if d.startswith('python') and os.path.isdir(os.path.join(root, d, 'site-packages'))]
        if sites:
            return sites
    return []


def discover(repo):
    found, own = [], {d for d in os.listdir(repo) if os.path.isdir(os.path.join(repo, d))}
    src = os.path.join(repo, 'src')
    if os.path.isdir(src):
        own |= {d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))}
    sites = python_sites(repo)
    if sites:
        names = set()
        for f in source_files(repo, ('.py',)):
            try:
                for a, b in PY_IMPORT.findall(open(f, encoding='utf-8', errors='replace').read()):
                    names.add(a or b)
            except OSError:
                pass
        for n in sorted(names - own):
            for s in sites:
                if os.path.isfile(os.path.join(s, n, '__init__.py')) or os.path.isdir(os.path.join(s, n)) and \
                        any(x.endswith('.py') for x in os.listdir(os.path.join(s, n))):
                    found.append(os.path.join(s, n)); break
        note(f'auto: {len(found)} Python package(s) the project imports, from {sites[0]}')
    nm = os.path.join(repo, 'node_modules')
    if os.path.isdir(nm):
        names, before = set(), len(found)
        for f in source_files(repo, ('.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts')):
            try:
                names.update(JS_IMPORT.findall(open(f, encoding='utf-8', errors='replace').read()))
            except OSError:
                pass
        for n in sorted(names):
            if n.startswith('.') or n.startswith('node:'):
                continue
            d = os.path.join(nm, n)
            if os.path.isdir(d) and not os.path.islink(d):
                found.append(d)
        note(f'auto: {len(found) - before} JavaScript / TypeScript package(s) the project imports, from node_modules')
    if not found:
        note('auto: no dependency found (no virtual environment or node_modules in the repository); Java and C# '
             'dependencies are not discovered — name their library IR or source directories instead')
    return found


def stamp(d):
    """A dependency's identity: its path, file count and newest modification time."""
    n, newest = 0, 0.0
    for root, dirs, files in os.walk(d):
        dirs[:] = [x for x in dirs if x != '__pycache__']
        for f in files:
            try:
                newest = max(newest, os.stat(os.path.join(root, f)).st_mtime); n += 1
            except OSError:
                pass
    return hashlib.sha1(f'{os.path.realpath(d)}|{n}|{newest:.0f}'.encode()).hexdigest()[:12]


def compiled(src, engine, cache):
    out = os.path.join(cache, f"{os.path.basename(os.path.normpath(src)) or 'lib'}-{stamp(src)}")
    if os.path.isfile(os.path.join(out, '.complete')):
        return out
    log = out + '.log'
    os.makedirs(cache, exist_ok=True)
    rc = subprocess.run([os.path.join(engine, 'bin', 'axiomcode'), 'parser', src, out, '--library'],
                        stdout=open(log, 'w'), stderr=subprocess.STDOUT).returncode
    if rc != 0 or not is_ir(out):
        note(f'{src} did not compile (rc {rc}, see {log}); not staged')
        return None
    open(os.path.join(out, '.complete'), 'w').close()
    note(f'compiled {src} -> {out}')
    return out


def main():
    repo, engine, spec = sys.argv[1], sys.argv[2], sys.argv[3]
    cache = os.path.join(os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache'), 'axiomcode', 'libir')
    out, seen = [], set()
    for e in [x for x in spec.split(',') if x]:
        entries = discover(repo) if e == 'auto' else [e if os.path.isabs(e) else os.path.join(repo, e)]
        for d in entries:
            if not os.path.isdir(d):
                note(f'not a directory: {d}; not staged'); continue
            r = d if is_ir(d) else compiled(d, engine, cache)
            if r and os.path.realpath(r) not in seen:
                seen.add(os.path.realpath(r)); out.append(r)
    print(','.join(out))


if __name__ == '__main__':
    main()
