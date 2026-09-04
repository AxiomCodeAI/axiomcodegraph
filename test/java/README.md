# Java engine regression suite

Each case is a small, self-contained Java project with a known answer. The suite exists so that a
breaking change to the rules cannot land silently.

```bash
./run-tests.sh                 # every case: golden-diff + coverage guard
./run-tests.sh --oracle        # ALSO validate against ground truth built with javac + javap
./run-tests.sh 04 11           # only cases matching those substrings
./run-tests.sh --bless         # regenerate goldens from the current engine (REVIEW the diff)
./run-tests.sh --keep          # keep .work/<case>/ for debugging

# environment (defaults assume a sibling checkout layout)
AXIOM_PARSER=/path/to/parser/dist/index.js
```

## No external IR — client → client only

This suite stages **no library IR at all**: not the JDK, not anything else. Two reasons.

A library IR is ~2 GB, so it cannot live in the repo — any test that needed one would be
unrunnable for anybody who clones the project. And what these cases pin down is the engine's
resolution of the *client's own* code: overload selection, dispatch, shadowing, nesting, config
and DI wiring. A client→library boundary edge mostly exercises the library IR, not the rules.

A call into a library therefore resolves to nothing and is recorded as `ambiguous_unknown` —
the honest answer for a client-only analysis — and the coverage guard still proves the site was
not silently dropped. `19-receiver-forms` used to chain through `java.util.List`; it now chains
through a client generic (`Box<Node>`), which pins the same rule (a chained call is typed by the
return type of the call it is chained onto, with the type argument substituted) without the
dependency.

The whole suite, including the bytecode oracle, runs in **~40 s** (it was ~20 min). Two bugs in
`src/pipeline/run-souffle.sh` accounted for that:

* **A C++ recompile per case (~70 s each).** The compiled-engine cache is keyed on the generated
  program text, which embeds one `.input` line per *staged* relation — so a project with no XML
  staged no `java_xml_element`, its program differed, and it missed the cache. 132 near-identical
  binaries (666 MB) had accumulated. Every mapped relation is now staged, empty when the project
  has no such file, so the program text is identical for every project and the engine compiles once.
* **Re-staging library signatures per case.** Concatenating a library IR into facts depends only
  on the library roots, never on the client, so it is now cached under
  `.souffle-cache/libfacts-<key>` and symlinked in. (Unused by this suite, which stages no
  library — it matters when the engine runs against a real project.)


## Five independent checks per case

1. **Coverage guard** (`tools/coverage_guard.py`) — every invocation-shaped expression in the IR must
   appear in `call-chain-edges.csv`, resolved *or* explicitly flagged ambiguous. A call site that
   appears nowhere was dropped silently. This is the one failure mode a golden diff cannot see: you
   cannot notice the absence of something you never recorded. **Fails the case.**
2. **Golden diff** — the normalized edge list (`status · kind · caller -> callee`, sorted) is compared
   against `expected/<case>.edges`. Any change in resolution power shows up as a reviewable diff
   instead of a silent shift. **Fails the case.**
3. **Config golden** (`tools/config_report.py`) — the edge golden says nothing about beans, DI
   edges, config bindings, config entry points or config-side declared unknowns, so those get
   their own golden (`expected/<case>.config`). A case that derives config rows with no golden
   fails; a golden whose rows disappear fails too. Neither gaining nor losing interpretation
   power can land silently. **Fails the case.**
4. **Live Spring context** (`--oracle`, `tools/spring_oracle.sh` + `spring_oracle_diff.py`) — for a
   case carrying a `spring-oracle.conf`, the same sources are compiled against the real Spring
   jars and booted in an `AnnotationConfigApplicationContext`. Spring is then asked for
   `getBeanDefinitionNames()` and for the object actually sitting in each `@Autowired` field, and
   the engine's `bean_def` / `di_edge` / `config_binding` are scored against that answer —
   precision and recall **per mechanism**, because an aggregate hides which one is broken. The
   report is itself a golden. Needs the Spring jars in the local Maven cache; absent, the check
   **skips** (like a missing parser), it does not fail. **Fails the case on a score change.**
5. **Bytecode oracle** (`--oracle`, `tools/bytecode_oracle.py`) — ground truth compiled and read with
   **`javac` + `javap` only**, no third-party analyzer: the invoke instructions *are* the answer.
   Every bytecode-declared client→client edge must be present. **A missing edge fails the case.**
   Extras do not fail — where dispatch is ambiguous the engine emits the sound set of possible
   targets, so it is expected to be a superset — but the whole oracle diff is itself pinned as
   `expected/<case>.oracle`, so an extra that *appears* or *grows* fails the case as a changed
   golden. "Extras are expected" must never become a place for imprecision to hide.

### The two ground-truth readers must agree — checked as a preflight

There are two oracles over the same bytecode: `tools/bytecode_oracle.py` (javac + `javap -p -v`,
used by this suite) and `tools/ClassFileOracle.java` (`java.lang.classfile`, used at corpus scale,
where the project is read from the artefacts its own build produced and there is no source tree).
Both claim to emit the same canonical form. `tools/oracle_agreement.py` runs under `--oracle`,
before any case, and checks it: every row present in one and absent from the other is reported, and
— independently of agreement, because both sides can be wrong the same way — every row either
reader emits must NAME a method. A disagreement about whether a **constructor row exists at all**
is counted rather than failed (the two decide "is this constructor javac-synthesized" differently,
and the question is undecidable from a class file); those counts are the golden
`expected/oracle-agreement.txt`, so the debt cannot grow, or silently vanish, unreviewed.

### What the three failure classes mean

* **`missing`** — a defect. Bytecode's declared targets are facts.
* **`extra`, inside the sound envelope** — over-approximation. Three sources, all legitimate:
  class-hierarchy dispatch on an interface- or abstract-typed receiver (cases 08, 09, 11), and
  edges the *oracle* cannot see: method references and lambda bodies go through `invokedynamic`
  (skipped) or are marked `ACC_SYNTHETIC` by javac (excluded), so the engine's `handleRef -> readRef`
  and `handle -> read` edges look "extra" while being demonstrably real — the dynamic JVM trace
  confirms them.
* **`extra`, outside any envelope** — a defect of a different kind: an edge no sound
  over-approximation justifies. These are the ones to hunt.

## Conventions the goldens encode (deliberate, not defects)

* **Nested types are flattened.** `package p; class A { class B {} }` yields owners `p.A` and `p.B`,
  not `p.A.B`. This mirrors the IR and is accepted behaviour on both sides of every comparison.
* **Anonymous classes are keyed by supertype** (`Outer$anon:Runnable`), because javac and the engine
  number them differently — numbering would make goldens brittle for no benefit.
* **Type variables are erased** to their bound, so `add(E)` reads `add(Object)` — matching bytecode.
* **Declared unknowns are recorded.** `ambiguous_unknown` / `ambiguous_anon` lines are part of the
  golden, so losing resolution power *or* silently gaining a blind spot both show up as a diff.
* On the oracle side, bridge / `ACC_SYNTHETIC` methods, `access$N`, enum `values`/`valueOf`,
  `<clinit>`, invokedynamic plumbing, string-concat lowering, boxing **and unboxing**, the
  enhanced-for iterator triple (keyed on the mechanism, so it also covers a `java.lang.Iterable`
  and a client class implementing it), the `Objects.requireNonNull` a **bound method reference**
  emits for its receiver, try-with-resources `Throwable.addSuppressed`, and javac-synthesized
  constructors are excluded — the source contains no such call, so scoring them either way
  would be noise. `33-compiler-lowering` pins them: it pairs each construct with the
  **explicitly written** form of the same call, so an exclusion that also removed the written
  call fails the fixture.
  Still counted, and known: the `close()` calls try-with-resources emits. They are not decidable
  from the instruction — an explicit `r.close()` compiles identically — and unlike unboxing the
  written form is common, so dropping them would trade one measurement error for another.
* A lambda body (`lambda$m$N`) is folded into the method that lexically contains it.

## Cases

| case | what it pins down |
|---|---|
| `01-inheritance-override` | overriding a library class, `super.m()` delegation into the JDK |
| `02-anonymous-sam` | anonymous `Runnable`/`Comparator`/`Thread`, SAM dispatch through the interface-typed variable |
| `03-overloads-and-receivers` | overload disambiguation by arity and argument type, boxing, static and field-access receivers |
| `04-unqualified-calls` | implicit-`this` and unqualified static calls, and the same-class type qualifier |
| `05-lambda-and-method-refs` | lambda parameter typing from a client SAM and from a JDK generic, method references |
| `06-function-value-in-field` | a lambda or method reference stored in a field or local and invoked elsewhere, including one field assigned two different lambdas (must be `multi_inferred`) |
| `07-constant-looking-type` | `URI.create` / `UUID.randomUUID` / `JSON.parseObject` — all-caps types the extractor stamps as constants |
| `08-cha-interface-fanout` | class-hierarchy dispatch: abstract class bases, anonymous implementors, bridge methods |
| `09-cha-interface-injection` | interface-typed field/parameter with the implementation supplied elsewhere |
| `10-super-invocations` | `super.m()` is non-virtual — exactly one target, never a fan back to the override |
| `15-cross-file-same-package` | four files, one package, no imports: sibling-file instance call, static qualified by a sibling-file type, interface declared in another file |
| `16-cross-package-imports` | seven files, three packages: single-type import, wildcard import, static import, inline fully-qualified call, and a **simple-name collision** (`core.Config` vs `util.Config`) that a name-keyed resolver gets wrong |
| `17-nested-outer-access` | unqualified calls resolving OUTWARD: anonymous → outer instance and static, inner class, static nested, local class, and two levels out |
| `18-enum-record-sealed` | enum constant bodies, records, sealed hierarchy + pattern switch, interface default/static methods |
| `19-receiver-forms` | every receiver syntax: array element, ternary, cast, `instanceof` pattern, parenthesized, chained, varargs, `new`, string literal |
| `20-reflection-blind-spot` | reflection is out of scope by construction — asserts the sites are DECLARED unknown, never silently dropped |
| `21-function-value-blind-spots` | function values arriving via parameter and via a dispatch table (Map/List) — pins exactly which variants resolve |
| `11-cha-inherited-into-implementor` | `class Impl extends Base implements Handler` where **Base is not a Handler** — the real target is declared outside the interface's hierarchy. A dispatch gate keyed on the declaring type wrongly drops it; a shadowing rule keyed only on `method_override` wrongly keeps the abstract `Handler.handle` alongside it |
| `22-config-annotation-args` | annotation argument **values**: `@Value` with a placeholder, with a default, and with a key defined nowhere; `@ConfigurationProperties` binding exact, relaxed (kebab) and one nested level; a `CLASS_REFERENCE` argument, an **array** of them, and one inside a **nested** annotation |
| `23-config-xml-wiring` | `beans.xml` + `web.xml`: bean definitions (with and without an `id`), `<constructor-arg ref>`, `<property ref>`, `<property value="${k}">` bound to its setter, `init-method`/`destroy-method`, servlet/filter/listener registrations, a **dangling** bean ref and a **missing** class |
| `24-config-properties-yaml` | `.properties` and `.yml` as **one** key space: a placeholder chain inside one file, a chain **crossing formats** (YAML → properties), a two-hop chain, `${k:default}`, a key defined nowhere, and a value that names a handler class (vs one that merely looks FQN-shaped and must NOT resolve) |
| `25-di-narrowing` | the only place config makes the graph **smaller**. One bean satisfying an injection point collapses `multi_inferred` to `known_edge`; **two** beans must stay a fan (the soundness guard); `@Qualifier` narrows again; a constructor-injected `final` field narrows |
| `33-compiler-lowering` | constructs javac lowers into invoke instructions the source never wrote — unboxing, the `Objects.requireNonNull` a bound method reference emits, the enhanced-for triple over a `java.lang.Iterable` and over a client `Iterable`, try-with-resources — each paired with the explicitly written form of the same call, which must survive |
| `27-messaging-and-grpc` | broker listeners and gRPC services — both pure framework entry points. `@KafkaListener`/`@RabbitListener` on a method and on a class (`@KafkaHandler` dispatch); a gRPC impl overriding a **generated** `…ImplBase` (no annotation on the method, and the base is a client type, so neither the callback name list nor the library-supertype test reached it); a topic/queue named by `${...}` **inside an annotation argument**, which binds the key to the listener; and producer↔consumer linked through a shared config key |
| `26-spring-oracle` | the same constructs graded by **Spring itself** — `@Primary`, `@Qualifier` outranking it, an explicit `@Component("name")`, `@Bean` factory methods and their parameters, and the two-leading-capitals bean-name rule (`URLHandler` is *not* decapitalized) |

## Scoring a real project, and proving a change did not make it worse

The cases above are small and client-only. Two questions they cannot answer are answered at corpus
scale, against the class files a project's own build produced:

```bash
# 1. ground truth, from the artefact — no source tree, no third-party analyzer
java tools/ClassFileOracle.java --app <jar-or-classes> --with-lines --exclude-tests > gt.txt

# 2. when a client call leaves for the JDK, does the engine name the EXACTLY correct method?
python3 tools/score_boundary.py <client-IR> <engine-OUT> gt.txt --library <platform-IR>

# 3. PREVIOUS vs PRESENT — the same IR, two engine revisions
python3 tools/compare_runs.py <before-OUT> <after-OUT>
```

A case that ships a stub library also gets its boundary report pinned as
`expected/<case>.boundary` under `--oracle`, which is what makes the **scorer** testable rather
than only the engine: it used to discard every engine edge whose caller is a constructor, and to
charge the engine for sites whose receiver could only be typed through a library nobody staged.

`score_boundary.py` splits every answer by *how* it differs, because folding them together decides a
convention question by accident: an engine that flow-typed a receiver to its allocated type answers
`HashMap#put` where bytecode records the static type's `Map#put` (**MORE PRECISE**), and one that
names where the method is declared answers `AbstractCollection#addAll` for `Set#addAll`
(**DECLARING ANCESTOR**). Neither is an error. What is left over — an answer on a type unrelated to
the bytecode owner — is the number that matters, and it is reported on its own.

Its **first line is the one to read first**: how much of the library the client actually calls is
present in the staged IR. Every percentage under it is conditional on that, and on the corpus it
ranged from **25% to 86%** when only the platform IR was staged. Staging five of one project's real
dependencies (`tools/build-lib-ir.sh --coord <g:a:v>`) moved **2,303 call sites** from "no answer"
to answered with the engine untouched, and lifted that project's boundary accuracy from 86.6% to
93.6%. A low-coverage run is not measuring the rules, so the report says so before the numbers.

Two buckets are **not** the engine's and are never counted against it: `LIB IR LACKS THE TYPE`
(the ground-truth callee's own type is absent) and `RECEIVER NEEDS AN UNSTAGED TYPE` (the site's
line also calls a type absent from both IRs, so the receiver could not be typed by any rule).
Scoring a project against the platform IR alone leaves its real dependencies absent, and on the
corpus those two account for more of what was reported as unresolved than the engine did.

`compare_runs.py` exists because an aggregate that improves can still hide the two regressions that
matter, and both are invisible in "unresolved fell by 700":

* **a call site that had an answer and now has none** — a new rule can unresolve unrelated sites;
* **a call site that had one answer and now has several** — the edge survives, the precision does not.

It reads both runs site by site, reports those separately from the improvements, and **exits
non-zero** when a site was lost or unresolved. Run it on every rule change before claiming a number.

## Adding a case

1. `mkdir -p cases/NN-name/src` and write a small project with a clear intent (state it in a comment).
2. `./run-tests.sh --bless NN` and **read the generated golden** — it is the specification, so a wrong
   golden is worse than no test.
3. `./run-tests.sh --oracle NN` to confirm bytecode agrees.
4. If the case exercises config, **read `expected/<case>.config` too** — same rule: a wrong golden
   is worse than no test. If it exercises Spring specifically, add a `spring-oracle.conf`
   (`<scan-package> [key=value ...]`) and let a real container grade it.

## Is the suite actually able to fail?

Verified by mutation: disabling the one clause that admits receiverless calls
(`invocation_site(call,"method") :- call_unqualified(call,_)`) makes `04-unqualified-calls` fail
immediately with `SILENT DROP METHOD_INVOCATION (unqualified) at line 3` — the same defect that, at
repo scale, silently affected 27,533 call sites. A suite that cannot fail is worth nothing; this one
was checked.
