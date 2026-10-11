#!/usr/bin/env python3
"""ax_libs.py <repo> <engine> <library list> — the --library list as compiled library roots, comma-separated on stdout.

An entry is one of
  auto        the project's dependencies, found where it installed them: a Python package in its virtual environment
              (.venv, venv, env, .env, $VIRTUAL_ENV) or a JavaScript / TypeScript package under node_modules, kept only
              when the project's own source imports it; a Java dependency pom.xml / build.gradle declares, through its
              -sources.jar or its class jar decompiled; a NuGet package a .csproj references, decompiled with ilspycmd
  an IR root  a directory already holding the parser's CSV tables (flat, or one level down), passed through
  a source    a dependency's source directory (a NuGet assembly is decompiled to C# first), compiled once with `bin/axiomcode parser <src> <dir> --library` into
              ~/.cache/axiomcode/libir/ and reused until a file in it changes

Without the cache a source entry was parsed again on every rebuild the graph's refresher started after an edit.
Notes go to stderr; a failure to compile one entry drops that entry and says so, it never fails the build.
"""
import glob, hashlib, json, os, re, shutil, subprocess, sys, zipfile
import xml.etree.ElementTree as ET

MARKERS = ('all-types.csv', 'all-typescript-modules.csv', 'all-python-modules.csv', 'all-javascript-modules.csv',
           'all-csharp-modules.csv')
SKIP = {'.git', 'node_modules', '.venv', 'venv', 'env', '.env', '__pycache__', '.axiomcode', 'dist', 'build', '.tox',
        '.mypy_cache', '.pytest_cache', 'site-packages'}
PY_IMPORT = re.compile(r'^\s*(?:from\s+([A-Za-z_][\w]*)[\w.]*\s+import|import\s+([A-Za-z_][\w]*))', re.M)
JS_IMPORT = re.compile(r'''(?:from\s+|require\(\s*|import\(\s*|import\s+)['"]((?:@[\w.-]+/)?[\w.-]+)''')


CACHE = os.path.join(os.environ.get('XDG_CACHE_HOME') or os.path.expanduser('~/.cache'), 'axiomcode', 'libir')


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
    found += java_sources(repo)
    found += csharp_sources(repo)
    if not found:
        note('auto: no dependency found (no virtual environment, node_modules, Maven or Gradle sources jar, or NuGet '
             'package for this repository)')
    return found


def maven_repo(repo):
    cfg = os.path.join(repo, '.mvn', 'maven.config')
    if os.path.isfile(cfg):
        m = re.search(r'-Dmaven\.repo\.local=(\S+)', open(cfg, encoding='utf-8').read())
        if m:
            return m.group(1) if os.path.isabs(m.group(1)) else os.path.join(repo, m.group(1))
    return os.path.join(os.path.expanduser('~'), '.m2', 'repository')


GRADLE_DEP = re.compile(r"""["']([\w.-]+):([\w.-]+):([\w.+-]+)["']""")


def java_coordinates(repo):
    """(group, artifact, version) of every dependency a pom.xml or build.gradle(.kts) in the repository declares."""
    out = []
    for pom in glob.glob(os.path.join(repo, '**', 'pom.xml'), recursive=True):
        if any(x in SKIP for x in os.path.relpath(pom, repo).split(os.sep)):
            continue
        try:
            root = ET.parse(pom).getroot()
        except (ET.ParseError, OSError):
            continue
        ns = root.tag[:root.tag.index('}') + 1] if root.tag.startswith('{') else ''
        props = {}
        for pr in root.findall(f'{ns}properties'):
            props.update({c.tag.replace(ns, ''): (c.text or '').strip() for c in pr})
        sub = lambda v: re.sub(r'\$\{([^}]+)\}', lambda m: props.get(m.group(1), m.group(0)), v or '')
        for d in root.iter(f'{ns}dependency'):
            g, a, v = (sub(d.findtext(f'{ns}{k}')) for k in ('groupId', 'artifactId', 'version'))
            if g and a:
                out.append((g, a, v))
    for gf in glob.glob(os.path.join(repo, '**', 'build.gradle*'), recursive=True):
        if any(x in SKIP for x in os.path.relpath(gf, repo).split(os.sep)):
            continue
        out += GRADLE_DEP.findall(open(gf, encoding='utf-8', errors='replace').read())
    return out


def java_decompiler(m2):
    if os.environ.get('AXIOMCODE_JAVA_DECOMPILER'):
        return os.environ['AXIOMCODE_JAVA_DECOMPILER']
    for root in (m2, os.path.join(os.path.expanduser('~'), '.m2', 'repository')):
        jars = sorted(glob.glob(os.path.join(root, 'org', 'vineflower', 'vineflower', '*', 'vineflower-*.jar')))
        if jars and shutil.which('java'):
            return jars[-1]
    return None


def java_sources(repo):
    """The dependencies' -sources.jar, unpacked once under the cache, or their class jar decompiled with Vineflower."""
    found, decompiled, missing, undecompiled = [], [], [], []
    m2 = maven_repo(repo)
    decompiler = java_decompiler(m2)
    gradle = os.path.join(os.path.expanduser('~'), '.gradle', 'caches', 'modules-2', 'files-2.1')
    for g, a, v in sorted(set(java_coordinates(repo))):
        base = os.path.join(m2, *g.split('.'), a)
        known = sorted(os.listdir(base)) if os.path.isdir(base) else []
        ver = v if v in known else (known[-1] if known and (not v or '$' in v) else v)
        cands = glob.glob(os.path.join(base, ver or '-', f'{a}-{ver}-sources.jar'))
        cands += glob.glob(os.path.join(gradle, g, a, v or '*', '*', f'{a}-*-sources.jar'))
        if cands:
            jar = sorted(cands)[-1]
            dest = os.path.join(CACHE, 'src', os.path.basename(jar)[:-len('.jar')])
            if not os.path.isfile(os.path.join(dest, '.unpacked')):
                os.makedirs(dest, exist_ok=True)
                with zipfile.ZipFile(jar) as z:
                    z.extractall(dest, [n for n in z.namelist() if n.endswith('.java')])
                open(os.path.join(dest, '.unpacked'), 'w').close()
            found.append(dest); continue
        # no sources jar: the class jar is decompiled to Java instead
        bins = glob.glob(os.path.join(base, ver or '-', f'{a}-{ver}.jar'))
        bins += [j for j in glob.glob(os.path.join(gradle, g, a, v or '*', '*', f'{a}-*.jar')) if not j.endswith('-sources.jar')]
        if not bins:
            missing.append(f'{g}:{a}:{v}'); continue
        if not decompiler:
            undecompiled.append(f'{g}:{a}:{v}'); continue
        jar = sorted(bins)[-1]
        dest = os.path.join(CACHE, 'src', os.path.basename(jar)[:-len('.jar')] + '-decompiled')
        if not os.path.isfile(os.path.join(dest, '.decompiled')):
            os.makedirs(dest, exist_ok=True)
            subprocess.run(['java', '-jar', decompiler, jar, dest], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not glob.glob(os.path.join(dest, '**', '*.java'), recursive=True):
                missing.append(f'{g}:{a}:{v} (did not decompile)'); continue
            open(os.path.join(dest, '.decompiled'), 'w').close()
        decompiled.append(dest)
    if found or decompiled:
        note(f'auto: {len(found)} Java dependency source jar(s) and {len(decompiled)} decompiled class jar(s), from {m2}')
    if undecompiled:
        note(f'auto: {len(undecompiled)} Java dependency(ies) with no sources jar ({", ".join(undecompiled[:5])}) and no '
             'decompiler: `mvn dependency:sources` fetches sources, or `mvn dependency:get '
             '-Dartifact=org.vineflower:vineflower:1.10.1` the decompiler')
    if missing:
        note(f'auto: {len(missing)} Java dependency(ies) not in the repository ({", ".join(missing[:5])}'
             f'{" …" if len(missing) > 5 else ""}); `mvn dependency:resolve` fetches them')
    return found + decompiled


def nuget_folder(repo):
    if os.environ.get('NUGET_PACKAGES'):
        return os.environ['NUGET_PACKAGES']
    for cfg in glob.glob(os.path.join(repo, '[Nn]u[Gg]et.[Cc]onfig')):
        m = re.search(r'key="globalPackagesFolder"\s+value="([^"]+)"', open(cfg, encoding='utf-8', errors='replace').read())
        if m:
            return m.group(1) if os.path.isabs(m.group(1)) else os.path.join(repo, m.group(1))
    return os.path.join(os.path.expanduser('~'), '.nuget', 'packages')


def csharp_packages(repo):
    """(id, version) of every PackageReference a .csproj declares; a version Directory.Packages.props sets centrally."""
    central, out = {}, []
    for props in glob.glob(os.path.join(repo, '**', 'Directory.Packages.props'), recursive=True):
        for i, v in re.findall(r'<PackageVersion\s+Include="([^"]+)"\s+Version="([^"]+)"', open(props, errors='replace').read()):
            central[i.lower()] = v
    for proj in glob.glob(os.path.join(repo, '**', '*.csproj'), recursive=True):
        if any(x in SKIP for x in os.path.relpath(proj, repo).split(os.sep)):
            continue
        text = open(proj, encoding='utf-8', errors='replace').read()
        for i, attrs, body in re.findall(r'<PackageReference\s+Include="([^"]+)"([^>]*?)(?:/>|>(.*?)</PackageReference>)', text, re.S):
            v = re.search(r'Version="([^"]+)"', attrs) or re.search(r'<Version>([^<]+)</Version>', body or '')
            out.append((i, v.group(1) if v else central.get(i.lower(), '')))
    return out


def ilspy():
    for c in (os.environ.get('AXIOMCODE_ILSPY'), shutil.which('ilspycmd'),
              os.path.join(os.path.expanduser('~'), '.dotnet', 'tools', 'ilspycmd')):
        if c and os.path.isfile(c):
            return c
    return None


def csharp_sources(repo):
    """NuGet packages ship assemblies, not source: each one is decompiled once into C# and compiled like a source."""
    pkgs = sorted(set(csharp_packages(repo)))
    if not pkgs:
        return []
    tool, folder, found, missing = ilspy(), nuget_folder(repo), [], []
    if not tool:
        note(f'auto: {len(pkgs)} NuGet package(s) declared, but C# libraries are compiled by decompiling them and '
             'ilspycmd is not installed: `dotnet tool install -g ilspycmd` (8.x runs on a .NET 8 SDK); not staged')
        return []
    for pid, ver in pkgs:
        base = os.path.join(folder, pid.lower())
        known = sorted(os.listdir(base)) if os.path.isdir(base) else []
        v = ver if ver in known else (known[-1] if known and not ver else None)
        libdir = os.path.join(base, v, 'lib') if v else ''
        tfms = sorted(os.listdir(libdir)) if libdir and os.path.isdir(libdir) else []
        dlls = glob.glob(os.path.join(libdir, tfms[-1], '*.dll')) if tfms else []
        if not dlls:
            missing.append(f'{pid} {ver}'); continue
        dest = os.path.join(CACHE, 'src', f'{pid.lower()}-{v}')
        if not os.path.isfile(os.path.join(dest, '.decompiled')):
            env = dict(os.environ, DOTNET_ROLL_FORWARD='Major')
            for dll in dlls:
                out = os.path.join(dest, os.path.splitext(os.path.basename(dll))[0])
                subprocess.run([tool, '-p', '-o', out, dll], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            if not glob.glob(os.path.join(dest, '**', '*.cs'), recursive=True):
                missing.append(f'{pid} {ver} (did not decompile)'); continue
            open(os.path.join(dest, '.decompiled'), 'w').close()
        found.append(dest)
    note(f'auto: {len(found)} NuGet package(s), decompiled from {folder}')
    if missing:
        note(f'auto: {len(missing)} NuGet package(s) not in that folder ({", ".join(missing[:5])}); `dotnet restore` fetches them')
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
    if os.path.realpath(src).startswith(os.path.realpath(cache) + os.sep):
        try: os.utime(src)                  # unpacked or decompiled under the cache: in use while its compiled form is
        except OSError: pass
    out = os.path.join(cache, f"{os.path.basename(os.path.normpath(src)) or 'lib'}-{stamp(src)}")
    if os.path.isfile(os.path.join(out, '.complete')):
        return out
    log = out + '.log'
    os.makedirs(cache, exist_ok=True)
    # bin/axiomcode is a bash script: run through bash, which Windows cannot do for it (WinError 193)
    rc = subprocess.run([os.environ.get('AXIOMCODE_BASH') or 'bash', os.path.join(engine, 'bin', 'axiomcode'), 'parser', src, out, '--library'],
                        stdout=open(log, 'w'), stderr=subprocess.STDOUT).returncode
    if rc != 0 or not is_ir(out):
        note(f'{src} did not compile (rc {rc}, see {log}); not staged')
        return None
    open(os.path.join(out, '.complete'), 'w').close()
    note(f'compiled {src} -> {out}')
    return out


def main():
    repo, engine, spec = sys.argv[1], sys.argv[2], sys.argv[3]
    cache = CACHE
    out, seen = [], set()
    for e in [x for x in spec.split(',') if x]:
        entries = discover(repo) if e == 'auto' else [e if os.path.isabs(e) else os.path.join(repo, e)]
        for d in entries:
            if not os.path.isdir(d):
                note(f'not a directory: {d}; not staged'); continue
            r = d if is_ir(d) else compiled(d, engine, cache)
            if r and os.path.realpath(r) not in seen:
                seen.add(os.path.realpath(r)); out.append(r)
    prune(out)
    print(','.join(out))


PRUNE_DAYS = 30


def prune(used):
    """Every compiled library this build staged is marked used; one no build has staged for PRUNE_DAYS is removed,
    with its source unpacked or decompiled under src/. Only entries this cache wrote are touched."""
    import time
    now, keep = time.time(), {os.path.realpath(u) for u in used}
    for u in keep:
        if u.startswith(os.path.realpath(CACHE) + os.sep):
            try: os.utime(u)
            except OSError: pass
    try:
        entries = [os.path.join(CACHE, e) for e in os.listdir(CACHE)] + \
                  [os.path.join(CACHE, 'src', e) for e in (os.listdir(os.path.join(CACHE, 'src')) if os.path.isdir(os.path.join(CACHE, 'src')) else [])]
    except OSError:
        return
    for e in entries:
        if os.path.realpath(e) in keep or os.path.basename(e) == 'src' or not os.path.isdir(e):
            continue
        marked = any(os.path.isfile(os.path.join(e, m)) for m in ('.complete', '.unpacked', '.decompiled'))
        try:
            idle = now - os.stat(e).st_mtime
        except OSError:
            continue
        if marked and idle > PRUNE_DAYS * 86400:
            shutil.rmtree(e, ignore_errors=True)
            try: os.remove(e + '.log')
            except OSError: pass


if __name__ == '__main__':
    main()
