#!/usr/bin/env python3
"""
Self-test for the ORACLE: WHICH CALLS IT SAYS HAPPEN, not how they are scored.

score-selftest.py tests the join, from synthetic oracle rows. Nothing tested the
rows themselves, and a shape the oracle emits NO row for is the one failure the
rest of the harness cannot see: it is not scored as agreement, it is not counted as
engine-only either, so a correct engine edge and a missing one read the same.
README.md's claim that scoring against the compiler makes "a rule wrong in the same
way as the golden passes forever" impossible only holds where the ground truth asks
the question.

That is what #1170 was: a compound assignment yielded its SETTER alone, `++` its
GETTER alone, and a property access written without a receiver yielded nothing at
all -- so `b.Computed = 1` and `b.Computed += 1` were indistinguishable to the
scorer, and case 04 scored 100% either way.

The cases below are real C# read by the real oracle, because the defect was in what
Roslyn was asked, and a synthetic row cannot be wrong about that.

EVERY CASE CARRIES ITS CONTROL. A rule that emits both accessors everywhere would
pass a test that only checks the compound form, so each case asserts the SIMPLE form
beside it -- and the shapes that bind to a property while calling nothing (`nameof`,
a named argument's label) are asserted to stay silent.

    ./oracle-selftest.py [--oracle <path>] [-v]

Exit status: 0 if every case passes, 1 otherwise. 77 if the oracle is not built, so
a machine without dotnet skips rather than fails.
"""
import argparse
import csv
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_ORACLE = os.path.join(HERE, "AxiomCsOracle", "bin", "Release", "net8.0", "axiom-cs-oracle")


def run(oracle, source):
    """Run the oracle over one file of C# and return {line: {(siteKind, targetName)}}."""
    with tempfile.TemporaryDirectory(prefix="cs-oracle-selftest-") as tmp:
        src = os.path.join(tmp, "src")
        os.makedirs(src)
        with open(os.path.join(src, "Probe.cs"), "w", encoding="utf-8") as fh:
            fh.write(source)
        out = os.path.join(tmp, "oracle.tsv")
        p = subprocess.run([oracle, "--src", src, "--out", out],
                           capture_output=True, text=True)
        if p.returncode != 0:
            raise RuntimeError(f"the oracle failed: {p.stderr.strip()}")
        # A fixture that does not compile is not evidence about the oracle: Roslyn
        # binds what it can and the missing rows would read as the defect under test.
        manifest = os.path.splitext(out)[0] + ".manifest.tsv"
        with open(manifest, newline="", encoding="utf-8") as fh:
            kv = dict(r[:2] for r in csv.reader(fh, delimiter="\t") if len(r) >= 2)
        if kv.get("compileErrors") != "0":
            raise RuntimeError(f"the fixture does not compile ({kv.get('compileErrors')} errors)")
        rows = {}
        with open(out, newline="", encoding="utf-8") as fh:
            for r in csv.DictReader(fh, delimiter="\t"):
                rows.setdefault(int(r["line"]), set()).add((r["siteKind"], r["targetName"]))
        return rows


PROP = "property_accessor"
IDX = "indexer"

# Each case is (title, source, [(line, expected set)]). The line numbers are 1-based
# into the source as written, so the fixtures are laid out one shape per line and the
# comment on the line names what it asserts.
CASES = [
    (
        "a compound assignment on a property calls BOTH accessors",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public string? T { get; set; }
    public void Simple(Q o) { o.V = 1; }        // the control: a write alone
    public void Read(Q o) { int x = o.V; }      // the control: a read alone
    public void Compound(Q o) { o.V += 1; }     // get AND set
    public void Coalesce(Q o) { o.T ??= "a"; }  // get AND set -- `??=` is compound too
}
""",
        [(6, {(PROP, "set_V")}),
         (7, {(PROP, "get_V")}),
         (8, {(PROP, "get_V"), (PROP, "set_V")}),
         (9, {(PROP, "get_T"), (PROP, "set_T")})],
    ),
    (
        "`++` and `--` on a property call BOTH accessors",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public void Post(Q o) { o.V++; }            // get AND set
    public void Pre(Q o) { --o.V; }             // get AND set
    public int Negate(Q o) => -o.V;             // the control: `-` only reads
}
""",
        [(5, {(PROP, "get_V"), (PROP, "set_V")}),
         (6, {(PROP, "get_V"), (PROP, "set_V")}),
         (7, {(PROP, "get_V")})],
    ),
    (
        "a property access with no receiver is a call",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public static int S { get; set; }
    public int Field;
    public int Read() => V;                     // this.get_V
    public void Write() { V = 1; }              // this.set_V
    public void Bump() { V += 1; }              // get AND set
    public void Step() { V++; }                 // get AND set
    public static int Static() => S;            // no receiver of any kind
    public int Qualified() => this.V;           // the control: the written form
    public int FieldRead() => Field;            // the control: a field is not a call
    public int ParamRead(int V2) => V2;         // the control: a local name
}
""",
        [(7, {(PROP, "get_V")}),
         (8, {(PROP, "set_V")}),
         (9, {(PROP, "get_V"), (PROP, "set_V")}),
         (10, {(PROP, "get_V"), (PROP, "set_V")}),
         (11, {(PROP, "get_S")}),
         (12, {(PROP, "get_V")}),
         (13, set()),
         (14, set())],
    ),
    (
        "a property named but not called yields no row",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public void Take(int i) { }
    public string Name() => nameof(V);          // a compile-time string, no accessor
    public void Named() { Take(i: V); }         // `i:` is a parameter; `V` IS a read
    public bool Pattern(object o) => o is Q { V: 1 };  // the matcher's read, not a site
}
""",
        [(6, set()),
         (7, {("invocation", "Take"), (PROP, "get_V")}),
         (8, set())],
    ),
    (
        "a null-conditional property access is a call",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public int? Maybe(Q? o) => o?.V;            // get_V, through a member binding
    public int Plain(Q o) => o.V;               // the control: the same read written out
}
""",
        [(5, {(PROP, "get_V")}),
         (6, {(PROP, "get_V")})],
    ),
    (
        "an object initializer writes the property",
        """namespace Probe;
public class Q
{
    public int V { get; set; }
    public Q Make() => new Q { V = 1 };         // set_V, and no read
    public Q Empty() => new Q();                // the control: no member initializer
}
""",
        [(5, {("object_creation", ".ctor"), (PROP, "set_V")}),
         (6, {("object_creation", ".ctor")})],
    ),
    (
        "an indexer compounds exactly as a property does",
        """namespace Probe;
public class Q
{
    private readonly int[] _s = new int[4];
    public int this[int i] { get => _s[i]; set => _s[i] = value; }
    public void Write(Q o) { o[0] = 1; }        // the control: a write alone
    public int Read(Q o) => o[0];               // the control: a read alone
    public void Compound(Q o) { o[0] += 1; }    // get AND set
    public void Step(Q o) { o[0]++; }           // get AND set
    public int Array(int[] a) => a[0];          // the control: an array is not a call
}
""",
        [(6, {(IDX, "set_Item")}),
         (7, {(IDX, "get_Item")}),
         (8, {(IDX, "get_Item"), (IDX, "set_Item")}),
         (9, {(IDX, "get_Item"), (IDX, "set_Item")}),
         (10, set())],
    ),
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--oracle", default=DEFAULT_ORACLE)
    ap.add_argument("-v", action="store_true")
    a = ap.parse_args()
    if not os.access(a.oracle, os.X_OK):
        print(f"oracle self-test: SKIP (not built: {a.oracle})")
        return 77

    passed = failed = 0
    for title, source, want in CASES:
        try:
            rows = run(a.oracle, source)
        except Exception as ex:                       # noqa: BLE001 - reported, not raised
            failed += 1
            print(f"  ✗ {title}\n      {ex}")
            continue
        bad = [(line, exp, rows.get(line, set())) for line, exp in want
               if rows.get(line, set()) != exp]
        if bad:
            failed += 1
            print(f"  ✗ {title}")
            for line, exp, got in bad:
                print(f"      line {line}: {source.splitlines()[line - 1].strip()}")
                print(f"        want {sorted(exp)}")
                print(f"        got  {sorted(got)}")
        else:
            passed += 1
            print(f"  ✓ {title}" + (f"  ({len(want)} lines)" if a.v else ""))

    print(f"\noracle self-test: {passed} passed, {failed} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
