#!/usr/bin/env python3
"""stripper.py [--scripts <dir>] — fixtures for `Impact.code`, the comment and string stripper.

The stripper decides what the `[text]` certainty, type-parameter matching and the Java type-reference layer can see: a name
inside a comment or a string is not a use, and a construct it mis-parses shifts the scan and hides real code for the rest of
the file. Each fixture states, for one small source, which names must SURVIVE the blanking (they are code) and which must
VANISH (they are comment or string). Runs in a second, needs no graph.
"""
import importlib.util, os, sys, tempfile

S = sys.argv[sys.argv.index('--scripts') + 1] if '--scripts' in sys.argv else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'skills', 'axiomcode', 'scripts')
spec = importlib.util.spec_from_loader('im', importlib.machinery.SourceFileLoader('im', os.path.join(S, 'axiomcode-impact')))
mod = importlib.util.module_from_spec(spec)
try: spec.loader.exec_module(mod)
except SystemExit: pass

class Stripper(mod.Impact):
    def __init__(self): self.src = {}
    def lines(self, f): return open(f, errors='replace').read().split('\n')

# (name, filename, source, must survive, must vanish)
CASES = [
 ("java text block", "A.java", '''class A {
  String s = """
     <p>Widget said "hi"</p>
     """;
  void f() { Widget w; }
}''', ["class A", "Widget w", "void f"], ["<p>", "said", "hi"]),

 ("java text block, then a real string", "B.java", '''class B {
  String a = """
     Ghost
     """;
  String b = "Phantom";
  void g() { Real r; }
}''', ["Real r", "void g", "String b"], ["Ghost", "Phantom"]),

 ("js regex with a quote", "c.js", """const a = s.replace(/'/g, '');
function f(){ Widget.go(); }""", ["s.replace", "Widget.go", "function f"], []),

 ("js regex with a class holding a slash", "d.js", """const re = /[/'"]+/g;
function h(){ Kept.call(); }""", ["Kept.call", "function h", "const re"], []),

 ("js division is not a regex", "e.js", """const x = a / b; const y = c / d;
function i(){ Survivor.run(); }""", ["Survivor.run", "const x", "const y"], []),

 ("js template literal", "f.js", """const t = `hello ${name} Ghost`;
function j(){ Alive.go(); }""", ["Alive.go", "const t"], ["hello", "Ghost"]),

 ("python triple quotes", "g.py", '''def f():
    """Ghost docstring mentioning Widget"""
    return Real()
''', ["def f", "Real()"], ["Ghost", "docstring"]),

 ("python hash comment", "h.py", """x = 1  # Ghost comment
def k(): return Alive()""", ["def k", "Alive()", "x = 1"], ["Ghost", "comment"]),

 ("block comment holding a quote", "I.java", '''class I {
  /* it's a comment mentioning Widget */
  void m() { Real r; }
}''', ["void m", "Real r", "class I"], ["Widget", "comment"]),

 ("line comment holding a brace and quote", "J.java", '''class J {
  int a = 1; // don't } care about Widget
  void n() { Real r; }
}''', ["void n", "Real r", "int a"], ["care", "Widget"]),

 ("escaped quote in a string", "K.java", '''class K {
  String s = "a \\" Ghost b";
  void o() { Real r; }
}''', ["void o", "Real r"], ["Ghost"]),

 ("annotation with a string argument", "L.java", '''class L {
  @Route("/Ghost/path")
  void p() { Real r; }
}''', ["@Route", "void p", "Real r"], ["Ghost", "path"]),
]

def main():
    st = Stripper(); bad = 0; n = 0
    with tempfile.TemporaryDirectory() as T:
        for name, fn, src, survive, vanish in CASES:
            p = os.path.join(T, fn); open(p, 'w').write(src)
            out = '\n'.join(st.code(p))
            if len(out) != len(src) or out.count('\n') != src.count('\n'):
                print(f"  ✗ {name}: the blanked text changed shape ({len(src)} chars / {src.count(chr(10))} newlines → {len(out)} / {out.count(chr(10))})"); bad += 1
            for s_ in survive:
                n += 1
                if s_ not in out: print(f"  ✗ {name}: `{s_}` is code and was blanked"); bad += 1
            for v in vanish:
                n += 1
                if v in out: print(f"  ✗ {name}: `{v}` is comment or string and survived"); bad += 1
    print(f"stripper: {len(CASES)} fixtures, {n} assertions, {bad} wrong")
    return 1 if bad else 0

if __name__ == '__main__': sys.exit(main())
