#!/usr/bin/env python3
"""GROUND TRUTH FROM THE JDK ITSELF — no third-party analyzer.

Compiles a case with `javac` and reads the invoke instructions out of `javap -p -v`. That is the
same information any bytecode call-graph tool extracts (they all read invokevirtual/invokespecial/
invokestatic/invokeinterface), but here the only dependency is the JDK, so the reference cannot be
contaminated by another tool's resolution choices — and anyone can audit it with javap by hand.

Emitted form (same conventions as normalize_edges.py, so the two are directly comparable):
    Caller#name(params) -> Callee#name(params)
  * nested types named by their dotted chain, `pkg.Outer.Inner` (the IR's qualifiedName form)
  * anonymous classes keyed by SUPERTYPE (`Outer$anon:Runnable`), never by javac's numbering
  * a callee is re-pointed to the class that DECLARES the method (walking extends/implements),
    because bytecode names the receiver's static type
  * excluded on principle, since the source has no such call: bridge / ACC_SYNTHETIC methods,
    access$N, enum values/valueOf/$values, <clinit>, invokedynamic plumbing (the lambda/string-concat
    bootstrap), javac-synthesized default constructors and their implicit super() call, the
    enhanced-for iterator triple, and autoboxing valueOf
  * a lambda body is FOLDED into the method that lexically contains it, taken from the
    invokedynamic site that REFERENCES the body rather than from the body's name: only javac names
    it `lambda$<method>$<n>`, other compilers emit `lambda$<n>` with no method component, and
    parsing that yields a caller named after the counter — a method that exists on neither side.
    It is
    ACC_SYNTHETIC, so it is exempted from the synthetic skip by name — without that exemption the
    body is dropped before it is read and every call written inside a lambda is absent from the
    reference set, which is what makes the folding below reachable at all.
  * a METHOD REFERENCE emits no invoke naming its target: it lowers to invokedynamic, and the
    target is the implementation MethodHandle in the LambdaMetafactory bootstrap arguments. Those
    are read from the BootstrapMethods table, so `X::m` yields the edge to `m`. Any other bootstrap
    (StringConcatFactory) has no such argument and stays excluded.

usage: bytecode_oracle.py <src-dir> <work-dir> [--app-only] [--lib-src <dir>]
"""
import os, re, subprocess, sys, collections

# A code line in `javap -v` output: `  12: invokevirtual #7  // ...`. The other numeric tables
# (LineNumberTable, exception table, LocalVariableTable) carry no `<offset>:` prefix.
INSTR = re.compile(r'^\d+:\s')

UNBOX = re.compile(r'^java\.lang\.(Integer|Long|Short|Byte|Character|Boolean|Double|Float)$')
UNBOX_M = {'intValue', 'longValue', 'shortValue', 'byteValue', 'charValue',
           'booleanValue', 'doubleValue', 'floatValue'}
OPCODE = re.compile(r'^\s*\d+:\s+(\S+)')


def bound_ref_null_check(lines, at):
    """Is the `Objects.requireNonNull` at javap line `at` the receiver null-check javac emits for a
    BOUND method reference? The shape is exact and nothing else produces it:

        dup / invokestatic Objects.requireNonNull(Object)Object / pop / invokedynamic

    An explicitly written `Objects.requireNonNull(x)` has neither the `dup` before nor the
    `pop`+`invokedynamic` after, so it is kept — which matters, because real code writes it a lot.
    """
    def op(j):
        m = OPCODE.match(lines[j]) if 0 <= j < len(lines) else None
        return m.group(1) if m else None
    prev = next((op(j) for j in range(at - 1, max(at - 4, -1), -1) if op(j)), None)
    after = [o for o in (op(j) for j in range(at + 1, min(at + 5, len(lines)))) if o]
    return prev == 'dup' and after[:2] == ['pop', 'invokedynamic']


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

def compile_case(src, work, lib_src=None):
    """Compile the case. A stub library, if the case ships one, is compiled FIRST and put on the
    classpath rather than into the same output — so `dep.*` is a real dependency and not just
    another app package, which is what makes the client->library hand-off a boundary. The engine
    side already treats it that way (run-tests.sh extracts lib-src separately and passes it as
    --library); javac was never told, so a case whose sources import its own stub could not compile
    and its bytecode oracle never ran at all."""
    classes = os.path.join(work, 'classes'); os.makedirs(classes, exist_ok=True)
    cp = []
    if lib_src and os.path.isdir(lib_src):
        libclasses = os.path.join(work, 'lib-classes'); os.makedirs(libclasses, exist_ok=True)
        libfiles = [os.path.join(r, f) for r, _, fs in os.walk(lib_src) for f in fs if f.endswith('.java')]
        if libfiles:
            # BEST EFFORT. A stub may be un-compilable on purpose: 34-object-members stands in for
            # `java.lang` itself, which javac refuses ("package exists in another module") and always
            # will. Such a stub is not needed on the classpath either, because the client compiles
            # against the real platform. So a stub that will not build is skipped rather than fatal,
            # and if the CLIENT then fails to compile, that failure is reported with its own reason.
            # -J-Dstderr.encoding=UTF-8: same reasoning as the javap fix below (#962) -- a
            # localised javac diagnostic is what surfaces as the "reason" text in a skip summary,
            # and stderr is read here as UTF-8 regardless of the console's code page.
            r = subprocess.run(['javac', '-J-Dstderr.encoding=UTF-8', '-g', '-d', libclasses] + libfiles,
                               capture_output=True, text=True, encoding='utf-8')
            if r.returncode == 0: cp = ['-cp', libclasses]
    files = [os.path.join(r, f) for r, _, fs in os.walk(src) for f in fs if f.endswith('.java')]
    r = subprocess.run(['javac', '-J-Dstderr.encoding=UTF-8', '-g', '-d', classes] + cp + files,
                       capture_output=True, text=True, encoding='utf-8')
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
# `10: invokedynamic #22,  0   // InvokeDynamic #0:accept:(Ljava/lang/String;)Ljava/util/function/Consumer;`
INDY = re.compile(r'^\s*\d+:\s+invokedynamic\s+#\d+(?:,\s*\d+)?\s*//\s*InvokeDynamic\s+#(\d+):')
# `  0: #173 REF_invokeStatic java/lang/invoke/LambdaMetafactory.metafactory:(...)`
BSM_HDR = re.compile(r'^\s*(\d+):\s+#\d+\s+REF_\w+\s+([\w$/.]+)\.([\w$<>]+):')
# `      #158 REF_invokeStatic Lam.lambda$viaForEach$0:(Ljava/lang/String;LLam$Item;)V`
BSM_ARG = re.compile(r'^\s*#\d+\s+REF_\w+\s+([\w$/.]+)\.([\w$<>]+):(\S+)\s*$')

def parse(classes, names):
    """-> (supers, declared, edges) with edges = [(callerClass, callerName, callerDesc, kind, owner, name, desc)]"""
    # javap does not encode its output in Python's locale encoding -- it writes through the JVM's
    # stdout.encoding, which on a non-UTF-8 console is the console code page. Nothing couples the
    # two, so `text=True` with no `encoding=` decodes with whatever locale this process happens to
    # have, and disagreement crashes the reader thread (issue #962). Pin both sides to UTF-8.
    out = subprocess.run(['javap', '-J-Dstdout.encoding=UTF-8', '-p', '-v', '-cp', classes] + names,
                         capture_output=True, text=True, encoding='utf-8').stdout.splitlines()
    supers = collections.defaultdict(list); declared = collections.defaultdict(set); is_enum = set()
    # Declarations carrying ACC_SYNTHETIC or ACC_BRIDGE. Kept apart from `declared` because the
    # declaration line is parsed before its `flags:` line is read. The CALLER side below already
    # tests these flags; the CALLEE side tested only the javac NAME list, so a member generated by
    # another compiler was emitted as ground truth. See issue #199.
    synth_declared = collections.defaultdict(set)
    real_declared = collections.defaultdict(set)
    # Instructions per method body, so the EMPTY implicit constructor can be told apart from one
    # that carries field initializers — see default_ctor below.
    ninstr = collections.Counter()
    edges = []
    cls = None; meth = None; mdesc = None; flags = ''
    pending_decl = None; in_code = False
    # A method reference's target is not in any invoke instruction — it is bootstrap argument 1 of a
    # LambdaMetafactory indy. The BootstrapMethods table is printed AFTER the code that uses it, so
    # the sites are collected here and resolved once the whole class has been read.
    bsm = collections.defaultdict(dict)      # cls -> index -> (owner, name, desc)
    indy_sites = []                          # (cls, meth, mdesc, flags, index)
    lambda_in = {}                           # (cls, lambdaBodyName) -> containing method
    in_bsm = None; bsm_idx = None; bsm_is_lambda = False
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
            # javap renders a constructor's name as the class's BINARY name exactly as it printed it
            # in the class header — `pk.D$Inner`, `p.Outer$1` — so that is what it must be compared
            # against. Comparing against a fragment (`cls.split('.')[-1]`, `cls.split('$')[-1]`)
            # happens to match only a top-level class, so EVERY nested, inner, local and anonymous
            # class kept its rendered name as the caller: `pk.Inner#pk.D$Inner(String)`, a method
            # that exists on neither side of the comparison.
            if cls and nm == cls: nm = '<init>'
            if pending_decl.startswith('static {'): nm = '<clinit>'
            meth = nm; flags = ''
            declared[cls].add((meth, tuple(desc_params(mdesc)) if '(' in mdesc else ()))
            pending_decl = None
            continue
        # ── BootstrapMethods table ────────────────────────────────────────────────────────
        if s.startswith('BootstrapMethods:'):
            in_bsm = cls; bsm_idx = None; continue
        if in_bsm is not None:
            if s and not raw.startswith(' '):      # a new top-level section ends the table
                in_bsm = None
            else:
                mh = BSM_HDR.match(line)
                if mh:
                    bsm_idx = int(mh.group(1))
                    bsm_is_lambda = mh.group(2).replace('/', '.') == 'java.lang.invoke.LambdaMetafactory'
                    continue
                ma = BSM_ARG.match(line)
                # bootstrap argument 1 is the implementation handle; the first REF_ argument IS it
                # for a LambdaMetafactory site, and a StringConcatFactory site has none at all.
                if ma and bsm_idx is not None and bsm_is_lambda and bsm_idx not in bsm[in_bsm]:
                    bsm[in_bsm][bsm_idx] = (ma.group(1).replace('/', '.'), ma.group(2), ma.group(3))
                continue
        if s.startswith('flags:') and meth:
            flags = s
            if 'ACC_BRIDGE' in s or 'ACC_SYNTHETIC' in s:
                # A lambda body is ACC_SYNTHETIC and is recorded here too. Harmless: it is reached
                # through invokedynamic and folded into its enclosing method as a CALLER, so it is
                # never a callee. Verified on 05-lambda-and-method-refs, where both readers emit no
                # edge whose callee is a `lambda$` body.
                synth_declared[cls].add((meth, tuple(desc_params(mdesc)) if '(' in mdesc else ()))
            else:
                real_declared[cls].add((meth, tuple(desc_params(mdesc)) if '(' in mdesc else ()))
        # Only instructions inside a `Code:` attribute count. RuntimeInvisibleAnnotations and the
        # constant-pool-style tables print `0: #17(...)` lines of the same shape.
        if s == 'Code:': in_code = True
        elif s.endswith(':') and not INSTR.match(s): in_code = False
        if in_code and meth is not None and INSTR.match(s): ninstr[(cls, meth, mdesc)] += 1
        mi = INVOKE.match(line)
        if not mi and s and s.endswith(';') and '(' in s and not re.match(r'^\d+:', s) \
           and not s.startswith(('descriptor:', 'flags:', '//', '#')):
            pending_decl = s; continue
        # A LAMBDA BODY is ACC_SYNTHETIC. Skipping it drops every call the source wrote inside a
        # lambda, and makes the lambda$ folding further down unreachable — so exempt it by name.
        synthetic = ('ACC_BRIDGE' in flags or 'ACC_SYNTHETIC' in flags) \
                    and not (meth or '').startswith('lambda$')
        di = INDY.match(line)
        if di and cls and meth and not synthetic:
            indy_sites.append((cls, meth, mdesc, flags, int(di.group(1))))
            continue
        if mi and cls and meth:
            if synthetic: continue
            kind, target = mi.group(1), mi.group(2)
            if kind == 'invokedynamic': continue
            if ':' not in target: continue
            owner_name, desc = target.rsplit(':', 1)
            owner, name = owner_name.rsplit('.', 1) if '.' in owner_name else (cls, owner_name)
            name = name.strip('"')
            edges.append((cls, meth, mdesc, flags, kind, owner.replace('/', '.'), name, desc, i))
    # Which method lexically contains each lambda body: the one holding the indy that names it.
    for c, m, md, fl, idx in indy_sites:
        t = bsm.get(c, {}).get(idx)
        if t and t[0] == c and t[1].startswith('lambda$'):
            lambda_in.setdefault((c, t[1]), m)
    for c, m, md, fl, idx in indy_sites:
        t = bsm.get(c, {}).get(idx)
        if not t: continue                      # not a LambdaMetafactory site (string concat, ...)
        owner, name, desc = t
        # a lambda BODY is folded into its enclosing method already; only a reference to a real
        # method is an edge. `X::new` is a constructor target and follows the ctor conventions.
        if name.startswith('lambda$'): continue
        edges.append((c, m, md, fl, 'invokedynamic', owner, name, desc, -1))
    # A KEY THAT ALSO NAMES A REAL METHOD IS NOT SYNTHETIC: the key is (name, params) with no
    # return type, and a covariant-return override declares the real method and its bridge under
    # the same one. Keeping those keeps `super.clone()`; a generated helper with no real twin,
    # like ecj's `$SWITCH_TABLE$<type>()`, is still excluded.
    for c in list(synth_declared):
        synth_declared[c] -= real_declared.get(c, set())
    return supers, declared, edges, is_enum, lambda_in, out, ninstr, synth_declared

def main():
    src, work = sys.argv[1], sys.argv[2]
    app_only = '--app-only' in sys.argv
    lib_src = sys.argv[sys.argv.index('--lib-src') + 1] if '--lib-src' in sys.argv else None
    classes, names = compile_case(src, work, lib_src)
    supers, declared, edges, _kw, lambda_in, javap, ninstr, synth_declared = parse(classes, names)
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
    def chain(c):
        # The binary name's `$`-separated tail is the nesting chain; javac prefixes a LOCAL class
        # (declared inside a method body) with an index: `class Local {}` inside a method compiles
        # to Outer$1Local. The index is a compiler artefact — the source name is `Local` — so strip
        # it, or every local class reads as a different type on the two sides.
        pkg = c[:c.rindex('.')] if '.' in c else ''
        parts = [re.sub(r'^\d+(?=[A-Za-z_$])', '', p) for p in c.split('.')[-1].split('$')]
        dotted = '.'.join(parts)
        return f"{pkg}.{dotted}" if pkg else dotted
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
                anon[c] = chain(sp)
            else:
                anon[c] = f"{chain(c.rsplit('$', 1)[0])}$anon:{sp.split('.')[-1].split('$')[-1]}"
    def cname(c):
        if c in anon: return anon[c]
        if c in app: return chain(c)
        return c
    SYN = re.compile(r'^(access\$\d+|\$values|values|valueOf|\$deserializeLambda\$)$')
    BOX = re.compile(r'^java\.lang\.(Integer|Long|Short|Byte|Character|Boolean|Double|Float)$')
    seen = set()
    for cls, meth, mdesc, flags, kind, owner, name, desc, at in edges:
        if meth == '<clinit>' or SYN.match(meth) or SYN.match(name): continue
        if owner.startswith('java.lang.invoke'): continue
        if name == 'makeConcatWithConstants' or owner == 'java.lang.StringBuilder': continue
        if owner == 'java.lang.String' and name == 'valueOf' and desc_params(desc) == ['Object']: continue
        if BOX.match(owner) and name == 'valueOf' and desc_params(desc) and desc_params(desc)[0] in PRIM.values(): continue
        # ── javac LOWERING: an invoke instruction for which the source contains no call ──────
        # The four below are the same mechanism as the boxing `valueOf` and StringBuilder
        # exclusions already above: a language construct that compiles to an invoke nobody wrote.
        # Leaving one in does not merely lose a point — it scores the engine as having MISSED a
        # call site that is not in the file, which is a wrong number, not a missing one.
        #
        # UNBOXING. The `valueOf` half was already excluded; `intValue()` is the same construct
        # read the other way (`int n = someInteger;`). Whether an explicitly written
        # `x.intValue()` is also dropped is not decidable from the instruction — it compiles
        # identically — so this follows the choice `valueOf` already made and drops both. Measured
        # on the scale corpus: 1,005 rows of this shape against 15 written `.intValue()`-family
        # calls in the same sources.
        if UNBOX.match(owner) and name in UNBOX_M and not desc_params(desc): continue
        # ENHANCED FOR. This was already excluded, but keyed on the receiver's static type being
        # in `java.util` — so `for (X x : someIterable)` over a `java.lang.Iterable`, or over a
        # CLIENT class implementing it, kept all three calls. Key it on the mechanism instead: an
        # `iterator()` returning `java.util.Iterator`, and `hasNext`/`next` on anything that is one.
        if name == 'iterator' and not desc_params(desc) and desc.endswith(')Ljava/util/Iterator;'): continue
        if name in ('hasNext', 'next') and not desc_params(desc) \
           and (owner == 'java.util.Iterator' or 'java.util.Iterator' in ancestors(owner)): continue
        # TRY-WITH-RESOURCES. `addSuppressed` is emitted only by the compiler's generated handler;
        # the corpus sources contain one written call to it against 246 rows of this shape.
        if name == 'addSuppressed' and desc_params(desc) == ['Throwable']: continue
        # A BOUND METHOD REFERENCE (`x::m`) null-checks its receiver. Unlike the three above this
        # one IS decidable — javac emits `dup / invokestatic requireNonNull / pop / invokedynamic`
        # and nothing else does — so an explicitly written `Objects.requireNonNull(x)`, of which
        # this corpus has many, is kept. 447 rows of this shape at scale, 0 written calls in the
        # project that contributed most of them.
        if owner == 'java.util.Objects' and name == 'requireNonNull' and bound_ref_null_check(javap, at): continue
        # A javac-synthesized default constructor has no source body, so it is not a CALLER and its
        # implicit super() is not a call. `new X()` naming it IS written in the source, though, and
        # is kept — excluding it made every such creation unscorable in either direction, so an
        # engine that emits it looked like it was inventing edges.
        #
        # EMPTY is the test, not "the class declares no constructor". A class with FIELD
        # INITIALIZERS has a generated constructor too, and javac compiles the initializers into
        # it — those calls are written in the source and belong to `<init>`. Keying the skip on
        # the absence of a declared constructor threw them away, which made every call in a field
        # initializer invisible to this oracle. The body of a genuinely empty one is exactly
        # `aload_0; invokespecial super.<init>()V; return`, which is the same structural test
        # ClassFileOracle.java makes.
        if meth == '<init>' and (mdesc or '').startswith('()') and ninstr.get((cls, meth, mdesc)) == 3:
            continue
        caller_name = meth
        lam = meth.startswith('lambda$')
        if lam:
            # the indy site that references this body names its container, whatever the body is
            # called; fall back to the javac name shape only when nothing references it
            c = lambda_in.get((cls, meth))
            seen_l = 0
            while c is not None and c.startswith('lambda$') and seen_l < 8:
                c = lambda_in.get((cls, c)); seen_l += 1
            if c is None:
                m2 = re.match(r'^lambda\$(.+)\$\d+$', meth)
                c = m2.group(1) if m2 else meth[len('lambda$'):]
            # javac names a lambda declared in a CONSTRUCTOR (or in a field initializer, which it
            # compiles into one) `lambda$new$N`: the enclosing method is the constructor.
            caller_name = '<init>' if c == 'new' else c
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
        # SYNTHETIC CALLEE, by FLAG rather than by name. `SYN` is javac's vocabulary, so a helper
        # another compiler generates -- ecj lowers an enum switch into `$SWITCH_TABLE$<type>()` and
        # calls it -- was emitted as a must-have edge for a call the source does not contain.
        # Tested against the DECLARING class, which is what the emitted edge names. Kept in step
        # with ClassFileOracle deliberately: oracle_agreement.py pins the two readers against each
        # other, and fixing one alone would be recorded as the readers disagreeing.
        if (name, tuple(desc_params(desc))) in synth_declared.get(dc, ()): continue
        cp = ','.join(desc_params(mdesc)) if mdesc and '(' in mdesc else ''
        if lam: cp = '*'
        seen.add(f"{cname(cls)}#{caller_name}({cp}) -> {cname(dc)}#{name}({','.join(desc_params(desc))})")
    for s in sorted(seen): print(s)

if __name__ == '__main__':
    main()
