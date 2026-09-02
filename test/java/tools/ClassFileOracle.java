// GROUND TRUTH FROM THE JDK ITSELF, at corpus scale — java.lang.classfile (JEP 484), no third-party
// analyzer and no javac. Reads the invoke instructions out of ALREADY-COMPILED artifacts (class
// trees and/or jars), so a project is scored against the bytecode its OWN build produced.
//
// Emits the same canonical edge form as test/java/tools/bytecode_oracle.py, so the two are directly
// comparable and the small-case suite can be used to prove this reader agrees with it:
//     Caller#name(p1,p2) -> Callee#name(p1,p2)
//
// Conventions (identical on both sides of every comparison — see normalize_edges.py):
//   * nested types flattened to `pkg.SimpleName`
//   * anonymous classes keyed by SUPERTYPE (`Outer$anon:Runnable`), never by javac's numbering
//   * an enum-constant body (an anonymous subclass of the enum) is folded back to the ENUM
//   * a local class's javac index is stripped (`Outer$1Local` -> `Local`)
//   * a lambda body (`lambda$m$N`) is folded into the method that lexically contains it, params `*`
//   * a callee is re-pointed to the class that DECLARES it (bytecode names the receiver's type)
//   * excluded because the source has no such call: bridge/synthetic methods, access$N, enum
//     values/valueOf/$values, <clinit>, invokedynamic plumbing, string-concat lowering, autoboxing,
//     the enhanced-for iterator triple, and javac-synthesized default constructors + their super()
//
// usage:
//   java ClassFileOracle.java --app <dir-or-jar>[,...] [--app-only] [--exclude-tests]
//                             [--include-prefix <pkg>[,...]] [--callers-only-app]
import java.lang.classfile.*;
import java.lang.classfile.instruction.InvokeInstruction;
import java.lang.classfile.instruction.InvokeDynamicInstruction;
import java.lang.classfile.constantpool.*;
import java.io.*;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;

public class ClassFileOracle {

    // ── class facts ─────────────────────────────────────────────────────────────
    record MethodKey(String name, List<String> params) {}

    static final Map<String, String>            SUPER   = new HashMap<>();   // internal -> internal
    static final Map<String, List<String>>      IFACES  = new HashMap<>();
    static final Map<String, Set<MethodKey>>    DECL    = new HashMap<>();
    static final Set<String>                    APP     = new LinkedHashSet<>();
    static final Set<String>                    ENUMS   = new HashSet<>();
    static final Set<String>                    DEFAULT_CTOR = new HashSet<>(); // classes whose <init>() is javac-synthesized
    static final Map<String, List<String>>      SUBS    = new HashMap<>();   // declaring type -> app subtypes

    static boolean appOnly = false, excludeTests = false, callersOnlyApp = true, noCtors = false;
    static boolean envelope = false, withLines = false, listClasses = false;
    static List<String> includePrefixes = new ArrayList<>();

    public static void main(String[] argv) throws Exception {
        List<Path> roots = new ArrayList<>();
        for (int i = 0; i < argv.length; i++) {
            switch (argv[i]) {
                case "--app" -> { for (String s : argv[++i].split(",")) roots.add(Path.of(s)); }
                case "--app-only" -> appOnly = true;
                case "--no-ctors" -> noCtors = true;
                case "--envelope" -> envelope = true;   // G_ub: add every app subtype declaring the same member
                case "--with-lines" -> withLines = true;
                case "--list-classes" -> listClasses = true;
                case "--exclude-tests" -> excludeTests = true;
                case "--callers-any" -> callersOnlyApp = false;
                case "--include-prefix" -> includePrefixes.addAll(Arrays.asList(argv[++i].split(",")));
                default -> throw new IllegalArgumentException("unknown arg " + argv[i]);
            }
        }
        if (roots.isEmpty()) { System.err.println("need --app"); System.exit(2); }

        List<byte[]> blobs = new ArrayList<>();
        for (Path r : roots) collect(r, blobs);
        System.err.println("# class files read: " + blobs.size());

        List<ClassModel> models = new ArrayList<>(blobs.size());
        for (byte[] b : blobs) {
            try { models.add(ClassFile.of().parse(b)); } catch (Throwable t) { /* not a class file */ }
        }
        for (ClassModel cm : models) index(cm);
        for (String c : APP) { for (String a : ancestors(c)) SUBS.computeIfAbsent(a, k -> new ArrayList<>()).add(c); }
        System.err.println("# app classes: " + APP.size());

        if (listClasses) {   // the app-class set, so a scorer can scope BOTH sides identically
            TreeSet<String> cs = new TreeSet<>();
            for (String c : APP) cs.add(cname(c));
            for (String c : cs) System.out.println(c);
            return;
        }
        TreeSet<String> out = new TreeSet<>();
        for (ClassModel cm : models) emit(cm, out);
        for (String s : out) System.out.println(s);
        System.err.println("# edges: " + out.size());
    }

    // ── reading ─────────────────────────────────────────────────────────────────
    static void collect(Path root, List<byte[]> into) throws IOException {
        if (Files.isRegularFile(root) && root.toString().endsWith(".jar")) {
            try (ZipFile z = new ZipFile(root.toFile())) {
                for (var e : Collections.list(z.entries())) {
                    if (!e.getName().endsWith(".class")) continue;
                    if (excludeTests && isTestPath(e.getName())) continue;
                    try (InputStream in = z.getInputStream(e)) { into.add(in.readAllBytes()); }
                }
            }
            return;
        }
        if (!Files.isDirectory(root)) return;
        try (var s = Files.walk(root)) {
            for (Path p : (Iterable<Path>) s.filter(Files::isRegularFile)
                                            .filter(p -> p.toString().endsWith(".class"))::iterator) {
                if (excludeTests && isTestPath(root.relativize(p).toString())) continue;
                into.add(Files.readAllBytes(p));
            }
        }
    }

    /** Directory- and name-based test exclusion, matching SCORING.md §10 (dir filter + scorer filter). */
    static boolean isTestPath(String rel) {
        String r = rel.replace('\\', '/');
        for (String seg : r.split("/")) {
            if (seg.equals("test") || seg.equals("tests") || seg.equals("testFixtures")
                || seg.equals("it") || seg.equals("e2e") || seg.equals("benchmarks")
                || seg.equals("examples") || seg.equals("fixtures")) return true;
        }
        String base = r.substring(r.lastIndexOf('/') + 1);
        String top = base.split("\\$")[0];
        return top.endsWith("Test.class") || top.endsWith("Tests.class") || top.endsWith("IT.class")
            || top.endsWith("TestCase.class") || top.startsWith("Test");
    }

    static void index(ClassModel cm) {
        String in = cm.thisClass().asInternalName();
        APP.add(in);
        cm.superclass().ifPresent(s -> SUPER.put(in, s.asInternalName()));
        List<String> ifs = new ArrayList<>();
        for (var i : cm.interfaces()) ifs.add(i.asInternalName());
        IFACES.put(in, ifs);
        if ("java/lang/Enum".equals(SUPER.get(in))) ENUMS.add(in);
        Set<MethodKey> d = DECL.computeIfAbsent(in, k -> new HashSet<>());
        for (MethodModel m : cm.methods()) {
            d.add(new MethodKey(m.methodName().stringValue(), params(m.methodType().stringValue())));
            if (m.methodName().equalsString("<init>") && isSynthesizedDefaultCtor(m)) DEFAULT_CTOR.add(in);
        }
    }

    /**
     * A javac-synthesized default constructor has no source twin, so neither it (as a caller) nor a
     * `new X()` naming it should be scored. Its body is EXACTLY `aload_0; invokespecial
     * super.<init>()V; return` — a structural test, so no source tree is needed.
     */
    static boolean isSynthesizedDefaultCtor(MethodModel m) {
        if (!m.methodType().stringValue().startsWith("()")) return false;
        var code = m.code();
        if (code.isEmpty()) return false;
        int[] n = {0}; boolean[] ok = {true};
        for (CodeElement e : code.get()) {
            if (!(e instanceof Instruction)) continue;   // labels, line numbers, frames
            n[0]++;
            if (n[0] > 3) { ok[0] = false; break; }
        }
        return ok[0] && n[0] == 3;
    }

    // ── descriptors ─────────────────────────────────────────────────────────────
    static final Map<Character, String> PRIM = Map.of('B',"byte",'C',"char",'D',"double",'F',"float",
                                                      'I',"int",'J',"long",'S',"short",'Z',"boolean");
    static List<String> params(String desc) {
        List<String> out = new ArrayList<>();
        int i = desc.indexOf('(') + 1, end = desc.lastIndexOf(')');
        while (i < end) {
            int arr = 0;
            while (desc.charAt(i) == '[') { arr++; i++; }
            String t;
            if (desc.charAt(i) == 'L') { int j = desc.indexOf(';', i); t = desc.substring(i + 1, j).replace('/', '.'); i = j + 1; }
            else { t = PRIM.get(desc.charAt(i)); i++; }
            out.add(simpleOf(t) + "[]".repeat(arr));
        }
        return out;
    }
    static String simpleOf(String qn) {
        String s = qn.substring(qn.lastIndexOf('.') + 1);
        return s.substring(s.lastIndexOf('$') + 1);
    }

    // ── name normalisation ──────────────────────────────────────────────────────
    static final Map<String, String> NAME_CACHE = new HashMap<>();
    static String cname(String internal) {
        String c = NAME_CACHE.get(internal);
        if (c != null) return c;
        String qn = internal.replace('/', '.');
        String pkg = qn.contains(".") ? qn.substring(0, qn.lastIndexOf('.')) : "";
        String tail = qn.substring(qn.lastIndexOf('.') + 1);          // Outer$Inner / Outer$1
        String simple = tail.substring(tail.lastIndexOf('$') + 1);
        String res;
        if (simple.chars().allMatch(Character::isDigit) && APP.contains(internal)) {
            String sup = supertypeOf(internal);
            if (ENUMS.contains(sup)) {
                res = (pkg.isEmpty() ? "" : pkg + ".") + simpleOf(sup.replace('/', '.'));   // enum-constant body
            } else {
                String outer = tail.split("\\$")[0];
                res = (pkg.isEmpty() ? "" : pkg + ".") + outer + "$anon:" + simpleOf(sup.replace('/', '.'));
            }
        } else {
            // a LOCAL class carries javac's index: Outer$1Local -> Local
            String s = simple.replaceFirst("^\\d+(?=[A-Za-z_$])", "");
            res = pkg.isEmpty() ? s : pkg + "." + s;
        }
        NAME_CACHE.put(internal, res);
        return res;
    }
    static String supertypeOf(String internal) {
        String s = SUPER.get(internal);
        if (s != null && !s.equals("java/lang/Object")) return s;
        List<String> ifs = IFACES.getOrDefault(internal, List.of());
        return ifs.isEmpty() ? (s == null ? "java/lang/Object" : s) : ifs.get(0);
    }

    static List<String> ancestors(String internal) {
        List<String> out = new ArrayList<>(); Set<String> seen = new HashSet<>();
        Deque<String> q = new ArrayDeque<>(); q.add(internal);
        while (!q.isEmpty()) {
            String c = q.poll();
            String s = SUPER.get(c);
            if (s != null && seen.add(s)) { out.add(s); q.add(s); }
            for (String i : IFACES.getOrDefault(c, List.of())) if (seen.add(i)) { out.add(i); q.add(i); }
        }
        return out;
    }

    // ── exclusions ──────────────────────────────────────────────────────────────
    static final Set<String> SYN = Set.of("$values", "values", "valueOf", "$deserializeLambda$");
    static final Set<String> BOX = Set.of("java/lang/Integer","java/lang/Long","java/lang/Short",
        "java/lang/Byte","java/lang/Character","java/lang/Boolean","java/lang/Double","java/lang/Float");
    static final Set<String> PRIMS = new HashSet<>(PRIM.values());

    static boolean excludedName(String n) { return SYN.contains(n) || n.startsWith("access$"); }

    /**
     * The target a method reference lowers to: bootstrap arg 1 of a LambdaMetafactory indy is the
     * implementation MethodHandle. Returns {ownerInternal, name, descriptor}, or null when the site
     * is not a method reference we should score — string concatenation, a non-Lambda bootstrap, or a
     * LAMBDA BODY (`lambda$m$N`), which is folded into its enclosing method on both sides.
     */
    static String[] lambdaTarget(InvokeDynamicInstruction idi) {
        try {
            var bsm = idi.invokedynamic().bootstrap();
            String bo = bsm.bootstrapMethod().reference().owner().asInternalName();
            if (!bo.equals("java/lang/invoke/LambdaMetafactory")) return null;   // excludes StringConcatFactory
            var args = bsm.arguments();
            if (args.size() < 2 || !(args.get(1) instanceof MethodHandleEntry mh)) return null;
            var ref = mh.reference();
            String owner = ref.owner().asInternalName();
            String name  = ref.name().stringValue();
            if (name.startsWith("lambda$") || name.equals("<init>")) return null;
            return new String[]{owner, name, ref.type().stringValue()};
        } catch (Throwable t) { return null; }
    }

    static void emit(ClassModel cm, Set<String> out) {
        String cls = cm.thisClass().asInternalName();
        if (!includePrefixes.isEmpty() && includePrefixes.stream().noneMatch(p -> cls.replace('/', '.').startsWith(p))) return;
        for (MethodModel m : cm.methods()) {
            int f = m.flags().flagsMask();
            String mname = m.methodName().stringValue();
            // A LAMBDA BODY is ACC_SYNTHETIC, so a blanket synthetic skip drops every call written
            // inside a lambda — and the "fold the body into its enclosing method" step below then
            // never runs. Exempt it explicitly: the calls in it are calls the source really makes.
            boolean lambdaBody = mname.startsWith("lambda$");
            if (!lambdaBody && ((f & 0x0040) != 0 || (f & 0x1000) != 0)) continue;   // ACC_BRIDGE | ACC_SYNTHETIC
            if (mname.equals("<clinit>") || excludedName(mname)) continue;
            if (mname.equals("<init>") && DEFAULT_CTOR.contains(cls) && m.methodType().stringValue().startsWith("()")) continue;
            var code = m.code(); if (code.isEmpty()) continue;

            String callerName = mname; String callerParams = String.join(",", params(m.methodType().stringValue()));
            if (lambdaBody) {
                String base = mname.substring("lambda$".length());
                int k = base.lastIndexOf('$');
                callerName = k > 0 ? base.substring(0, k) : base;
                callerParams = "*";
            }
            int line = -1;
            for (CodeElement e : code.get()) {
                if (e instanceof java.lang.classfile.instruction.LineNumber ln) { line = ln.line(); continue; }
                String owner, name, desc; Opcode op;
                if (e instanceof InvokeDynamicInstruction idi) {
                    // A METHOD REFERENCE compiles to invokedynamic + LambdaMetafactory, so the target
                    // appears in NO invoke instruction — it is the implementation MethodHandle in the
                    // bootstrap arguments. An oracle that skips invokedynamic therefore cannot see a
                    // single method-reference edge, and scores every one the engine resolves as a
                    // false positive. Read the bootstrap argument instead.
                    String[] t = lambdaTarget(idi);
                    if (t == null) continue;
                    owner = t[0]; name = t[1]; desc = t[2]; op = Opcode.INVOKESTATIC;
                } else if (e instanceof InvokeInstruction ii) {
                    owner = ii.owner().asInternalName();
                    name  = ii.name().stringValue();
                    desc  = ii.type().stringValue();
                    op    = ii.opcode();
                } else continue;
                List<String> ps = params(desc);

                if (excludedName(name)) continue;
                if (noCtors && name.equals("<init>")) continue;
                if (owner.startsWith("java/lang/invoke")) continue;
                if (name.equals("makeConcatWithConstants") || owner.equals("java/lang/StringBuilder")) continue;
                if (owner.equals("java/lang/String") && name.equals("valueOf") && ps.equals(List.of("Object"))) continue;
                if (BOX.contains(owner) && name.equals("valueOf") && ps.size() == 1 && PRIMS.contains(ps.get(0))) continue;
                if (owner.equals("java/util/Iterator") && (name.equals("hasNext") || name.equals("next"))) continue;
                if (name.equals("iterator") && owner.startsWith("java/util")) continue;
                // implicit super() out of a synthesized ctor, and `new X()` on a class with only one
                if (name.equals("<init>") && ps.isEmpty() && DEFAULT_CTOR.contains(owner)) continue;

                // re-point to the class that DECLARES the method
                String dc = owner;
                if (!name.equals("<init>")) {
                    MethodKey key = new MethodKey(name, ps);
                    if (!DECL.getOrDefault(owner, Set.of()).contains(key)) {
                        boolean found = false;
                        for (String a : ancestors(owner)) {
                            if (DECL.getOrDefault(a, Set.of()).contains(key)) { dc = a; found = true; break; }
                        }
                        if (!found && appOnly) continue;   // inherited from a library class -> client->lib
                    }
                }
                if (appOnly && !APP.contains(dc)) continue;
                String from = cname(cls) + "#" + callerName + "(" + callerParams + ")"
                            + (withLines ? "@" + line : "");
                String sig = "#" + name + "(" + String.join(",", ps) + ")";
                out.add(from + " -> " + cname(dc) + sig);
                // G_ub — a virtual/interface call may land on any app subtype declaring the member
                if (envelope && (op == Opcode.INVOKEVIRTUAL || op == Opcode.INVOKEINTERFACE)) {
                    MethodKey key = new MethodKey(name, ps);
                    for (String sub : SUBS.getOrDefault(dc, List.of())) {
                        if (DECL.getOrDefault(sub, Set.of()).contains(key)) out.add(from + " -> " + cname(sub) + sig);
                    }
                }
            }
        }
    }
}
