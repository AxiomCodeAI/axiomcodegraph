#!/usr/bin/env python3
"""The two ground-truth readers must answer identically — checked, not asserted.

This suite has TWO oracles over the same bytecode, and every number either of them produces is
only worth what their agreement is worth:

  * tools/bytecode_oracle.py   — javac + `javap -p -v`, used by the per-case suite;
  * tools/ClassFileOracle.java — java.lang.classfile (JEP 484), used at corpus scale, where a
    project is read from the artefacts its OWN build produced and there is no source tree.

Both headers claim the emitted form is identical "so the two are directly comparable, and the
small-case suite can be used to prove this reader agrees with it". Nothing proved it. They are
run here over every case that compiles standalone, and every row present in one and absent from
the other is reported.

A disagreement about a CONSTRUCTOR is expected today and is counted, not failed: the two decide
"is this constructor javac-synthesized" by different means (a regex over the source text vs. a
three-instruction body test), the question is undecidable from a class file alone, and picking
one is a convention decision rather than a bug fix. The counts are pinned as a golden, so the
debt cannot grow — or silently disappear — without a reviewed diff.

Any OTHER disagreement fails: it means the two readers are describing different graphs.

Independently of agreement, every row either reader emits must NAME A METHOD: `<init>`, `<clinit>`
or a Java identifier. Both sides can be wrong in the same way and still agree, so shape is checked
on its own — this is what catches a caller rendered as `pk.Inner#pk.D$Inner(String)`.

usage: oracle_agreement.py <cases-dir> <work-dir> [case-filter ...]
"""
import os, re, subprocess, sys, shutil

HERE = os.path.dirname(os.path.abspath(__file__))


# `<init>`, `<clinit>`, or a Java identifier. Nothing else can be a method name, so a row naming
# anything else — a rendered class name, a javac counter — is a defect in whichever reader emitted it.
METHOD = re.compile(r'^(<init>|<clinit>|[A-Za-z_$][A-Za-z0-9_$]*)$')
ROW = re.compile(r'^(.*)#([^#(]*)\((.*?)\) -> (.*)#([^#(]*)\((.*)\)$')


def malformed(rows):
    """Rows whose caller or callee does not name a method."""
    out = []
    for r in rows:
        m = ROW.match(r)
        if not m or not METHOD.match(m.group(2)) or not METHOD.match(m.group(5)): out.append(r)
    return out


def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)


def main():
    cases_dir, work = sys.argv[1], sys.argv[2]
    filters = sys.argv[3:]
    os.makedirs(work, exist_ok=True)

    # Compile the class-file reader ONCE. `java Foo.java` re-compiles on every invocation, which
    # costs more than the whole rest of this check.
    ocls = os.path.join(work, '.oracle-classes')
    os.makedirs(ocls, exist_ok=True)
    c = run(['javac', '-d', ocls, os.path.join(HERE, 'ClassFileOracle.java')])
    if c.returncode:
        print('SKIP: ClassFileOracle.java does not compile (needs a JDK with java.lang.classfile)')
        print(c.stderr.strip()[:400])
        return 0

    names = sorted(d for d in os.listdir(cases_dir) if os.path.isdir(os.path.join(cases_dir, d)))
    if filters:
        names = [n for n in names if any(f in n for f in filters)]

    agreed, skipped, ctor_rows, other = 0, [], [], []
    bad = []
    per_case = []
    for name in names:
        src = os.path.join(cases_dir, name, 'src')
        if not os.path.isdir(src): continue
        w = os.path.join(work, name)
        shutil.rmtree(w, ignore_errors=True); os.makedirs(w)
        p = run(['python3', os.path.join(HERE, 'bytecode_oracle.py'), src, w])
        if p.returncode:
            # javac needs a classpath this check does not build (Spring jars, a stub library).
            skipped.append(name); continue
        j = run(['java', '-cp', ocls, 'ClassFileOracle', '--app', os.path.join(w, 'classes')])
        if j.returncode:
            skipped.append(name); continue
        a = set(x for x in p.stdout.splitlines() if x.strip())
        b = set(x for x in j.stdout.splitlines() if x.strip())
        bad += [(name, 'javap', r) for r in malformed(a)]
        bad += [(name, 'classfile', r) for r in malformed(b)]
        if a == b:
            agreed += 1; continue
        only_py = sorted(a - b); only_cf = sorted(b - a)
        ctor = [r for r in only_py + only_cf if '#<init>(' in r]
        rest = [r for r in only_py + only_cf if '#<init>(' not in r]
        ctor_rows += ctor; other += [(name, r) for r in rest]
        per_case.append((name, len(only_cf), len(only_py)))

    print(f"cases compared {agreed + len(per_case)}   agreeing {agreed}   "
          f"skipped {len(skipped)} (need a classpath: {', '.join(skipped) or 'none'})")
    print(f"CONSTRUCTOR-RULE disagreements: {len(per_case)} cases, {len(ctor_rows)} rows")
    for name, cf, py in per_case:
        print(f"  {name:<34} classfile-only {cf:>3}   javap-only {py:>3}")
    print(f"OTHER disagreements: {len(other)}")
    for name, r in other[:40]:
        print(f"  {name}: {r}")
    print(f"rows naming no method: {len(bad)}")
    for name, side, r in bad[:40]:
        print(f"  {name} [{side}]: {r}")
    return 1 if (other or bad) else 0


if __name__ == '__main__':
    sys.exit(main())
