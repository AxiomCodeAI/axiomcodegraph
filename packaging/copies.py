#!/usr/bin/env python3
"""packaging/copies.py [--check] — files two hosts need in their own place, written from one source.

skills/axiomcode/                       the skill's text, for Gemini CLI
plugins/axiomcode/rules/axiomcode.mdc   AGENTS.md as an always-applied rule, for Cursor

Gemini:

Gemini CLI installs an extension from the repository root and finds skills only in <root>/skills/, while
the skill lives in plugins/axiomcode/skills/ where every other host reads it. A symlink does not survive
the install: Gemini clones into a temporary directory, copies it with fs.cp, which rewrites a relative
link into an absolute one inside that directory, and then deletes the directory.

So skills/axiomcode/ holds a copy of SKILL.md and reference/, and nothing else. The scripts stay in the
plugin: the copy's fallback command is rewritten to reach them from the repository root, which Gemini
installs whole.

Cursor: a plugin's always-on guidance is a rule, a .mdc file with frontmatter, where the other hosts read
AGENTS.md. The rule is AGENTS.md under that frontmatter.

Run this after editing the skill or AGENTS.md; tests/manifests.py fails while a copy differs.

    python3 packaging/copies.py          write the copies
    python3 packaging/copies.py --check  exit 1 if a copy is stale
"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SOURCE = os.path.join(ROOT, 'plugins', 'axiomcode', 'skills', 'axiomcode')
COPY = os.path.join(ROOT, 'skills', 'axiomcode')
AGENTS = os.path.join(ROOT, 'plugins', 'axiomcode', 'AGENTS.md')
RULE = os.path.join(ROOT, 'plugins', 'axiomcode', 'rules', 'axiomcode.mdc')
RULE_HEAD = """---
description: Ask the repository's call graph (axiomcode MCP tools) before searching text, for how code connects
alwaysApply: true
---

"""
SCRIPTS = '`<this dir>/scripts/axiomcode'
FROM_ROOT = '`<this dir>/../../plugins/axiomcode/skills/axiomcode/scripts/axiomcode'


def expected():
    """{relative path: text} of the copy as it should be"""
    files = {}
    with open(os.path.join(SOURCE, 'SKILL.md')) as f:
        text = f.read()
    if SCRIPTS not in text:
        sys.exit(f"copies: SKILL.md no longer names {SCRIPTS}…; update the rewrite in {__file__}")
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


def rule():
    with open(AGENTS) as f:
        return RULE_HEAD + f.read()


def main():
    want = expected()
    if '--check' in sys.argv:
        stale = [f"skills/axiomcode/{k}" for k in sorted(set(want) | set(actual())) if want.get(k) != actual().get(k)]
        current = open(RULE).read() if os.path.isfile(RULE) else None
        if current != rule():
            stale.append(os.path.relpath(RULE, ROOT))
        for path in stale:
            print(f"{path} differs from its source; run python3 packaging/copies.py")
        return 1 if stale else 0
    shutil.rmtree(COPY, ignore_errors=True)
    for path, text in want.items():
        os.makedirs(os.path.dirname(os.path.join(COPY, path)), exist_ok=True)
        with open(os.path.join(COPY, path), 'w') as f:
            f.write(text)
    os.makedirs(os.path.dirname(RULE), exist_ok=True)
    with open(RULE, 'w') as f:
        f.write(rule())
    return 0


if __name__ == '__main__':
    sys.exit(main())
