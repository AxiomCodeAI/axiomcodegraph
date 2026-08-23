#!/usr/bin/env python3
"""GROUND TRUTH FROM THE JDK ITSELF — no third-party analyzer.

Compiles a case with `javac` and reads the invoke instructions out of `javap -p -v`. That is the
same information any bytecode call-graph tool extracts (they all read invokevirtual/invokespecial/
invokestatic/invokeinterface), but here the only dependency is the JDK, so the reference cannot be
contaminated by another tool's resolution choices — and anyone can audit it with javap by hand.

Emitted form (same conventions as normalize_edges.py, so the two are directly comparable):
    Caller#name(params) -> Callee#name(params)
  * nested types flattened to `pkg.SimpleName` (accepted convention, matches the IR)
  * anonymous classes keyed by SUPERTYPE (`Outer$anon:Runnable`), never by javac's numbering
  * a callee is re-pointed to the class that DECLARES the method (walking extends/implements),
    because bytecode names the receiver's static type
  * excluded on principle, since the source has no such call: bridge / ACC_SYNTHETIC methods,
    access$N, enum values/valueOf/$values, <clinit>, invokedynamic plumbing (the lambda/string-concat
    bootstrap), javac-synthesized default constructors and their implicit super() call, the
    enhanced-for iterator triple, and autoboxing valueOf
  * a lambda body (`lambda$m$N`) is FOLDED into the method that lexically contains it

usage: bytecode_oracle.py <src-dir> <work-dir> [--app-only]
"""
import os, re, subprocess, sys, collections

PRIM = {'B':'byte','C':'char','D':'double','F':'float','I':'int','J':'long','S':'short','Z':'boolean','V':'void'}

def desc_params(desc):
    inner = desc[desc.index('(')+1:desc.rindex(')')]
    out, i = [], 0
    while i < len(inner):
        arr = 0
        while inner[i] == '[': arr += 1; i += 1
        if inner[i] == 'L':
            j = inner.index(';', i); t = inner[i+1:j].replace('/', '.'); i = j + 1
        else:
            t = PRIM[inner[i]]; i += 1
        out.append(t.split('.')[-1].split('$')[-1] + '[]' * arr)
    return out

def compile_case(src, work):
    classes = os.path.join(work, 'classes'); os.makedirs(classes, exist_ok=True)
    files = [os.path.join(r, f) for r, _, fs in os.walk(src) for f in fs if f.endswith('.java')]
    r = subprocess.run(['javac', '-g', '-d', classes] + files, capture_output=True, text=True)
    if r.returncode: sys.exit(f"javac failed:\n{r.stdout}{r.stderr}")
    names = []
    for root, _, fs in os.walk(classes):
        for f in fs:
            if f.endswith('.class'):
                names.append(os.path.relpath(os.path.join(root, f), classes)[:-6].replace(os.sep, '.'))
    return classes, sorted(names)

CLASS_HDR = re.compile(r'^(?:(?:public|protected|private|final|abstract|static|sealed|non-sealed|strictfp)\s+)*'
                       r'(class|interface|enum|record|@interface)\s+([\w$.]+)(?:<[^>]*>)?'
                       r'(?:\s+extends\s+([\w$.<>,\s]+?))?(?:\s+implements\s+([\w$.<>,\s]+?))?\s*\{?\s*$')
INVOKE = re.compile(r'^\s*\d+:\s+(invokevirtual|invokespecial|invokestatic|invokeinterface|invokedynamic)\s+#\d+'
                    r'(?:,\s*\d+)?\s*//\s*(?:Interface)?Method\s+([^\s]+)')

def parse(classes, names):
    """-> (supers, declared, edges) with edges = [(callerClass, callerName, callerDesc, kind, owner, name, desc)]"""
    out = subprocess.run(['javap', '-p', '-v', '-cp', classes] + names,
                         capture_output=True, text=True).stdout.splitlines()
    supers = collections.defaultdict(list); declared = collections.defaultdict(set); is_enum = set()
    edges = []
    cls = None; meth = None; mdesc = None; flags = ''
    pending_decl = None
    for i, raw in enumerate(out):
        line = raw.rstrip(); s = line.strip()
        m = CLASS_HDR.match(s)
        if m and (m.group(2) in names or '.' in m.group(2)):
            cls = m.group(2).split('<')[0]; meth = None
            for g in (m.group(3), m.group(4)):
                if g:
                    for x in re.split(r',\s*(?![^<>]*>)', g):
                        x = re.sub(r'<.*', '', x).strip()
                        if x: supers[cls].append(x)
            continue
        if s.startswith('descriptor: ') and pending_decl is not None:
            mdesc = s.split('descriptor: ', 1)[1]
            nm = pending_decl.split('(')[0].strip().split()[-1] if '(' in pending_decl else pending_decl
            if cls and (nm == cls.split('.')[-1] or nm == cls.split('$')[-1]): nm = '<init>'
            if pending_decl.startswith('static {'): nm = '<clinit>'
            meth = nm; flags = ''
            declared[cls].add((meth, tuple(desc_params(mdesc)) if '(' in mdesc else ()))
            pending_decl = None
            continue
        if s.startswith('flags:') and meth: flags = s
        mi = INVOKE.match(line)
        if not mi and s and s.endswith(';') and '(' in s and not re.match(r'^\d+:', s) \
           and not s.startswith(('descriptor:', 'flags:', '//', '#')):
            pending_decl = s; continue
        if mi and cls and meth:
            if 'ACC_BRIDGE' in flags or 'ACC_SYNTHETIC' in flags: continue
            kind, target = mi.group(1), mi.group(2)
            if kind == 'invokedynamic': continue
            if ':' not in target: continue
            owner_name, desc = target.rsplit(':', 1)
            owner, name = owner_name.rsplit('.', 1) if '.' in owner_name else (cls, owner_name)
            name = name.strip('"')
            edges.append((cls, meth, mdesc, flags, kind, owner.replace('/', '.'), name, desc))
    return supers, declared, edges, is_enum

def main():
    src, work = sys.argv[1], sys.argv[2]
    app_only = '--app-only' in sys.argv
    classes, names = compile_case(src, work)
    supers, declared, edges, _kw = parse(classes, names)
    # javap prints an enum as `class X extends java.lang.Enum`, with no `enum` keyword, so identify
    # enums by that supertype — which is the bytecode truth anyway.
    is_enum = {c for c, ps in supers.items() if any(p == 'java.lang.Enum' for p in ps)}
    app = set(names)

    def ancestors(c, seen=None):
        seen = seen or set(); out = []
        for p in supers.get(c, []):
            if p in seen: continue
            seen.add(p); out.append(p); out.extend(ancestors(p, seen))
        return out
    anon = {}
    for c in sorted(app):
        if c.split('$')[-1].isdigit():
            ps = supers.get(c, [])
            sp = next((x for x in ps if x != 'java.lang.Object'), 'Object')
            pkg = c[:c.rindex('.')] if '.' in c else ''
            # An ENUM CONSTANT BODY (`ADD { int apply(..) {..} }`) is compiled to an anonymous
            # subclass of the enum, but the IR attributes those methods to the ENUM ITSELF — there is
            # no separate source type. Map it back to the enum so the two sides agree; keying it as
            # `$anon:Op` would report every enum-constant method as a caller mismatch.
            if sp in is_enum:
                anon[c] = (f"{pkg}." if pkg else '') + sp.split('.')[-1].split('$')[-1]
            else:
                anon[c] = f"{(pkg + '.') if pkg else ''}{c.split('$')[0].split('.')[-1]}$anon:{sp.split('.')[-1].split('$')[-1]}"
    def cname(c):
        if c in anon: return anon[c]
        if c in app:
            pkg = c[:c.rindex('.')] if '.' in c else ''
            simple = c.split('.')[-1].split('$')[-1]
            # javac prefixes a LOCAL class (declared inside a method body) with an index:
            # `class Local {}` inside a method compiles to Outer$1Local. The index is a compiler
            # artefact — the source name is `Local` — so strip it, or every local class reads as a
            # different type on the two sides.
            m2 = re.match(r'^\d+([A-Za-z_$].*)$', simple)
            if m2: simple = m2.group(1)
            return f"{pkg}.{simple}" if pkg else simple
        return c
    # classes with a SOURCE-declared constructor: javac's implicit ctor has no source twin
    src_txt = ''
    for r, _, fs in os.walk(src):
        for f in fs:
            if f.endswith('.java'): src_txt += open(os.path.join(r, f), errors='replace').read()
    SYN = re.compile(r'^(access\$\d+|\$values|values|valueOf|\$deserializeLambda\$)$')
    BOX = re.compile(r'^java\.lang\.(Integer|Long|Short|Byte|Character|Boolean|Double|Float)$')
    ITER = {('java.util.Iterator', 'hasNext'), ('java.util.Iterator', 'next')}
    seen = set()
    for cls, meth, mdesc, flags, kind, owner, name, desc in edges:
        if meth == '<clinit>' or SYN.match(meth) or SYN.match(name): continue
        if owner.startswith('java.lang.invoke'): continue
        if name == 'makeConcatWithConstants' or owner == 'java.lang.StringBuilder': continue
        if owner == 'java.lang.String' and name == 'valueOf' and desc_params(desc) == ['Object']: continue
        if BOX.match(owner) and name == 'valueOf' and desc_params(desc) and desc_params(desc)[0] in PRIM.values(): continue
        if (owner, name) in ITER or (name == 'iterator' and owner.startswith('java.util')): continue
        # javac-synthesized default ctor: caller has no source twin; and its implicit super() call
        simple_cls = cls.split('.')[-1].split('$')[-1]
        if meth == '<init>' and not re.search(r'\b' + re.escape(simple_cls) + r'\s*\([^)]*\)\s*(?:throws[^{]*)?\{', src_txt):
            if name == '<init>': continue                      # implicit super()
        if name == '<init>' and owner in app:
            oc = owner.split('.')[-1].split('$')[-1]
            if not re.search(r'\b' + re.escape(oc) + r'\s*\([^)]*\)\s*(?:throws[^{]*)?\{', src_txt): continue
        caller_name = meth
        lam = re.match(r'^lambda\$(.+)\$\d+$', meth)
        if lam: caller_name = lam.group(1)
        if app_only and owner not in app: continue
        # re-point to the class that DECLARES the method (bytecode names the receiver's type)
        dc = owner
        if name != '<init>' and (name, tuple(desc_params(desc))) not in declared.get(owner, ()):
            found = False
            for a in ancestors(owner):
                if (name, tuple(desc_params(desc))) in declared.get(a, ()): dc = a; found = True; break
            if not found:
                # nothing in the app hierarchy declares it -> it is INHERITED FROM A LIBRARY class
                # (ListExt.size() from java.util.ArrayList, anon.getName() from java.lang.Thread).
                # That is a client->library edge, not a client->client one.
                if app_only: continue
        if app_only and dc not in app: continue
        cp = ','.join(desc_params(mdesc)) if mdesc and '(' in mdesc else ''
        if lam: cp = '*'
        seen.add(f"{cname(cls)}#{caller_name}({cp}) -> {cname(dc)}#{name}({','.join(desc_params(desc))})")
    for s in sorted(seen): print(s)

if __name__ == '__main__':
    main()
