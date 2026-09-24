# impact — what a change to a declaration reaches

The full rules behind `axiomcode impact`. `SKILL.md` has the calling convention and an example; this is why each row says what it says, and what it is measured at.


`axiomcode impact <target>`, the target written as it appears in the code and its kind read from the index, never guessed:
`Owner.method` · `method` · `file.java:123` (a method), `Owner.field` · `CONSTANT` · `Enum.MEMBER` (a field), `Type` (a class /
interface / enum), `Owner.method(param)` (one parameter), `Type<T>` · `Owner.method<T>` (a type parameter — a generic, or a
bound on it), `Owner.method:name` (a local), `Type.<init>` (its construction) / `Type.<clinit>` (its static initialization: whoever
first uses the type). Several targets in one call are one change set. A name declared as more than one kind stops and asks for
`--kind`. The same answer shape for every kind and language:

Every judgement is a rule in `dl/impact.dl`: the Python side exports facts from graph.sqlite once per graph (members, owners,
extends, nesting, decorations, overrides, resolved and unresolved call sites, references with the qualifier written on the
line, type references, string literals, tests and fixtures), writes the target and the few text-level facts for the query, and
runs one Soufflé program — compiled to a native binary by `axiomcode index` (~20 s once for all of them, cached by the
program's hash under `dl/.cache/` and shared by every repository on the machine; on first use if the index did not warm it,
the interpreter when there is no `c++`). Warming it at index time is what keeps a caller with a timeout — `hooks/changes.py`
runs impact with `timeout=14` on every edit — from killing the compile before it can finish and caching nothing.
Direct dependents, the contract, the seeds, the closure, the chains (`parent_up`) and
the tests are all derived in the same run; nothing is recomputed a second way. What is verified afterwards is the export:
every printed chain hop and every `[resolved]` entry is looked up again in `graph.sqlite` (the `verified:` line).

- **a configuration key is a target** — `axiomcode impact server.error.path`: the methods the container binds it into
  (`@Value`, `@ConfigurationProperties`, a `.yml` / `.properties` key), from the engine's framework facts, then everything
  that reaches them. No call site carries these edges, so nothing else finds them. A key the engine never saw **stops with
  that sentence** — its impact is unknown, not empty — and a graph with no configuration facts at all says so; a key is
  never answered as a by-name match on code, which is what made a wrong answer look like an answer.
- **what the container injects** — a type registered as a bean, or a method that defines one, lists the callables the
  container hands it to (`ctor_param`, a field injection): `receives it by dependency injection — the container hands it
  over, no call site`. Swapping a `@Bean` implementation reaches its consumers this way.
- **a handler nothing calls is still used** — a declaration handed over as a *value* (`app.get('/orders/:id', getOrder)`,
  `background.add_task(send_receipt, id)`, `setTimeout(flush, 1000)`, `handlers = {"x": handle_x}`) has no call site
  anywhere: the call happens inside the framework, or later, or never. Every other rule here is about call sites, so this
  used to answer *"the declaration is used only where it is declared"* — and `--delete` said **no dependent at any
  certainty** — for a live HTTP handler. The reference the parser recorded is read instead, and the site says what will do
  the calling: `registered as a GET route "/orders/:id" here — the router calls it, no call site does` when the call is a
  route registration (a router verb *and* a string argument that begins with `/` — `get`/`set`/`delete` alone are Map, Set,
  Headers and every cache in this ecosystem, so the verb is never matched by itself), otherwise `handed to add_task(…) as a
  callback`. It is `[by name]`: the parser says the identifier binds to a callable, not that it binds to *this* one.
  Where the engine already resolved the registration to an edge — a JavaScript `app.get('/pads', listPads)` is a resolved
  call in that engine — the row stays `[resolved]` and only the sentence changes, so the reader learns that what they are
  changing is `GET /pads` rather than that some module calls it. **JavaScript gets the wording and no name-matched rows:**
  its `refs` carry the access mode (`IDENTIFIER|READ`) and no entity kind, so nothing there distinguishes a reference to the
  declaration from a parameter of the same name. A site-keyed version was written for it and measured on a 124-file Express
  application: eleven rows over 30 sampled targets, and all eleven were wrong (seven a parameter named `callback` inside
  `forEach(function (callback) {…})`, four a `settle` being *called* inside the `.then(…)` span it sits in). It is not
  shipped. The rule needs the parser to say that an identifier binds to a callable, which TypeScript, Python and Java do
  and JavaScript does not.
- **must change with it** — declarations bound to the target by a contract the engine resolved: the overrides of a method (and what
  it overrides), the subtypes of a type. A signature change reaches these first.
### What breaks a build, and what does not

The sections are relations, not severities, and reading them top-down as "most to least urgent" is wrong.
Nothing under `produces or writes it` necessarily fails a build: those rows are dataflow — who makes a value of
this shape, including deserialization that writes it reflectively. A `[text]` row under `bound from outside the
source` can never fail a build; the compiler does not read that file at all, which is exactly why it is printed
last and says so.

For a field, the rows that stop a build are usually in neither list. Changing a field's TYPE changes the
signature of whatever is generated from it — an all-args constructor, a setter, a copy/`with` — and it is the
callers of THOSE that break, at the argument they pass. They touch the generated member, not the field, so no
rule puts them under the field's own relations. The answer now says this directly under the generated-members
line and names the constructor query to run; take that suggestion before acting on the first list.

- **produces or writes it** — the blast radius read top-down starts where a value of the new shape has to be *made*: setter and
  builder calls, constructor calls (declared or generated), and the **holders** — a type with a field of the target's type, where
  that holder is constructed or deserialized (`Holder.class` handed to a deserializer or a framework: reflection produces the
  field's value there, through the generated setters). A field's declared or generated setter, a generated constructor.
- **reads or uses it** — every callable whose text uses the declaration, grouped by *why* (calls it, reads it, instantiates it,
  names it in a signature, uses a member imported from it, …) and by *how sure*: `[resolved]` an edge the engine resolved (a call
  — `[one of a set]` when it is a multi_inferred target set —, an override, a subtype, a constructor); `[in scope]` a reference by
  that name inside the owner type, a subtype or a nested type; `[by name]` a reference by that name elsewhere — the receiver was
  not typed, so it may be a same-named other thing — including a read written through a variable from a callable with no
  owner type at all, which is what a module-level function in Python or JavaScript is; `[text]` the name found in the source where the parser records no line (Java
  type references in signatures), comments and strings stripped. A bare name inside a type that declares its own member of that
  name is that member, not the target; a qualified `X.name` is confirmed when `X` is the owner and dropped when `X` is another
  type. For a field, a **declared accessor** in the owner (`getF` / `setF` / `isF` / `f()`) is its door: the accessor's callers are
  listed as reading or writing the field through it. A **generating decoration** — Lombok `@Data` / `@Getter` / `@Setter` /
  `@Value` / `@Builder` / `@AllArgsConstructor` / `@With`, a record, a dataclass — declares members the source never spells, so a
  call to `getZipCode()` or `new Address(…)` is an unresolved site; the unresolved sites written with the generated name are listed
  as calling the generated getter / setter / constructor `[by name]`, with the decoration that generates it. Where the ENGINE
  synthesises the member instead of leaving the site unresolved (Java's Lombok and records, C#'s auto-properties: a `methods`
  row with provenance `generated`), the call site resolves to it and the caller is named `[resolved]` — *reads it through
  getName()* — which is the same answer with a stronger claim behind it. A string literal
  equal to the field's name (a map key, a serialized name, a request parameter) is listed `[text]`.
- **the upstream answer is measured against behaviour, not against itself** — `validate/upstream.py <repo>` takes a tree with
  `.axiomcode/mutation.json` (a method broken, the test files that then failed), asks `impact <m> --tests` which test files
  reach it, and classifies every miss from the graph. a JVM HTML parser, 24 methods, 244 (method, test file) pairs: recall 0.795 → **0.988**,
  precision 0.328 → 0.338, after the three rules the misses named — a test class that *extends* a reached one runs its tests
  (its HTTP-client test classes declare almost nothing: 20 of the 27 misses), a call site written with the target's name
  that the engine could not resolve (`import static Outer.Inner` left `res.prepareResponse(…)` untyped: 8 more), and a test
  file's import-time code (a class body, a fixture). a Python validation library, 14 methods, 180 pairs: 0.678 → 0.717 — what remains
  is dispatch a static graph cannot see (`__eq__` and the other protocol methods the interpreter calls, a method reached
  through `getattr(self, f"_{kind}_schema")`), and the answer now says that instead of printing nothing. A TypeScript web framework
  (16 methods, 96 pairs, `validate/mutants.py` builds the truth: break a method, run the suite, record
  which test FILES newly fail): 0.000 → 0.790. It was zero because a vitest test is an anonymous callback handed to
  `it(…)` — 6,661 of its 7,723 callables in test files are `<arrow>` and two carried a name the old rule accepted,
  so the test universe was empty and every answer named no test file at all. A callable registered by `it` / `test` /
  `bench` on its own line is a test, and a helper declared beside them carries them. The PARAMETERISED form needs the
  call site rather than the line: `test.each` + a template table writes the arrow after the closing backtick, on a
  line naming no registrar at all (18 of them in that library), so a callable inside the span of a `TAGGED_TEMPLATE_CALL`
  to `each` — its first line read to confirm the receiver the call site does not carry — is a test too. That shape is
  vitest / jest / mocha's alone: a pytest test is found by its name however deep the decorator stack, so nothing there
  depends on which line the registrar is written on.
  **What a selection costs and buys, on that same TypeScript library, measured again with the rungs separated** (a
  fresh clone, 311 source files, 130 test files, 5,193 tests in 17 s; 16 methods broken one at a time, 54 (method,
  test file) pairs of behavioural truth): recall **0.778**, precision 0.636, and the answer names **4.1 test files of
  130** for a change — 3 % of the suite. Per rung, against that truth: a `[sound]` route (every hop a single resolved
  target) is right **29 times in 30**; `[one of a set]` is right 1 in 8; `[by name]` 0 in 1. By distance: 1 hop 0.667,
  2 hops 0.900, 3 or more 1.000 — the far pairs are few and all real. So a pipeline that runs the sound rung first is
  almost never wasting a run, and the waste is concentrated in exactly one rung, which is why the rungs are reported
  separately rather than blended. Every remaining miss is `no-edge` — a handler the graph has no resolved caller for
  (an adapter, a JSX intrinsic element) — not a rule this tool could tighten.
  A library is not a service, and the number differs by population: on a Python SERVICE driven through its frameworks
  (two Python web frameworks + CLI routes, a pytest suite with conftest fixtures, a decorator registry, a signal loop, 53
  functions broken one at a time, 95 (method, test file) pairs) recall was **0.216** — 26 of 40 answers named no test
  file at all — because the suite reaches the code the way the outside world does: through the framework. The
  registration-key hop and the injected-fixture rules take it to **0.695** at precision 0.930, and what is still
  missing is named rather than guessed: a function reached only through a table or list of functions dispatched by
  index (`TRANSFORMS = [strip, upper]`, `EXPORTERS[kind](x)`), a decorator that wraps a callable in an object whose
  method calls it (`@shared_task` … `.delay()`), and a closure defined in one method and returned to another.
  Held out, on a subject nothing was tuned against (the Python web framework's own 491-test suite, 40 functions broken, 172 pairs):
  0.564 → **0.727**, precision 0.527 → 0.310. Both halves of that trade are real and neither is free — the recall is
  routes and fixtures the answer could not see before; the precision is the fan-in of a framework whose every test
  builds an app. A key that identifies MANY declarations identifies none: the Python web framework's own suite registers `"/"` from 236
  places and asks for it from 200 more, so a key registering more than `AXIOMCODE_KEY_CAP` (4) declarations is
  REFUSED rather than joined — the engine's `fan_capped` judgement one layer up. Uncapped that subject reads 0.791
  recall at 0.248 precision. The same cap applies to the other side (`AXIOMCODE_KEY_USE_CAP`, 4): on the JVM parser the keys
  that survive the registration cap are `p`, `b`, `table`, `em` — HTML tag names, written by 356 callables and
  "registered" by two, because a decoration argument is not always a registration (`@ValueSource(strings = {"p"})`
  is test DATA). One Java method went from naming 1 test file to naming 61 until that cap was added, and 6 after it.
  Neither cap needs a catalogue of which decorations register and which do not, which is the point of them.
  **A cap and a kind guard answer different questions, and the second is invisible to the first.** A cap says *this
  key is too wide to mean anything*; it cannot say *this was never a dispatch key at all*. A test's own decoration
  carries its INPUTS — `@ValueSource(strings = {"/htmltests/large.html"})`, `@CsvSource`, `@pytest.mark.parametrize`
  — one declaration, a handful of writers, under every cap, and entirely meaningless as a key; and a route mounted
  inside a test file is a fixture, not the application's dispatch table (on one TypeScript router library **every**
  route registration line, 6,128 of 6,128, is in a test file). So a decoration on a test declaration is not read as
  a registration at all, and a route registered in a test file keeps its dependent row and its sentence but is given
  no joinable key.
- **precision is not a bug to fix, it is a property to report** — `validate/precision.py <repo>` places every predicted
  (method, test file) pair by the worst hop on its best route and by distance, against the same truth. On the JVM parser: a route of
  single-target resolved calls is right 0.765 of the time, one through a call resolved to a SET 0.301, through an override
  reached from its base 0.170; within 3 hops 0.70, beyond 5 hops 0.24; a sound route within 3 hops 0.889 — but that keeps
  only 48 of 219 true pairs. The split that explains the 0.34 overall is fan-in, not error: 10 of the 24 methods are hubs
  every test reaches (it parses HTML in every suite) — those answers are 60 of 98 test files at precision 0.285 with
  recall 1.000, while the 14 narrow methods score 0.642 with 7 of them exactly right. A test that *reaches* a change and
  does not fail is not a wrong edge: it runs the code and does not observe the change. So `--tests` answers "which tests
  CAN observe this" and says how sure each route is (`[sound]`, `[one of a set]`, `[dispatch]`, `[by name]`, nearest and
  surest first) and, when most of the suite reaches the method, that at this fan-in reaching says little about failing.
  It is a ranking, not a test selection; a narrow answer can be used as one.
- **reaches those through resolved calls** — the transitive impact: everything that can reach a touched callable, by hop and by
  file, with the entry points among the reached callables *and* the direct dependents (a `@PostMapping` handler that reads the
  field is where the change is observed from, though nothing resolved calls it). The tests are always counted by rung, with
  the strong-route ones (`[sound]`, `[one of a set]`) named and the top test files; `--tests` lists every one by rung and test
  file, `--tests-only` prints only that, `--why` adds each test's shortest chain to the change, and `--tests-in <path>` narrows
  the listing (not the closure) to test files containing it. Listing all of them with their chains by default was 169k
  characters for a hub method — 435 tests, 433 of them on weak routes (#1194). `--json` carries the full list. A test counts when
  its own body reaches the change **or a fixture its framework runs first does** (a constructor, a static initializer, `@Before*`,
  `setUp` — a convention table, printed as such), **or it names the key the change is registered under** (below).
  `--in <path>` and `--depth N` bound it; `--json` is the same answer as data.
- **a registration key is a hop** — a route handler, a signal receiver, a CLI command and a table entry are one shape: the
  declaration is registered under a STRING and whoever wants it writes that string, not its name. `@router.post("/orders")`
  and `client.post("/orders")`; `@receiver("order_created")` and `emit("order_created", …)`; `@cli.command("price")` and
  `invoke(cli, ["price", "4"])`; `@exporter("csv")` and `export(order, "csv")`; a a Python web framework `add_url_rule("/quote/<id>",
  view_func=legacy_quote)`, where the declaration is handed over as a value and no call site names it at all. Both ends are
  in the graph and nothing joined them, so a test that drove the app through its framework reached nothing — which is most
  of what a service's suite does. The two spellings of a path are matched segment by segment (`/orders/o-1/price` against
  `/orders/{order_id}/price`, `<int:id>`, `:id`), never normalised. It is **not** an edge the engine resolved and is never
  shown as one: the hop is `[by key]`, and a literal can be a same-valued other thing.
- **a decorator that rebinds the name is a hop** — `@audited def summarise(…)` leaves `summarise` denoting what
  `audited(summarise)` RETURNED, so every caller written with that name runs the wrapper. That is the engine's own
  resolution (`ext_decorated_name_target`), not a name match, so the hop is `[sound]`; without it a `functools.wraps`
  wrapper — retry, cache, login_required, a task — has no caller at all and a change to it reaches nothing. What the
  graph still cannot say is the OTHER decorator shape, where the decorator returns an object rather than a function
  (`@shared_task` … `.delay()`): there the name denotes an instance, and the engine says so rather than guessing.
- **a fixture the framework injects** — pytest matches a test's PARAMETER NAME against the fixtures visible from its file:
  those beside it and those in a `conftest.py` of any ancestor directory, which is not the test's file and is imported by
  nothing. A `@pytest.mark.usefixtures` marker names one instead, and an `autouse=True` fixture runs before every test in
  its scope without being named anywhere. A fixture may request another fixture, and then both run. None of that is a call.
  A route that runs a fixture first is reported as `[fixture]`, and it is the weakest rung above `[by name]`: the
  framework does run it and it does reach the change, but the test's own body may never touch it. How often each rung
  is right, measured against mutation truth on three Python subjects (`n` is the pairs the rung named, and a rung with
  a handful of pairs says nothing — it is printed so you can discount it, not so you can rank on it):

  | rung | small framework service | web framework | CLI library |
  |---|---|---|---|
  | `[sound]` | 1.000 (n=19) | 0.895 (n=86) | 0.561 (n=132) |
  | `[at import]` | 1.000 (n=17) | — | — |
  | `[defines]` | — | 1.000 (n=1) | 0.875 (n=8) |
  | `[one of a set]` | 1.000 (n=2) | 0.659 (n=44) | 0.657 (n=99) |
  | `[by key]` | 0.926 (n=27) | 0.342 (n=73) | 0.000 (n=3) |
  | `[decorator by name]` | 1.000 (n=8) | 0.667 (n=3) | — |
  | `[protocol]` | 1.000 (n=4) | 0.882 (n=17) | 0.400 (n=5) |
  | `[fixture]` | 1.000 (n=27) | 0.382 (n=102) | 0.536 (n=112) |
  | `[by name]` | 0.333 (n=3) | 0.531 (n=32) | 0.475 (n=61) |

  `[protocol]` is the newest row and the one to read carefully: its only substantial sample, 17 pairs on the web framework,
  puts it at 0.882 — second to `[sound]` on that subject and well above the two rungs printed ABOVE it. That is not
  enough to re-rank a ladder on, for the reason the rest of this paragraph gives, but it is enough that a reader
  should not discount a `[protocol]` route for its position.

  And read what a rung CLAIMS, not only how often it holds: `[sound]` means a resolved single-target call chain
  within three hops — a fact about the edges — and never that the test exercises the change. `[at import]` is the
  one rung that is about the test rather than the edge: the module raised while being imported, the file never
  loaded, and the test was never collected, so its body is irrelevant. Read that table before trusting the order
  the answer prints. The TOP of the ladder holds: `[sound]` and
  `[one of a set]` are the best rungs on the subjects with enough pairs to say. BELOW that the order is not stable
  across subjects and the printed ranking is a tie-break of what KIND of evidence a hop is, not a measured ordering:
  `[by key]` is the best rung on one subject (0.926) and the worst on another (0.342), and `[by name]` is printed
  last while measuring above `[by key]` on both of the two large subjects. An answer's label is still the WORST rung
  on its route, so it remains a floor — but a `[by name]` route on a library-shaped codebase is not the near-worthless
  thing its position suggests. And `[sound]` at 0.561 on the CLI library is the plainest statement of the whole limit: reaching
  is not failing, and on a codebase whose tests drive one hub, a resolved call within three hops is right barely more
  than half the time. A test
  reached BOTH by its own body and through a fixture is reported as the body: the same distance, the stronger claim,
  and it moves 37 of the CLI library's pairs off the fixture rung. And what the rules add is a POPULATION effect, not a general
  one — on a third held-out subject (a CLI library, 2,058 tests, 40 functions, 293 pairs) they move four
  targets and carry 0.802 recall at 0.566 precision, against 0.792 / 0.569 with every framework hop turned off,
  because its tests reach its code by CALLING it. The framework hops pay where a framework is in between and very
  nearly cancel where it is not: on the CLI library the decorator hop alone adds 3 true pairs and 4 false ones.
- **verified** — every printed edge looked up again in the graph; **bound** counts the unresolved calls inside the impacted
  set, so the set is a lower bound on the real one; a **note** counts the entries matched by name or text.

`--delete` adds a verdict: **is it safe to delete** — the callers and contracts that say no, or, when there are none, exactly
what the graph cannot vouch for (by-name matches, string literals equal to the name — a reflective call, a bean name, a config
key —, the decorations a framework may dispatch on, the unresolved calls inside, the tests that reach it). With **several
targets** (a PR touching many files) each row says which target it came from — `[for Owner.method]` — so a combined radius is
still attributable per change.

**The unit of change is a declaration in the graph, and half of real Java commits change something else** (592 commits over
five projects: 47 % touch no Java file at all, 30 % touch Java plus a build or resource file). Three of those kinds now have a
target of their own: `@Transactional` (an annotation — every declaration carrying it, and their dependents), `Enum.<new>` (a
constant that does not exist yet — the switches that need a new arm), and a configuration key. A method target also reports
its **throws** contract: adding a checked exception reaches *every* resolved caller, and the answer says how many of them
already catch or declare the ones it has. Still outside the unit, and said rather than guessed: a build file or a dependency
bump, an added overload's rebinding of existing call sites, and what a framework does with an annotation (the proxy, the
transaction, the cache) — `changed` says that in the same line as the decoration change.

What it cannot see, by construction — say so instead of guessing: a callable that touches a type only through a value it never
names (`t.asStartTag().normalName()` where the engine resolved `normalName` to the inherited `Tag.normalName`) — the graph keeps
no receiver type at a call site, so the compiler sees that dependency and this tool does not; the `[one of a set]` callers are
the engine's over-approximation and most of them will not compile against the change; a bound change on a type parameter
reaches the sites that instantiate `Type<…>`, listed, but nothing checks the argument against the bound; the transitive layer
is the call graph's, so everything `path` cannot find (callbacks handed to a library, reflection, framework dispatch) is a
missing chain here too and is counted in `bound:`, never guessed. What a **decoration turns on** is not in the graph either —
`changed` reports `@Transactional` / `@Cacheable` / a route as a decoration change and says in the same line that the proxying,
the transaction or the cache behind it is invisible; only the code that names it is. Still **not expressible today**, and said
so rather than answered: which `switch` arms an added enum constant breaks, who must catch an added `throws`, which call sites
an added overload rebinds (no argument types per call site), and what a dependency bump reaches (one graph, no library diff).
Test selection from a body change is sound but wide — 41–87 % of a suite on a hub graph — because every path through the hub
is real; narrowing it is ranking, not reachability, and is not attempted here.

Measured two ways, Java first. (1) A Java defect benchmark: the methods each fix changed as the change set, `--tests` against the tests
it observed failing on the buggy tree — 273 bugs of 17 projects, every triggering test found in 266, trigger recall 0.929,
mean selection 50 % of the suite, and the same verdict as the benchmark's own independent reading of the same graphs in 252 of
256 bugs (better in 3, worse in 1 — a method the fix *added*, absent from the buggy tree); every remaining miss is an engine gap
(an overload set, a callback through `Function.apply`), not a tool loss. (2) The compiler: on five of those projects, 412 sampled
declarations, one edit each — rename a field, a method (all its overloads), a type (plus an empty stub with the old name, so member
uses fail too), a type parameter; remove a parameter — and `javac` over the whole tree names the dependents. Recall: fields 0.997,
methods 1.000, types 0.962, parameters 0.944, type parameters 0.977. Precision by certainty, all kinds: `[resolved]` 528/585,
`[in scope]` 249/256, `[text]` 683/773, `[by name]` 157/291, `[one of a set]` 126/351, contract 69/144 (the compiler confirms
only the override direction that breaks). The harnesses are `impact-arena.py` and `oracle-b.py` next to the arena. (3) By hand, on a
multi-module Spring / SOFA-RPC / Lombok `@Data` system where every model is generated accessors: a `String zipCode` field on a
shared `Address` → the three places an `Integer` breaks (the owner's formatter, the five `getZipCode().length()` / `.trim()` uses
in another service, the generated all-args constructor call in a web controller) and nothing else; a facade method called
through `@SofaReference` fields in two other services → the override, the three callers, the three REST entry points; an enum
member → its one use, with `PaymentStatus.PENDING` and `ShipmentStatus.PENDING` correctly excluded; a shared value type → all six
files, including a chained `product.getPrice().getAmount()` a grep for the type cannot see; a field with declared accessors →
every accessor caller across three services plus the `"stockQuantity"` map key. Other languages share every code path except
the static-import rule (Java syntax) and are not yet measured.

