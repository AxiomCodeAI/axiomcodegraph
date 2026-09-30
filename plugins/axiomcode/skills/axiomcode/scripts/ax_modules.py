"""Which build module a Java file belongs to, and which modules it can see: read from pom.xml and build.gradle.

A test runs with its own module's classpath: the module's classes, and those of the modules it depends on, directly
or through another module. A listener declared in a module the test's module does not depend on is not on that
classpath, so no event the test publishes can reach it, however well the event's type fits. The graph is one
graph per language and holds every module's code together, so without this an event published in a shared library
module reached a listener in an application module that depends on the library, and the library's own tests were
credited with the listener.

Read here, from the build files, because the graph does not model modules:
  - Maven: a directory holding pom.xml is a module; its <artifactId>, its <dependencies> (every scope), and the
    <dependencies> of an in-repository <parent>, which a child inherits. Only artifacts declared by some pom in the
    repository are modules here; a dependency on anything else is outside the question.
  - Gradle: a directory holding build.gradle or build.gradle.kts is a module; a `project(':a:b')` it names is the
    module at a/b under the settings root (or the projectDir settings.gradle assigns it).
A file under no build file, or a module this cannot place, is UNKNOWN, and an unknown side is visible: this only
ever removes a link it can show is impossible, never one it cannot read.
"""
import os
import re
import xml.etree.ElementTree as ET

BUILD_FILES = ('pom.xml', 'build.gradle', 'build.gradle.kts')


def _local(tag):
    return tag.rsplit('}', 1)[-1]


def _child(el, name):
    for c in list(el):
        if _local(c.tag) == name:
            return c
    return None


def _text(el, name):
    c = _child(el, name) if el is not None else None
    return (c.text or '').strip() if c is not None and c.text else ''


class Modules:
    def __init__(self, repo):
        self.repo = repo
        self._dir_of = {}           # relative directory -> module directory ('' is the root) or None
        self._deps = None           # module directory -> set of module directories it depends on directly
        self._closure = {}

    # ── where a file belongs ─────────────────────────────────────────────────────────────────────────────
    def module_of(self, rel):
        """the module directory (relative, '' for the root) holding rel, or None when no build file encloses it"""
        d = os.path.dirname((rel or '').replace('\\', '/'))
        seen = []
        while True:
            if d in self._dir_of:
                m = self._dir_of[d]; break
            seen.append(d)
            if any(os.path.isfile(os.path.join(self.repo, d, b)) for b in BUILD_FILES):
                m = d; break
            if not d:
                m = None; break
            d = os.path.dirname(d)
        for x in seen: self._dir_of[x] = m
        return m

    # ── what each module depends on ──────────────────────────────────────────────────────────────────────
    def _scan(self):
        poms, gradles = {}, {}
        skip = {'.git', '.axiomcode', 'node_modules', 'target', 'build', '.gradle', '.idea'}
        for root, dirs, files in os.walk(self.repo):
            dirs[:] = [x for x in dirs if x not in skip and not x.startswith('.')]
            rel = os.path.relpath(root, self.repo).replace('\\', '/')
            rel = '' if rel == '.' else rel
            if 'pom.xml' in files: poms[rel] = os.path.join(root, 'pom.xml')
            for b in ('build.gradle', 'build.gradle.kts'):
                if b in files: gradles[rel] = os.path.join(root, b)
        deps = {}
        # Maven
        info = {}
        for d, p in poms.items():
            try: r = ET.parse(p).getroot()
            except (ET.ParseError, OSError): continue
            par = _child(r, 'parent')
            dl = _child(r, 'dependencies')
            info[d] = dict(aid=_text(r, 'artifactId'), parent=_text(par, 'artifactId') if par is not None else '',
                           deps=[_text(x, 'artifactId') for x in (list(dl) if dl is not None else []) if _local(x.tag) == 'dependency'])
        by_aid = {}
        for d, i in info.items():
            if i['aid']: by_aid.setdefault(i['aid'], d)
        def inherited(d, depth=0):
            i = info.get(d)
            if not i or depth > 20: return []
            pd = by_aid.get(i['parent'])
            return i['deps'] + (inherited(pd, depth + 1) if pd is not None and pd != d else [])
        for d in info:
            deps[d] = {by_aid[a] for a in inherited(d) if a in by_aid and by_aid[a] != d}
        # Gradle
        settings_dirs = {}
        for d in gradles:
            for s in ('settings.gradle', 'settings.gradle.kts'):
                sp = os.path.join(self.repo, d, s)
                if os.path.isfile(sp):
                    try: txt = open(sp, errors='replace').read()
                    except OSError: txt = ''
                    for pth, pd in re.findall(r"""project\(\s*['"](:[\w.:-]+)['"]\s*\)\s*\.projectDir\s*=\s*(?:new\s+File\([^,]+,\s*|file\()\s*['"]([^'"]+)['"]""", txt):
                        settings_dirs[pth] = os.path.normpath(os.path.join(d, pd)).replace('\\', '/')
        roots = sorted((d for d in gradles if any(os.path.isfile(os.path.join(self.repo, d, s)) for s in ('settings.gradle', 'settings.gradle.kts'))), key=len)
        for d, p in gradles.items():
            try: txt = open(p, errors='replace').read()
            except OSError: continue
            root = next((r for r in reversed(roots) if not r or d == r or d.startswith(r + '/')), '')
            out = deps.setdefault(d, set())
            for pth in re.findall(r"""project\(\s*(?:path\s*[:=]\s*)?['"](:[\w.:-]*)['"]""", txt):
                tgt = settings_dirs.get(pth) or '/'.join(x for x in [root] + pth.strip(':').split(':') if x)
                if tgt != d and tgt in gradles: out.add(tgt)
        self._deps = deps

    def sees(self, from_mod, to_mod):
        """can code in from_mod load a class declared in to_mod? True whenever either side is unknown"""
        if from_mod is None or to_mod is None or from_mod == to_mod:
            return True
        if self._deps is None: self._scan()
        if from_mod not in self._deps or to_mod not in self._deps:
            return True
        if from_mod not in self._closure:
            seen, todo = set(), [from_mod]
            while todo:
                x = todo.pop()
                for y in self._deps.get(x, ()):
                    if y not in seen: seen.add(y); todo.append(y)
            self._closure[from_mod] = seen
        return to_mod in self._closure[from_mod]
