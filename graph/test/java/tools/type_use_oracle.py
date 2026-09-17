#!/usr/bin/env python3
"""GROUND TRUTH FOR TYPE USE, FROM THE JDK ITSELF — no third-party analyzer.

The third sibling of tools/bytecode_oracle.py (invoke instructions) and tools/field_oracle.py
(field instructions). A class file records which types its own declarations name, in five places
javap prints verbatim, and each maps onto a context the `type_use` relation carries:

    class header          extends / implements        SUPER_TYPE, IMPLEMENTS_INTERFACE
    field descriptor      + generic Signature         FIELD_TYPE
    method descriptor     + generic Signature         METHOD_PARAM, METHOD_RETURN
    Exceptions attribute                              THROWS_CLAUSE
    LocalVariableTable    + LocalVariableTypeTable     LOCAL_VARIABLE
    Exception table       the caught type                LOCAL_VARIABLE (a catch parameter)
    new / checkcast / instanceof instructions          OBJECT_CREATION_TYPE, CAST_EXPRESSION,
                                                       INSTANCEOF_TYPE, ARRAY_CREATION_TYPE

Emitted form, one line per (declaring class, context, type):

    pkg.Owner CONTEXT pkg.Type

THE GRANULARITY IS THE DECLARING CLASS, deliberately. A class file says that `Owner` names
`Type` as a METHOD_PARAM somewhere; it does not say which of two same-typed parameters of which
overload, and inventing that from a descriptor would be a reconstruction rather than a reading.
`type_use` is finer than this and is scored against it at this granularity, which means the
score answers "does the engine find the (owner, context, type) triples the compiler recorded"
and not "does it attribute each one to the right parameter".

TYPE ARGUMENTS ARE INCLUDED. A descriptor is erased, but javac writes the source-level type in a
`Signature` attribute next to it whenever generics are involved, and javap prints it; both are
read, so `Map<String, Marker>` yields Map, String and Marker. This matters because "what uses
Marker" must include a field typed `Map<String, Marker>`.

WHAT BYTECODE CANNOT SEE, and is therefore excluded from BOTH sides by the scorer rather than
charged to either:
  * a LOCAL_VARIABLE in a class compiled WITHOUT -g: there is no LocalVariableTable, so the
    class file records no local's type at all and every one the engine finds would be scored as
    invented. `--debug-info-out <path>` lists the classes that DO carry one, so the scorer can
    drop LOCAL_VARIABLE for the rest rather than charge it. Whole projects are built this way:
    joda-time is, and without this its precision reads 0.861 instead of the 0.995 it is.
  * an ANNOTATION whose retention is SOURCE: it is not in the class file at all.
  * a type named only in a position javac erases entirely (an unused import, a cast that the
    compiler proved redundant, a type variable's bound in a method body).
  * a type NEITHER side can resolve: a third-party class no staged IR declares. The engine
    records it as a declared unknown; the class file records the name. Scoring that would
    measure the staging.

usage: type_use_oracle.py --classes <dir>[,...] [--app-only] [--debug-info-out F]
       type_use_oracle.py <src-dir> <work-dir> [--app-only] [--lib-src <dir>]
"""
import os, re, subprocess, sys, collections

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from bytecode_oracle import compile_case, CLASS_HDR, INSTR  # noqa: E402
from field_oracle import javap, strip_generics  # noqa: E402

PRIM_DESC = set('BCDFIJSZV')
# `  12: new   #7   // class org/x/Marker`   /  checkcast  /  instanceof  /  anewarray
TYPE_INSTR = re.compile(r'^\s*\d+:\s+(new|checkcast|instanceof|anewarray|multianewarray)\s+#\d+'
                        r'(?:,\s*\d+)?\s*//\s*class\s+"?([\w$/.\[;]+)"?')
INSTR_CONTEXT = {'new': 'OBJECT_CREATION_TYPE', 'checkcast': 'CAST_EXPRESSION',
                 'instanceof': 'INSTANCEOF_TYPE', 'anewarray': 'ARRAY_CREATION_TYPE',
                 'multianewarray': 'ARRAY_CREATION_TYPE'}
FIELD_DECL = re.compile(r'^[\w$.<>,?&@\[\]\s]+\s+([\w$]+);$')
# `      0     4     7   Class probe/MarkerException` — a row of the exception table. The caught
# type is the only place an EMPTY catch block records its parameter's type: javac gives such a
# parameter no live range, so there is no LocalVariableTable entry for it at all. A finally or a
# synchronized block writes `any` here and names no type.
EXC_ROW = re.compile(r'^\s*\d+\s+\d+\s+\d+\s+Class\s+([\w$/.]+)\s*$')
# `      stack=2, locals=3, args_size=2` — the parameter slots are 0..args_size-1, and they are in
# the LocalVariableTable too. Counting them as LOCAL_VARIABLE puts every parameter in the wrong
# context and takes it out of METHOD_PARAM, which costs precision AND recall on both.
ARGS_SIZE = re.compile(r'args_size=(\d+)')
# javac generates these: the outer-instance link of an inner class, a captured local, and an
# enum's $VALUES array. None is written in the source.
SYNTH_NAME = re.compile(r'^(this\$\d+|val\$.+|\$VALUES|\$assertionsDisabled|\$SwitchMap\$.*)$')


def types_in_descriptor(desc):
    """Every class named in a descriptor or a generic signature, in order, as binary names."""
    out, i = [], 0
    while i < len(desc):
        c = desc[i]
        if c == 'L':
            j = i + 1
            depth = 0
            while j < len(desc):
                if desc[j] == '<':
                    depth += 1
                elif desc[j] == '>':
                    depth -= 1
                elif desc[j] == ';' and depth == 0:
                    break
                j += 1
            name = desc[i + 1:j]
            # A generic signature nests its arguments inside <...>; take the head and recurse.
            # The closing '>' has to be found by DEPTH: `Map<String, List<Foo>>` ends with two of
            # them, and rfind picks the outer one only by luck -- on a nested argument it picks a
            # position inside the inner list and the slice is malformed, which recursed until a
            # descriptor with no ';' in it raised.
            lt = name.find('<')
            if lt >= 0:
                out.append(name[:lt].replace('/', '.'))
                depth, k = 0, lt
                while k < len(name):
                    if name[k] == '<':
                        depth += 1
                    elif name[k] == '>':
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                out.extend(types_in_descriptor(name[lt + 1:k]))
                tail = name[k + 1:]
                if tail.startswith('.'):
                    out.append(tail[1:].split('<')[0].replace('/', '.'))  # an inner class
                    lt2 = tail.find('<')
                    if lt2 >= 0:
                        out.extend(types_in_descriptor(tail[lt2 + 1:tail.rfind('>')]))
            else:
                out.append(name.replace('/', '.'))
            i = j + 1
        elif c == 'T':                       # a type VARIABLE, not a type
            k = desc.find(';', i)
            if k < 0:
                break
            i = k + 1
        else:
            i += 1
    return out


def formal_params(desc):
    """Split a generic signature's FORMAL TYPE PARAMETER list off the front.

    `<T:Lprobe/Marker;>(TT;)TT;` declares T with bound Marker and then has the descriptor. The
    declaration form is `Name:Bound` and the USE form is `TT;`, and both start with a T, so the
    type-variable skip in types_in_descriptor eats the bound if the prefix is not taken off
    first. -> (bound types, the rest of the signature).
    """
    if not desc.startswith('<'):
        return [], desc
    depth, i = 0, 0
    while i < len(desc):
        if desc[i] == '<':
            depth += 1
        elif desc[i] == '>':
            depth -= 1
            if depth == 0:
                break
        i += 1
    inner, rest = desc[1:i], desc[i + 1:]
    # each parameter is `Name:Bound` (possibly `Name::IfaceBound`), the bounds are descriptors
    return types_in_descriptor(re.sub(r'(^|;|>)\s*[\w$]+(?=:)', r'\1', inner)), rest


def split_descriptor(desc):
    """(param types, return types) for a method descriptor or generic signature."""
    if '(' not in desc:
        return [], types_in_descriptor(desc)
    # the parameter list ends at the ')' that closes the '(' at depth 0 of any <...>
    i, depth = desc.index('('), 0
    j = i + 1
    while j < len(desc):
        if desc[j] == '<':
            depth += 1
        elif desc[j] == '>':
            depth -= 1
        elif desc[j] == ')' and depth == 0:
            break
        j += 1
    return types_in_descriptor(desc[i + 1:j]), types_in_descriptor(desc[j + 1:])


def parse(out, names):
    """-> ([(declaringClass, context, binaryTypeName)], {class with debug info})"""
    triples = []
    with_debug = set()
    supers = collections.defaultdict(list)
    inner_of = {}            # inner class -> enclosing type, read off its synthetic this$N field
    cls = None
    pending = None        # ('field'|'method', name) awaiting its descriptor / signature
    kind = None
    in_code = False
    in_lvt = False
    args_size = 0
    member = None            # the field or method name last declared, for the synthetic filter
    for raw in out:
        line = raw.rstrip()
        s = line.strip()
        m = CLASS_HDR.match(strip_generics(s))
        if m and (m.group(2) in names or '.' in m.group(2)):
            cls = m.group(2).split('<')[0]
            pending = kind = None
            supers[cls] = []
            # The clauses are read off the ORIGINAL line, not the stripped one: `implements
            # Iterable<JsonElement>` loses JsonElement when the generics are removed, and a type
            # argument in a supertype clause is a use of that type. But the class's own TYPE
            # PARAMETER list has to come off first, because `class Box<T extends Marker> extends
            # Object` contains an `extends` that is a BOUND, not a supertype, and a non-greedy
            # search finds that one.
            after = s[s.index(cls) + len(cls):] if cls in s else s
            if after.startswith('<'):
                depth, k = 0, 0
                while k < len(after):
                    if after[k] == '<':
                        depth += 1
                    elif after[k] == '>':
                        depth -= 1
                        if depth == 0:
                            break
                    k += 1
                after = after[k + 1:]
            ext = re.search(r'\sextends\s+(.*?)(?:\simplements\s|$)', after)
            impl = re.search(r'\simplements\s+(.*)$', after)
            for g, ctx in ((ext.group(1) if ext else None, 'SUPER_TYPE'),
                           (impl.group(1) if impl else None, 'IMPLEMENTS_INTERFACE')):
                if not g:
                    continue
                for t in re.findall(r'[\w$.]+', g):
                    if '.' in t or t[:1].isupper():
                        triples.append((cls, ctx, t))
                        supers[cls].append(t)
            continue
        if cls is None:
            continue
        # javap closes the member block with a bare `}` and prints the CLASS's own attributes
        # after it, so the Signature carrying the type parameters' bounds arrives while `kind`
        # still names the last member. Clearing it here is what tells the two apart.
        if s == '}':
            kind = None
            continue
        if s.startswith('descriptor: ') and kind:
            if member and SYNTH_NAME.match(member):
                kind = None                    # a compiler-generated member declares nothing
                continue
            d = s.split('descriptor: ', 1)[1]
            if kind == 'field':
                for t in types_in_descriptor(d):
                    triples.append((cls, 'FIELD_TYPE', t))
            else:
                ps, rs = split_descriptor(d)
                for t in ps:
                    triples.append((cls, 'METHOD_PARAM', t))
                for t in rs:
                    triples.append((cls, 'METHOD_RETURN', t))
            continue
        # A CLASS-level Signature carries the type parameters' bounds — `<T extends Marker>` on the
        # class. It is printed before any member declaration, so `kind` is still unset.
        if s.startswith('Signature: ') and not kind:
            d = s.split('//', 1)[1].strip() if '//' in s else s.split('Signature: ', 1)[1]
            bounds, rest = formal_params(d)
            for t in bounds:
                triples.append((cls, 'TYPE_PARAM_BOUND', t))
            for t in types_in_descriptor(rest):
                triples.append((cls, 'SUPER_TYPE', t))
            continue
        if s.startswith('Signature: ') and kind:
            d = s.split('//', 1)[1].strip() if '//' in s else s.split('Signature: ', 1)[1]
            if kind == 'field':
                for t in types_in_descriptor(d):
                    triples.append((cls, 'FIELD_TYPE', t))
            else:
                bounds, rest = formal_params(d)
                for t in bounds:
                    triples.append((cls, 'METHOD_TYPE_PARAM_BOUND', t))
                ps, rs = split_descriptor(rest)
                if member == '<init>' and inner_of.get(cls) and ps[:1] == [inner_of[cls]]:
                    ps = ps[1:]                # the enclosing instance javac prepends
                for t in ps:
                    triples.append((cls, 'METHOD_PARAM', t))
                for t in rs:
                    triples.append((cls, 'METHOD_RETURN', t))
            continue
        if s.startswith('Exceptions:') and kind == 'method':
            kind = 'throws'
            continue
        if kind == 'throws' and s.startswith('throws '):
            for t in s[len('throws '):].split(','):
                triples.append((cls, 'THROWS_CLAUSE', t.strip()))
            kind = 'method'
            continue
        if s in ('LocalVariableTable:', 'LocalVariableTypeTable:'):
            in_lvt = True
            with_debug.add(cls)
            continue
        em = EXC_ROW.match(line)
        if em:
            triples.append((cls, 'LOCAL_VARIABLE', em.group(1).replace('/', '.')))
            continue
        if in_lvt:
            f = s.split()
            if f[:1] == ['Start']:
                continue                      # the table's own header row
            if len(f) == 5 and f[0].isdigit():
                if f[3] == 'this' or int(f[2]) < args_size:
                    continue              # the receiver and the parameters, which are not locals
                for t in types_in_descriptor(f[4]):
                    triples.append((cls, 'LOCAL_VARIABLE', t))
                continue
            in_lvt = False
        a = ARGS_SIZE.search(s)
        if a:
            args_size = int(a.group(1))
        if s == 'Code:':
            in_code = True
        elif s.endswith(':') and not INSTR.match(s):
            in_code = False
        if s and s.endswith(';') and not re.match(r'^\d+:', s) \
           and not s.startswith(('descriptor:', 'flags:', '//', '#', 'throws')):
            if s.startswith('static {}'):
                kind, member = 'method', '<clinit>'
            elif '(' in s:
                kind = 'method'
                member = s.split('(')[0].strip().split()[-1]
            else:
                fm = FIELD_DECL.match(s)
                if fm:
                    kind, member = 'field', fm.group(1)
                    if re.fullmatch(r'this\$\d+', fm.group(1)):
                        inner_of[cls] = s[:s.rindex(' ')].split()[-1]
            continue
        if not in_code:
            continue
        ti = TYPE_INSTR.match(line)
        if ti:
            name = ti.group(2)
            ctx = INSTR_CONTEXT[ti.group(1)]
            for t in (types_in_descriptor(name) if name.startswith(('L', '[')) else [name.replace('/', '.')]):
                triples.append((cls, ctx, t.lstrip('[')))
    return triples, with_debug, supers, inner_of


def report(classes, names, app_only=False, batch=400, debug_out=None):
    triples = []
    with_debug = set()
    supers = collections.defaultdict(list)
    inner_of = {}            # inner class -> enclosing type, read off its synthetic this$N field
    for i in range(0, len(names), batch):
        t, d, su, _io = parse(javap(classes, names[i:i + batch]), set(names))
        triples.extend(t)
        with_debug |= d
        for k, v in su.items():
            supers.setdefault(k, []).extend(x for x in v if x not in supers.get(k, []))
    app = set(names)

    def chain(c):
        pkg = c[:c.rindex('.')] if '.' in c else ''
        parts = [re.sub(r'^\d+(?=[A-Za-z_$])', '', p) for p in c.split('.')[-1].split('$')]
        dotted = '.'.join(parts)
        return f"{pkg}.{dotted}" if pkg else dotted

    # The same naming conventions the other two readers use: an anonymous class is keyed by its
    # SUPERTYPE, and an ENUM CONSTANT BODY -- which javac compiles to an anonymous subclass of the
    # enum -- folds back to the ENUM, because the IR attributes its members to the enum itself and
    # there is no separate source type. Without the fold, every `new X()` written inside an enum
    # constant's body is a class the engine never names: 40 rows on gson, all scored as invented.
    is_enum = {c for c, ps in supers.items() if any(p == 'java.lang.Enum' for p in ps)}
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
        return anon.get(c) or (chain(c) if c in app else c)

    if debug_out:
        with open(debug_out, 'w') as fh:
            for c in sorted(with_debug):
                fh.write(cname(c) + '\n')
    # `new Iface() { ... }` writes the SUPERTYPE in the source and the generated class in the
    # bytecode, so an OBJECT_CREATION_TYPE naming an anonymous class is re-pointed to what the
    # author wrote. And an anonymous class's own supertype clause is a SUPER_TYPE on the parser's
    # side whether the supertype is a class or an interface, because `new Iface(){}` has no
    # implements clause to record; the two contexts are folded for those classes only.
    anon_super = {}
    for c in anon:
        ps = supers.get(c, [])
        sp = next((x for x in ps if x != 'java.lang.Object'), None)
        if sp:
            anon_super[c] = sp

    seen = set()
    for c, ctx, t in triples:
        if not t or t in ('java.lang.Object',):
            continue
        if ctx == 'OBJECT_CREATION_TYPE' and t in anon_super:
            t = anon_super[t]
        if ctx == 'IMPLEMENTS_INTERFACE' and c in anon:
            ctx = 'SUPER_TYPE'
        if t[:1] in PRIM_DESC and len(t) == 1:
            continue
        if app_only and t not in app:
            continue
        if c not in app:
            continue
        seen.add(f"{cname(c)} {ctx} {cname(t)}")
    return sorted(seen)


def main():
    argv = sys.argv[1:]
    app_only = '--app-only' in argv
    debug_out = argv[argv.index('--debug-info-out') + 1] if '--debug-info-out' in argv else None
    if '--classes' in argv:
        roots = argv[argv.index('--classes') + 1].split(',')
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
        for s in report(classpath, sorted(set(names)), app_only, debug_out=debug_out):
            print(s)
        return
    src, work = argv[0], argv[1]
    lib_src = argv[argv.index('--lib-src') + 1] if '--lib-src' in argv else None
    classes, names = compile_case(src, work, lib_src)
    for s in report(classes, names, app_only, debug_out=debug_out):
        print(s)


if __name__ == '__main__':
    main()
