#!/usr/bin/env python3
"""GROUND TRUTH FOR FIELD ACCESS, FROM THE JDK ITSELF — no third-party analyzer.

The sibling of tools/bytecode_oracle.py, reading the FIELD instructions instead of the invoke
instructions: `getfield`, `getstatic`, `putfield`, `putstatic` out of `javap -p -v`. Those four
opcodes ARE the answer to "who reads or writes this field" — every bytecode tool extracts the same
thing — and the only dependency is the JDK, so the reference cannot be contaminated by another
analyzer's resolution choices. Anybody can audit a row with javap by hand.

Emitted form, one line per (caller, field, direction):

    Caller#name(params) READ  Owner#field
    Caller#name(params) WRITE Owner#field

`readwrite` is NOT a bytecode concept: `f += 1` compiles to a getfield and a putfield, so the
oracle emits both rows and the engine's single `readwrite` row is scored as satisfying both. The
scorer (tools/score_fields.py) does that expansion; this file stays a literal reading of the
instructions.

CONVENTIONS, identical to bytecode_oracle.py so the two are directly comparable:
  * nested types named by their dotted chain, `pkg.Outer.Inner`
  * anonymous classes keyed by SUPERTYPE (`Outer$anon:Runnable`); an enum-constant body folds
    back to the ENUM
  * a local class's javac index is stripped (`Outer$1Local` -> `Local`)
  * a lambda body folds into the method that lexically contains it, params `*`, taken from the
    invokedynamic site that references it
  * the OWNER is re-pointed to the class that DECLARES the field (bytecode names the receiver's
    static type, and a field is not virtual, so the declaring class is the storage location)

EXCLUDED, because the source contains no such access — the same principle as the lowering
exclusions in bytecode_oracle.py, and each one is a construct the compiler writes, not the author:
  * `this$0`, `this$1`, … the synthetic outer-instance link of an inner class
  * `val$x` the synthetic capture of a local by an inner/anonymous class
  * `$assertionsDisabled`, `$VALUES`, `$SwitchMap$…`, `$SWITCH_TABLE$…` compiler scaffolding
  * any field carrying ACC_SYNTHETIC in its own declaration
  * a field access inside a synthetic method (access$N, a bridge), except a lambda body
  * an ACCESS THROUGH A SYNTHETIC ACCESSOR is folded into the method that wrote it. javac routes
    a read of a PRIVATE member of a nested class from its enclosing (or sibling) class through a
    generated `access$N`, so the getfield sits in a synthetic method the source does not contain
    and the real caller has no field instruction at all. The same convention the lambda body
    already uses: the access is re-attributed to every method that invokes the accessor.
  * `<clinit>` and `<init>`: OPTIONAL, and off by default. A field INITIALIZER is compiled into
    one of them and the IR attributes it to the enclosing TYPE rather than to a method, so the
    two sides name the caller differently for a reason that has nothing to do with this issue.
    `--with-initializers` keeps them and names the caller `Class#<clinit>()` / `Class#<init>(...)`.

A COMPILE-TIME CONSTANT IS NOT VISIBLE HERE AT ALL. `static final int N = 32;` is inlined at
every use (JLS 13.1), so the class file holds a `ConstantValue` attribute and no getstatic
anywhere. The source reads the field; the bytecode cannot say so, and scoring an engine that
reports the read as a false positive would be scoring the compiler. `--inlined-out <path>`
writes the `Owner#field` list of every such field so the scorer can drop those accesses from
BOTH sides rather than charge one of them.

A CONSTRUCTOR's parameters are rewritten by javac in two cases, and both are undone so the caller
reads as it is written: an ENUM's gets the constant's name and ordinal prepended (`Method(boolean)`
is compiled as `<init>(String,int,boolean)`), and an INNER class's gets the enclosing instance
(`CleaningVisitor(Element,Element)` becomes `<init>(Cleaner,Element,Element)`). An inner class is
identified by its synthetic `this$N` field, which is what carries that instance.

usage: field_oracle.py --classes <dir>[,...] [--app-only] [--with-initializers] [--inlined-out F]
       field_oracle.py <src-dir> <work-dir> [--app-only] [--lib-src <dir>] [--with-initializers]
"""
import os, re, subprocess, sys, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bytecode_oracle import desc_params, compile_case, CLASS_HDR, INSTR, PRIM  # noqa: E402


def strip_generics(s):
    """Remove every balanced <...> group from a javap class-header line.

    CLASS_HDR matches the type-parameter list with `(?:<[^>]*>)?`, which stops at the FIRST `>`
    -- so a bound that is itself generic, `class Base<T extends Connection$Base<T>> extends ...`,
    leaves a stray `>` and the header does not match at all. The class is then never opened: every
    field it declares is attributed to whichever class javap printed before it, and every access
    to those fields is attributed to the wrong owner or dropped. Stripping the groups first makes
    the match independent of how deeply nested the bounds are. (bytecode_oracle.py matches the
    same headers with the same expression and has the same blind spot; fixing it there moves the
    call-edge goldens, so it is left alone here.)"""
    out, d = [], 0
    for ch in s:
        if ch == '<':
            d += 1
        elif ch == '>':
            if d > 0:
                d -= 1
        elif d == 0:
            out.append(ch)
    return ''.join(out)

# `  9: putfield      #13   // Field org/example/Foo.bar:I`  — javap omits the owner when the
# field is declared in the class being printed, so the owner is optional and defaults to it.
FIELD_INSTR = re.compile(r'^\s*\d+:\s+(getfield|putfield|getstatic|putstatic)\s+#\d+'
                         r'(?:,\s*\d+)?\s*//\s*Field\s+([^\s]+)')
INDY = re.compile(r'^\s*\d+:\s+invokedynamic\s+#\d+(?:,\s*\d+)?\s*//\s*InvokeDynamic\s+#(\d+):')
BSM_HDR = re.compile(r'^\s*(\d+):\s+#\d+\s+REF_\w+\s+([\w$/.]+)\.([\w$<>]+):')
BSM_ARG = re.compile(r'^\s*#\d+\s+REF_\w+\s+([\w$/.]+)\.([\w$<>]+):(\S+)\s*$')
# A field DECLARATION line in javap -v: `  private final java.lang.String name;`. The type may be
# a generic with a WILDCARD or an intersection bound -- `Map<Class<?>, Factory<?>> knownMappers;`
# -- so `?`, `&` and `@` belong in the character class. Without `?` that declaration does not
# match, the field never enters field_decls, the declaring-class walk fails and every access to it
# is dropped: seven instructions on one mybatis class, and 215 rows over the project, each one
# then scored as the engine inventing an edge.
FIELD_DECL = re.compile(r'^[\w$.<>,?&@\[\]\s]+\s+([\w$]+);$')
# `  8: invokestatic  #3   // Method org/x/Outer$Inner.access$000:(Lorg/x/Outer$Inner;)I`
ACCESSOR_CALL = re.compile(r'^\s*\d+:\s+invoke\w+\s+#\d+(?:,\s*\d+)?\s*//\s*(?:Interface)?Method\s+([\w$/.]+)\.(access\$\d+):')

# javac's own generated members, by name. bytecode_oracle.py's list also holds `values` and
# `valueOf`, which are the ENUM ones -- but a Map implementation declares a real `values()` and a
# parser a real `valueOf(String)`, and excluding those as callers removed every field access
# written inside them: 137 rows on commons-collections alone, each scored as the engine inventing
# an edge. The enum pair is therefore excluded only when the declaring class IS an enum, below.
SYN_METHOD = re.compile(r'^(access\$\d+|\$values|\$deserializeLambda\$)$')
ENUM_SYN_METHOD = re.compile(r'^(values|valueOf)$')
COMPILER_FIELD = re.compile(r'^(this\$\d+|val\$.+|\$assertionsDisabled|\$VALUES|\$SwitchMap\$.*|\$SWITCH_TABLE\$.*|ENUM\$VALUES)$')


def javap(classes, names):
    # javap does not encode its output in Python's locale encoding -- it writes through the
    # JVM's stdout.encoding, which on a non-UTF-8 console is the console code page. Nothing
    # couples the two, so `text=True` with no `encoding=` decodes with whatever locale this
    # process happens to have, and disagreement crashes the reader thread (issue #962). Pin
    # both sides to UTF-8 rather than relying on them to coincide.
    return subprocess.run(['javap', '-J-Dstdout.encoding=UTF-8', '-p', '-v', '-cp', classes] + names,
                          capture_output=True, text=True, encoding='utf-8').stdout.splitlines()


def parse(out, names):
    """-> supers, field_decls, synth_fields, accesses, lambda_in

    accesses = [(callerClass, callerMethod, callerDesc, op, owner, fieldName)]
    """
    supers = collections.defaultdict(list)
    field_decls = collections.defaultdict(set)     # class -> {field name}
    synth_fields = collections.defaultdict(set)
    const_fields = collections.defaultdict(set)    # class -> {field inlined at every use}
    accessor_callers = collections.defaultdict(set)  # (cls, access$N) -> {(callerCls, callerMeth, desc)}
    accesses = []
    cls = meth = mdesc = None
    flags = ''
    pending_decl = None          # a method declaration awaiting its `descriptor:` line
    pending_field = None         # a field declaration awaiting its `flags:` line
    pending_field_flagged = None # ...and the same one after it, awaiting `ConstantValue:`
    in_code = False
    bsm = collections.defaultdict(dict)
    indy_sites = []
    lambda_in = {}
    in_bsm = None
    bsm_idx = None
    bsm_is_lambda = False
    for raw in out:
        line = raw.rstrip()
        s = line.strip()
        m = CLASS_HDR.match(strip_generics(s))
        if m and (m.group(2) in names or '.' in m.group(2)):
            cls = m.group(2).split('<')[0]
            meth = None
            for g in (m.group(3), m.group(4)):
                if not g:
                    continue
                for x in re.split(r',\s*(?![^<>]*>)', g):
                    x = re.sub(r'<.*', '', x).strip()
                    if x:
                        supers[cls].append(x)
            continue
        if s.startswith('BootstrapMethods:'):
            in_bsm = cls; bsm_idx = None; continue
        if in_bsm is not None:
            if s and not raw.startswith(' '):
                in_bsm = None
            else:
                mh = BSM_HDR.match(line)
                if mh:
                    bsm_idx = int(mh.group(1))
                    bsm_is_lambda = mh.group(2).replace('/', '.') == 'java.lang.invoke.LambdaMetafactory'
                    continue
                ma = BSM_ARG.match(line)
                if ma and bsm_idx is not None and bsm_is_lambda and bsm_idx not in bsm[in_bsm]:
                    bsm[in_bsm][bsm_idx] = (ma.group(1).replace('/', '.'), ma.group(2), ma.group(3))
                continue
        if s.startswith('descriptor: '):
            d = s.split('descriptor: ', 1)[1]
            if pending_decl is not None:
                mdesc = d
                nm = pending_decl.split('(')[0].strip().split()[-1] if '(' in pending_decl else pending_decl
                if cls and nm == cls:
                    nm = '<init>'
                if pending_decl.startswith('static {'):
                    nm = '<clinit>'
                meth = nm; flags = ''
                pending_decl = None
            continue
        if s.startswith('flags:'):
            if pending_field is not None:
                if 'ACC_SYNTHETIC' in s and cls:
                    synth_fields[cls].add(pending_field)
                pending_field_flagged = pending_field
                pending_field = None
            elif meth:
                flags = s
            continue
        # A field's `ConstantValue:` attribute means javac inlines every read of it, so no
        # getstatic names it anywhere. Printed directly under the field's flags line.
        if s.startswith('ConstantValue:') and cls and pending_field_flagged:
            const_fields[cls].add(pending_field_flagged)
            continue
        if s == 'Code:':
            in_code = True
        elif s.endswith(':') and not INSTR.match(s):
            in_code = False
        # a declaration line: a method has parentheses, a field does not
        if s and s.endswith(';') and not re.match(r'^\d+:', s) \
           and not s.startswith(('descriptor:', 'flags:', '//', '#')):
            # A STATIC INITIALIZER is printed `static {};` — no parentheses, and no
            # `descriptor:` line follows it either, so it is neither a method declaration nor a
            # field one by the tests below. Left unhandled, `meth` keeps naming whichever member
            # javap printed last and every write in <clinit> is attributed to it.
            if s.startswith('static {}'):
                meth, mdesc, flags = '<clinit>', '()V', ''
                pending_decl = pending_field = None
                continue
            if '(' in s:
                pending_decl = s
            else:
                fm = FIELD_DECL.match(s)
                if fm and cls:
                    field_decls[cls].add(fm.group(1))
                    pending_field = fm.group(1)
                    pending_field_flagged = None
            continue
        if not in_code or cls is None or meth is None:
            continue
        synthetic = ('ACC_BRIDGE' in flags or 'ACC_SYNTHETIC' in flags) and not meth.startswith('lambda$')
        di = INDY.match(line)
        if di and not synthetic:
            indy_sites.append((cls, meth, int(di.group(1))))
            continue
        ai = ACCESSOR_CALL.match(line)
        if ai and not synthetic:
            accessor_callers[(ai.group(1).replace('/', '.'), ai.group(2))].add((cls, meth, mdesc))
            continue
        fi = FIELD_INSTR.match(line)
        if not fi:
            continue
        if synthetic and not (meth or '').startswith('access$'):
            continue
        op, target = fi.group(1), fi.group(2)
        if ':' not in target:
            continue
        owner_name = target.rsplit(':', 1)[0]
        if '.' in owner_name:
            owner, name = owner_name.rsplit('.', 1)
        else:
            owner, name = cls, owner_name
        accesses.append((cls, meth, mdesc, op, owner.replace('/', '.'), name.strip('"')))
    for c, m, idx in indy_sites:
        t = bsm.get(c, {}).get(idx)
        if t and t[0] == c and t[1].startswith('lambda$'):
            lambda_in.setdefault((c, t[1]), m)
    return supers, field_decls, synth_fields, const_fields, accessor_callers, accesses, lambda_in


def collect(classes, names, batch=400):
    """javap over every class, accumulated. BATCHED because javap is handed one argument per
    class and a real project has tens of thousands of them, which exceeds ARG_MAX — but the
    ACCUMULATION is global, because the declaring-class walk and the anonymous-class naming both
    need the whole program's supertypes and field declarations, not one batch's."""
    supers = collections.defaultdict(list)
    field_decls = collections.defaultdict(set)
    synth_fields = collections.defaultdict(set)
    const_fields = collections.defaultdict(set)
    accessor_callers = collections.defaultdict(set)
    accesses = []
    lambda_in = {}
    for i in range(0, len(names), batch):
        out = javap(classes, names[i:i + batch])
        su, fd, sf, cf, ak, ac, li = parse(out, set(names))
        for k, v in su.items():
            supers[k].extend(x for x in v if x not in supers[k])
        for k, v in fd.items():
            field_decls[k] |= v
        for k, v in sf.items():
            synth_fields[k] |= v
        for k, v in cf.items():
            const_fields[k] |= v
        for k, v in ak.items():
            accessor_callers[k] |= v
        accesses.extend(ac)
        lambda_in.update(li)
    return supers, field_decls, synth_fields, const_fields, accessor_callers, accesses, lambda_in


def report(classes, names, app_only=False, with_initializers=False, inlined_out=None):
    supers, field_decls, synth_fields, const_fields, accessor_callers, accesses, lambda_in = collect(classes, names)
    app = set(names)
    is_enum = {c for c, ps in supers.items() if any(p == 'java.lang.Enum' for p in ps)}

    def ancestors(c, seen=None):
        seen = seen or set(); acc = []
        for p in supers.get(c, []):
            if p in seen:
                continue
            seen.add(p); acc.append(p); acc.extend(ancestors(p, seen))
        return acc

    def chain(c):
        pkg = c[:c.rindex('.')] if '.' in c else ''
        parts = [re.sub(r'^\d+(?=[A-Za-z_$])', '', p) for p in c.split('.')[-1].split('$')]
        dotted = '.'.join(parts)
        return f"{pkg}.{dotted}" if pkg else dotted

    anon = {}
    for c in sorted(app):
        if c.split('$')[-1].isdigit():
            ps = supers.get(c, [])
            sp = next((x for x in ps if x != 'java.lang.Object'), 'Object')
            if sp in is_enum:
                anon[c] = chain(sp)
            else:
                anon[c] = f"{chain(c.rsplit('$', 1)[0])}$anon:{sp.split('.')[-1].split('$')[-1]}"

    def cname(c):
        if c in anon:
            return anon[c]
        if c in app:
            return chain(c)
        return c

    # An ACCESS INSIDE A SYNTHETIC ACCESSOR belongs to whoever invoked the accessor. Same
    # convention as the lambda body: the compiler moved the code, the source did not.
    expanded = []
    for row in accesses:
        cls, meth, mdesc, op, owner, name = row
        if not meth.startswith('access$'):
            expanded.append(row)
            continue
        for (ccls, cmeth, cdesc) in accessor_callers.get((cls, meth), ()):
            expanded.append((ccls, cmeth, cdesc, op, owner, name))
    accesses = expanded

    inner = {c for c in field_decls if any(re.fullmatch(r'this\$\d+', f) for f in field_decls[c])}

    # A CONSTRUCTOR carries the parameters javac added: an enum's name and ordinal, an inner
    # class's enclosing instance.
    def ctor_params(c, ps):
        if c in is_enum and len(ps) >= 2 and ps[0] == 'String' and ps[1] == 'int':
            return ps[2:]
        if c in inner and len(ps) >= 1:
            return ps[1:]
        return ps

    seen = set()
    for cls, meth, mdesc, op, owner, name in accesses:
        if COMPILER_FIELD.match(name) or SYN_METHOD.match(meth):
            continue
        if cls in is_enum and ENUM_SYN_METHOD.match(meth):
            continue
        if not with_initializers and meth in ('<clinit>', '<init>'):
            continue
        caller_name = meth
        lam = meth.startswith('lambda$')
        if lam:
            c = lambda_in.get((cls, meth)); guard = 0
            while c is not None and c.startswith('lambda$') and guard < 8:
                c = lambda_in.get((cls, c)); guard += 1
            if c is None:
                m2 = re.match(r'^lambda\$(.+)\$\d+$', meth)
                c = m2.group(1) if m2 else meth[len('lambda$'):]
            caller_name = '<init>' if c == 'new' else c
            if not with_initializers and caller_name in ('<init>', '<clinit>'):
                continue
        if app_only and owner not in app:
            continue
        dc = owner
        if name not in field_decls.get(owner, ()):
            for a in ancestors(owner):
                if name in field_decls.get(a, ()):
                    dc = a
                    break
            else:
                if app_only:
                    continue
        if app_only and dc not in app:
            continue
        if name in synth_fields.get(dc, ()):
            continue
        if name in const_fields.get(dc, ()):
            continue                       # inlined at every use; see --inlined-out
        ps = desc_params(mdesc) if mdesc and '(' in mdesc else []
        if caller_name == '<init>':
            ps = ctor_params(cls, ps)
        cp = '*' if lam else ','.join(ps)
        direction = 'READ' if op.startswith('get') else 'WRITE'
        seen.add(f"{cname(cls)}#{caller_name}({cp}) {direction} {cname(dc)}#{name}")
    if inlined_out:
        with open(inlined_out, 'w') as fh:
            for c in sorted(const_fields):
                for f in sorted(const_fields[c]):
                    fh.write(f"{cname(c)}#{f}\n")
    return sorted(seen)


def main():
    argv = sys.argv[1:]
    app_only = '--app-only' in argv
    with_init = '--with-initializers' in argv
    inlined_out = argv[argv.index('--inlined-out') + 1] if '--inlined-out' in argv else None
    if '--classes' in argv:
        roots = argv[argv.index('--classes') + 1].split(',')
        # A MULTI-RELEASE tree puts a second copy of a class under META-INF/versions/<N>/, whose
        # binary name is the SAME as the base one. Derived from the root it would come out as
        # `META-INF.versions.11.org.jsoup.helper.HttpClientExecutor`, a name javap cannot find on
        # that classpath and which matches nothing javap prints — so the class is silently absent
        # from `app`, every access it makes is dropped by --app-only, and the engine is charged
        # with inventing the edges. Each versioned directory is therefore its own root.
        expanded = []
        for root in roots:
            expanded.append(root)
            v = os.path.join(root, 'META-INF', 'versions')
            if os.path.isdir(v):
                expanded.extend(os.path.join(v, d) for d in sorted(os.listdir(v))
                                if os.path.isdir(os.path.join(v, d)))
        names, classpath = [], os.pathsep.join(expanded)
        for root in expanded:
            for d, _, fs in os.walk(root):
                if os.sep + 'META-INF' + os.sep in d + os.sep:
                    continue
                for f in fs:
                    if f.endswith('.class'):
                        names.append(os.path.relpath(os.path.join(d, f), root)[:-6].replace(os.sep, '.'))
        for s in report(classpath, sorted(set(names)), app_only, with_init, inlined_out):
            print(s)
        return
    src, work = argv[0], argv[1]
    lib_src = argv[argv.index('--lib-src') + 1] if '--lib-src' in argv else None
    classes, names = compile_case(src, work, lib_src)
    for s in report(classes, names, app_only, with_init, inlined_out):
        print(s)


if __name__ == '__main__':
    main()
