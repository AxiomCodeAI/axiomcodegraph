#!/usr/bin/env python3
"""packaging/root-skill.py [--check] — the copy of the skill that Gemini CLI reads, at skills/axiomcode/.

Gemini CLI installs an extension from the repository root and finds skills only in <root>/skills/, while
the skill lives in plugins/axiomcode/skills/ where every other host reads it. A symlink does not survive
the install: Gemini clones into a temporary directory, copies it with fs.cp, which rewrites a relative
link into an absolute one inside that directory, and then deletes the directory.

So skills/axiomcode/ holds a copy of SKILL.md and reference/, and nothing else. The scripts stay in the
plugin: the copy's fallback command is rewritten to reach them from the repository root, which Gemini
installs whole. Run this after editing the skill; tests/manifests.py fails while the copy differs.

    python3 packaging/root-skill.py          write the copy
    python3 packaging/root-skill.py --check  exit 1 if the copy is stale
"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode')
COPY = os.path.join(ROOT, 'skills', 'axiomcode')
SCRIPTS = '`<this dir>/scripts/axiomcode'
FROM_ROOT = '`<this dir>/../../plugins/axiomcode/skills/axiomcode/scripts/axiomcode'


def expected():
    """{relative path: text} of the copy as it should be"""
    files = {}
    with open(os.path.join(SOURCE, 'SKILL.md')) as f:
        text = f.read()
    if SCRIPTS not in text:
        sys.exit(f"root-skill: SKILL.md no longer names {SCRIPTS}…; update the rewrite in {__file__}")
    files['SKILL.md'] = text.replace(SCRIPTS, FROM_ROOT)
    for name in sorted(os.listdir(os.path.join(SOURCE, 'reference'))):
        with open(os.path.join(SOURCE, 'reference', name)) as f:
            files[os.path.join('reference', name)] = f.read()
    return files


def actual():
    files = {}
    for dirpath, _, names in os.walk(COPY):
        for name in names:
            path = os.path.join(dirpath, name)
            with open(path) as f:
                files[os.path.relpath(path, COPY)] = f.read()
    return files


def main():
    want = expected()
    if '--check' in sys.argv:
        stale = sorted(k for k in set(want) | set(actual()) if want.get(k) != actual().get(k))
        for path in stale:
            print(f"skills/axiomcode/{path} differs from the plugin's skill; run python3 packaging/root-skill.py")
        return 1 if stale else 0
    shutil.rmtree(COPY, ignore_errors=True)
    for path, text in want.items():
        os.makedirs(os.path.dirname(os.path.join(COPY, path)), exist_ok=True)
        with open(os.path.join(COPY, path), 'w') as f:
            f.write(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
