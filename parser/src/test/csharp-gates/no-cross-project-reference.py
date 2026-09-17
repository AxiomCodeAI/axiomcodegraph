#!/usr/bin/env python3
"""
Gate: NO fixture project may reference another fixture project.

WHY. cs-fixtures found that re-partitioning the corpus changes compilation-unit membership:
Lambdas.cs sees Fixtures.cs as a SOURCE symbol under staging/ and as a METADATA symbol from
Annotations.dll under categories/. Same bytes, different SymbolKind, and ZERO
DeclaringSyntaxReferences.

That is UNADJUDICABLE. The parser reads files, never assemblies, so it always sees source. An
oracle blessing taken from a tree where the same symbol is metadata has no syntax to compare
against, so every such case reads as a parser defect when it is an artifact of how the corpus
was partitioned. It would also silently break the partial-type gate, which keys on
DeclaringSyntaxReferences: a partial whose other part became metadata reports zero parts.

So this is not a style rule. A ProjectReference between fixture projects makes a whole class of
expectation unblessable, and the failure presents as a parser bug.

RUN
    python3 src/test/csharp-gates/no-cross-project-reference.py [fixture-root]

Hermetic: no dotnet, no network, no compilation. Exits 1 on any violation, and 1 — never 0 —
if the fixture tree is absent, so an unrunnable gate can never be mistaken for a passing one.

SCOPE, stated because the count was queried. This gate walks the FIXTURE tree only, by default
`src/test-data/csharp`. The repository tracks 72 `.csproj` files; 71 are fixture projects and the
72nd is `tools/csharp/adjudicator/adjudicator.csproj`.

That tool is DELIBERATELY out of scope and it is not an oversight. It is a Roslyn adjudicator: it
must reference `Microsoft.CodeAnalysis.CSharp` from metadata, because that is what it is for.
Applying the fixture rule to it would forbid the thing it exists to do. The rule is about FIXTURE
symbols resolving as source so the oracle has syntax to compare against — a tool has no
expectations blessed from it.

So "71" and "72" are both right and count different populations. The gate prints which it used.
"""
import os, re, sys

DEFAULT_ROOT = os.path.join(os.path.dirname(__file__), '..', '..', 'test-data', 'csharp')

# A <Reference> to one of these is the framework, not a fixture. Anything else is suspect.
FRAMEWORK_ASSEMBLY = re.compile(
    r'^(System($|\.)|Microsoft\.(CSharp|VisualBasic|Win32)|mscorlib|netstandard|WindowsBase|PresentationCore)',
    re.I)

PROJECT_REFERENCE = re.compile(r'<ProjectReference\b[^>]*Include\s*=\s*"([^"]+)"', re.I)
BARE_REFERENCE = re.compile(r'<Reference\b[^>]*Include\s*=\s*"([^"]+)"', re.I)
HINT_PATH = re.compile(r'<HintPath\b', re.I)


def main(argv):
    root = os.path.abspath(argv[1] if len(argv) > 1 else DEFAULT_ROOT)
    if not os.path.isdir(root):
        print(f'FAIL: fixture tree not found at {root}')
        print('      This gate cannot run, which is NOT the same as passing.')
        return 1

    projects = []
    for dp, dn, fn in os.walk(root):
        dn[:] = [d for d in dn if d not in ('obj', 'bin', '.git')]
        projects += [os.path.join(dp, f) for f in fn if f.endswith('.csproj')]

    if not projects:
        print(f'FAIL: no .csproj under {root} — the gate has no subject')
        return 1

    violations = []
    for p in sorted(projects):
        try:
            text = open(p, encoding='utf-8').read()
        except OSError as e:
            violations.append((p, 'UNREADABLE', str(e))); continue
        rel = os.path.relpath(p, root)
        for m in PROJECT_REFERENCE.finditer(text):
            violations.append((rel, 'ProjectReference', m.group(1)))
        for m in BARE_REFERENCE.finditer(text):
            inc = m.group(1).split(',')[0].strip()
            if not FRAMEWORK_ASSEMBLY.match(inc):
                violations.append((rel, 'Reference (non-framework)', inc))
        if HINT_PATH.search(text):
            violations.append((rel, 'HintPath', 'references an assembly on disk'))

    print(f'{len(projects)} FIXTURE projects checked under {os.path.relpath(root, os.getcwd())}')
    print('  (scope is the fixture tree; tool projects such as tools/csharp/adjudicator are')
    print('   deliberately excluded — a Roslyn tool must reference Roslyn from metadata)')
    if not violations:
        print('no cross-project reference — every fixture symbol resolves as SOURCE')
        return 0
    print(f'\n{len(violations)} VIOLATION(S) — these make expectations unblessable:\n')
    for rel, kind, what in violations:
        print(f'  {rel}\n      {kind} -> {what}')
    print('\nFix by MOVING the files into one project or DUPLICATING the referenced type.')
    print('Do not work around it: the symbol must be source in the canonical tree.')
    return 1


if __name__ == '__main__':
    sys.exit(main(sys.argv))
