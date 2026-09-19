---
name: axiomcode
description: Build AxiomCode's type-resolved call graph of a Java, TypeScript, Python or JavaScript repository, draw it as one page, and answer "is there a chain of calls from A to B, and through what?" and "what has to be looked at again if this declaration changes?" in Datalog over it, every printed hop verified. One entry point, `scripts/axiomcode`, with subcommands; every future capability is a subcommand of it.
---

# axiomcode

One command, run from the repository root via Bash: `<this dir>/scripts/axiomcode <subcommand> …`

The same subcommands are MCP tools when this plugin is loaded (`mcp__plugin_axiomcode_axiomcode__axiomcode_path`, `…_impact`,
`…_index`, `…_graph`, from `plugins/axiomcode/.mcp.json` → `mcp/server.py`): typed parameters, the same verified output.
Prefer the MCP tool when it is in your tool list; the CLI is the same code.

When the plugin is loaded, a PostToolUse hook adds the graph's edges to your own Read, Grep, Glob and shell grep/sed/cat
results (`graph: …`). A Read gets only the edges its text cannot show: callers and callees in other files or in this file
outside the lines read (`L240`), overrides elsewhere or in this file's inner classes, unresolved calls — counts by default,
names when there are ≤ 3 or when the other end is something you read earlier (★), the rest as one `+N more` line, ≤ 6 lines.
A grep for an identifier gets the callables it names or prefixes, with the same; a file glob gets the files' callables.
SQLite lookups only, ~0.1–0.5 s; nothing is added when the repo has no graph.

```
axiomcode index [<repo>] [--lang <l>] [--src <dir>] [--library <root>,…]   the pipeline: parser → engine → .axiomcode/out/graph.sqlite (+ index)
axiomcode graph [<repo>] [--out <folder | page.html>] [same flags]        the graph as one page; runs the pipeline only when there is no up-to-date graph
axiomcode path <from> <to> [<repo>] [--every|--paths N] [--in <path>]     the shortest chain of calls from A to B per target (--every: all routes) — or why there is none
axiomcode path '*' <X>  ·  path <X> '*'                                   everything that can reach X (with its entry points) · everything X reaches
axiomcode path <word> '*'                                                 no exact name yet? a bare word matches every declaration containing it
axiomcode impact <target>… [<repo>] [--tests] [--depth N] [--in <path>]  what a change to a method / field / type / parameter / type parameter / local reaches, and how sure
axiomcode changed [<repo>] [<file>…] [--range a..b | --staged] [--impact]  which declarations an edit changed and HOW (signature, field type, body …) — then impact on all of them
axiomcode test-impact [<repo>] [--range a..b | --staged] [--json] [--why]  which tests the edit in front of you reaches, and the command that runs them
```

`<repo>` defaults to the current directory. The page goes to `<repo>/.axiomcode/graph/graph.html`; `--out <folder>`
puts it at `<folder>/<repo>.html`, `--out x.html` at that path. With an up-to-date graph, `graph` takes ~1 s.

- **Say the language and the tree** when the repo mixes them: `--lang typescript --src src`. Auto-detection counts
  files, so a TypeScript project with many `.js` scripts is otherwise taken for JavaScript.
- **Pass the dependencies.** `--library` (or `AXIOMCODE_LIBRARY`) names the roots the engine may resolve into
  (Java: the JDK and third-party sources/IR). Without them, calls into dependencies are `ambiguous_unknown`
  and the resolution rate is understated; a Java build without roots prints a warning — do not quote its rate.
- `index` prints resolved / unresolved counts; quote that line. An unresolved call is *unknown, not absent* —
  never report it as "no callers".
- The page: directories at the centre, files, types and methods in rings under their parent; edges are the
  engine's resolved calls with their tier (one target grey, sound set cyan, library orange, extends violet).
  Search by name; click a node for `file:line`, callers/callees with tiers, **impact ↑** (everything that can
  reach it, a lower bound when it has unresolved sites) and **chain ⇢**. Clicking a method opens its source on
  the left (the page embeds the sources; up to 40 MB) with every call in the body a link coloured by what the
  engine resolved it to — grey one target, cyan a sound set (a chooser when several), orange a library black
  box, amber unresolved; click opens the callee in a window stacked below, ⌘/Ctrl-click goes there; *whole
  file* and an *editor ↗* (`vscode://`) link per window. The left panel hides or shows each node kind — tests included — narrows
  to unresolved / entry points / tests, toggles each edge kind, and limits the view to 1–3 hops.
  `graph.html#n=Owner.method&impact=1` links to a node. Tell the user to `open .axiomcode/graph/graph.html`.

## impact — what a change to a declaration reaches

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
  reach it, and classifies every miss from the graph. jsoup, 24 methods, 244 (method, test file) pairs: recall 0.795 → **0.988**,
  precision 0.328 → 0.338, after the three rules the misses named — a test class that *extends* a reached one runs its tests
  (jsoup's java11 `HttpClient*Test` declare almost nothing: 20 of the 27 misses), a call site written with the target's name
  that the engine could not resolve (`import static Outer.Inner` left `res.prepareResponse(…)` untyped: 8 more), and a test
  file's import-time code (a class body, a fixture). pydantic (Python), 14 methods, 180 pairs: 0.678 → 0.717 — what remains
  is dispatch a static graph cannot see (`__eq__` and the other protocol methods the interpreter calls, a method reached
  through `getattr(self, f"_{kind}_schema")`), and the answer now says that instead of printing nothing. hono
  (TypeScript, 16 methods, 96 pairs, `validate/mutants.py` builds the truth: break a method, run the suite, record
  which test FILES newly fail): 0.000 → 0.790. It was zero because a vitest test is an anonymous callback handed to
  `it(…)` — 6,661 of hono's 7,723 callables in test files are `<arrow>` and two carried a name the old rule accepted,
  so the test universe was empty and every answer named no test file at all. A callable registered by `it` / `test` /
  `bench` on its own line is a test, and a helper declared beside them carries them.
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
  (FastAPI + Flask + click routes, a pytest suite with conftest fixtures, a decorator registry, a signal loop, 53
  functions broken one at a time, 95 (method, test file) pairs) recall was **0.216** — 26 of 40 answers named no test
  file at all — because the suite reaches the code the way the outside world does: through the framework. The
  registration-key hop and the injected-fixture rules take it to **0.695** at precision 0.930, and what is still
  missing is named rather than guessed: a function reached only through a table or list of functions dispatched by
  index (`TRANSFORMS = [strip, upper]`, `EXPORTERS[kind](x)`), a decorator that wraps a callable in an object whose
  method calls it (`@shared_task` … `.delay()`), and a closure defined in one method and returned to another.
  Held out, on a subject nothing was tuned against (Flask's own 491-test suite, 40 functions broken, 172 pairs):
  0.564 → **0.727**, precision 0.527 → 0.310. Both halves of that trade are real and neither is free — the recall is
  routes and fixtures the answer could not see before; the precision is the fan-in of a framework whose every test
  builds an app. A key that identifies MANY declarations identifies none: Flask's own suite registers `"/"` from 236
  places and asks for it from 200 more, so a key registering more than `AXIOMCODE_KEY_CAP` (4) declarations is
  REFUSED rather than joined — the engine's `fan_capped` judgement one layer up. Uncapped that subject reads 0.791
  recall at 0.248 precision. The same cap applies to the other side (`AXIOMCODE_KEY_USE_CAP`, 4): on jsoup the keys
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
  (method, test file) pair by the worst hop on its best route and by distance, against the same truth. jsoup: a route of
  single-target resolved calls is right 0.765 of the time, one through a call resolved to a SET 0.301, through an override
  reached from its base 0.170; within 3 hops 0.70, beyond 5 hops 0.24; a sound route within 3 hops 0.889 — but that keeps
  only 48 of 219 true pairs. The split that explains the 0.34 overall is fan-in, not error: 10 of the 24 methods are hubs
  every test reaches (jsoup parses HTML in every suite) — those answers are 60 of 98 test files at precision 0.285 with
  recall 1.000, while the 14 narrow methods score 0.642 with 7 of them exactly right. A test that *reaches* a change and
  does not fail is not a wrong edge: it runs the code and does not observe the change. So `--tests` answers "which tests
  CAN observe this" and says how sure each route is (`[sound]`, `[one of a set]`, `[dispatch]`, `[by name]`, nearest and
  surest first) and, when most of the suite reaches the method, that at this fan-in reaching says little about failing.
  It is a ranking, not a test selection; a narrow answer can be used as one.
- **reaches those through resolved calls** — the transitive impact: everything that can reach a touched callable, by hop and by
  file, with the entry points among the reached callables *and* the direct dependents (a `@PostMapping` handler that reads the
  field is where the change is observed from, though nothing resolved calls it); `--tests` lists the tests, each with its
  shortest chain to the change. A test counts when
  its own body reaches the change **or a fixture its framework runs first does** (a constructor, a static initializer, `@Before*`,
  `setUp` — a convention table, printed as such), **or it names the key the change is registered under** (below).
  `--in <path>` and `--depth N` bound it; `--json` is the same answer as data.
- **a registration key is a hop** — a route handler, a signal receiver, a CLI command and a table entry are one shape: the
  declaration is registered under a STRING and whoever wants it writes that string, not its name. `@router.post("/orders")`
  and `client.post("/orders")`; `@receiver("order_created")` and `emit("order_created", …)`; `@cli.command("price")` and
  `invoke(cli, ["price", "4"])`; `@exporter("csv")` and `export(order, "csv")`; a Flask `add_url_rule("/quote/<id>",
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
  framework does run it and it does reach the change, but the test's own body may never touch it. Measured on Flask's
  own suite, held out: `[sound]` is right 0.645 of the time, `[one of a set]` 0.414, `[by key]` 0.396, `[fixture]`
  0.153, `[by name]` 0.176 — so the ladder the answer prints is ordered by evidence, not by assumption. A test
  reached BOTH by its own body and through a fixture is reported as the body: the same distance, the stronger claim,
  and it moves 37 of click's pairs off the fixture rung. And what the rules add is a POPULATION effect, not a general
  one — on a third held-out subject (click, a CLI library, 2,058 tests, 40 functions, 223 pairs) the answers are
  byte-identical to the ones before any of this, 0.803 recall at 0.450 precision, because its tests reach its code by
  CALLING it. The framework hops pay where a framework is in between and cost nothing where it is not.
- **verified** — every printed edge looked up again in graph.sqlite; **bound** counts the unresolved calls inside the impacted
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

Measured two ways, Java first. (1) Defects4J: the methods each fix changed as the change set, `--tests` against the tests
Defects4J observed failing on the buggy tree — 273 bugs of 17 projects, every triggering test found in 266, trigger recall 0.929,
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

## changed — from an edit to the declarations it touched

`axiomcode changed` maps a change onto the graph's declarations and says *how* each changed, in every language from the text:
`signature` (parameters added / removed / renamed / retyped — `+reason`, `-x`, `zip: String → Integer` —, the return type),
`body` (only lines inside a method), `field` (its type `String → Integer`, its name, its initializer), `type` (a header: name,
extends / implements, type parameters), `removed`, and `added` lines outside any known declaration (listed, not analysed —
nothing depends on new code yet). By default it reads the working tree against **the commit the graph was built from** (the
build stamps it), so an uncommitted edit is always measured against the tree the graph describes; `--range a..b` reads two
commits (when the graph is at the newer side, the declarations are the new text's and the direction is turned around),
`--staged` the index, `--old/--new/--file` two texts of one file. Each line ends with the target `impact` takes for it — a
signature with one parameter changed is `Owner.m(param)` — and `--impact` runs impact on all of them as one change set.

Measured against 270 real fixes (the Defects4J arena: the fix applied to the buggy files, the declarations it reports
against the benchmark's own scanner's reading of the same hunks, its class-level state expansion taken out): exact
agreement on 255, 465 declarations reported for the scanner's 473 — recall 0.968, precision 0.985. Every remaining
disagreement was read in the diff: the scanner charges an `@Override` line above an *added* method to `<init>` where this
names the method; an anonymous class added inside a method body is "that method's body changed" here (the scanner names
the new anonymous methods from the fixed tree); a renamed method is reported under its OLD name (what callers reference); a
new nested type is named as well as its members; one miss stands — a method extracted from an existing body whose header
lands in a replaced region. Nothing in the tool's answers was bent toward the benchmark: where the two differ, the diff
was the judge.

The plugin's hooks do this without being asked, at every moment an edit can happen (`hooks/enrich.py`, `hooks/changes.py`):
**PreToolUse on Edit / Write / MultiEdit** applies the edit to a copy and, when it changes a signature, a field's type, a type
header or removes a declaration, gives the blast radius *before* the file changes; **PostToolUse on Edit / Write / MultiEdit**
reports every changed declaration after it lands (a body-only edit included); **PostToolUse on Bash** re-reads the working
tree after a command that can modify sources (`sed -i`, `patch`, `git apply / checkout / pull / merge / stash pop`, a redirect
into a source file, a script run); **UserPromptSubmit** is the safety net — whatever changed the tree since the graph's commit
by any means and was not reported yet. Each declaration is reported once per session; each report is `changed` (which
declaration, how) and `impact` (up to three declarations in parallel, a few lines each: what must change with it — for a
signature, a field, a type or a removal —, who produces or writes it, who reads it, how many callables and tests reach it,
the unresolved-call bound). That is where the agent that changed `String zipCode` to `Integer` is told, before the edit
lands, about the five `getZipCode().length()` uses in another service, the generated constructor call in a controller, and
the four repositories that deserialize a holder.

**Does it find what it says it finds?** `tests/run.py` at the repository root: a synthetic project per behaviour under
`tests/cases/<language>/<name>/`, each with the claim it checks, what must appear in the answer and what must not. It
covers the shapes that used to be answered wrongly: a `this.field` write in an unrelated class, an enum member against a
nested type of the same name, an overload written by its parameter type (`Store.get(String)`), a Java text block and a
JavaScript regex literal, `holds` scoped to the declaring type, a subtype contract where the engine emits no override
rows, a Python `@property` as a private field's door, a house decorator that wraps `dataclass`, and a local variable
that must not carry the method's blast radius. Java, Python, TypeScript and JavaScript.

**Is what the hooks put in context true?** `hooks/validate.py <repo>` generates events (Reads of whole files and ranges, Greps of
declared identifiers, edits that change a body, a signature, a field's type — before and after landing) or replays recorded
ones (every hook block is logged in full with its input in `.axiomcode/hooks.jsonl`), and checks every stated fact against
`graph.sqlite` and the source: each callable named is declared at that line in that file (or the block says the file changed
since the graph was built — the Read block now says so), each caller / callee named has an edge, each count is the table's,
each changed declaration spans a changed line, each name under must-change / produces / reads is in `impact`'s answer with
that role. On the Lombok system 1,036 facts, 0 wrong; on jsoup 2,693 facts, 0 wrong — after it found two real errors: an
enum's synthesised `values()` / `valueOf()` listed as callables "at L3", and a field named like its fluent accessor handed to
`impact` without its kind. What the hook cannot vouch for is what the graph cannot: an edge the engine did not resolve is
absent, never wrong, and the `? n` count says how many.

## test-impact — which tests this edit reaches

`axiomcode test-impact` takes the edit (the working tree by default, `--range a..b` or `--staged`), maps it onto the
declarations through `changed`, asks `impact` which tests reach any of them, and prints the test files with the
runner command that runs exactly those. It is `changed` + `impact --tests` with the answer shaped for a pipeline
rather than for a reader.

**What it costs and what it saves, measured end to end** on a TypeScript library of 311 source files whose suite is
130 files and 5,193 tests: a one-line body edit to one function → the answer in **0.74 s**, naming 8 files / 503
tests, and running exactly those took **2.2 s against 17.3 s for the whole suite — 7.9× faster**. Against the
behavioural truth for that method (break it, run the suite, record which files newly fail) the selection contained
**every failing file**, with 2 extra. Over 16 such methods: recall 0.778, precision 0.636, mean 4.1 files of 130.

**It is a lower bound and the wording says so, because the two questions want opposite things.** For "what must be
looked at again", recall is the product and a wide answer is safe. For "what can CI skip", precision is the product
and a wide answer is worthless — and the same answer cannot be tuned for both: on a Python web framework the
registration-key hop takes recall 0.564 → 0.727 and precision 0.527 → 0.310 at the same time. So the rungs are
reported separately and `--json` carries `certainty` per test, and a pipeline can price them: on the TypeScript
library a `[sound]` route (every hop a single resolved target) was right **29 times in 30**, `[one of a set]` 1 in 8,
`[by name]` 0 in 1; a `[fixture]` route is right 30 times in 30 on a service where a fixture is the only way in and
about 1 in 4 on a framework where every test builds an app. Run the sound rung first, and decide about the rest with
the number in front of you. Skipping what it does not name is a decision about risk that this tool cannot make for
you: a test reached only through reflection, a service loader, or a case built at runtime does not appear here.

## path — asking the graph

- **Start here when you do not have a name yet.** A bare word — one that names nothing exactly, with `'*'` at the
  other end — is every declaration CONTAINING it, listed with the count so a wide word is visibly wide, so
  `path decrypt '*'` answers "where is the decryption code and what does it touch" — 12 declarations, what they
  reach, by hop and by file — without knowing a single exact name first. `path '*' <word>` is the same in reverse.
  This is the way into an unfamiliar repository: get the real names out of the answer, then ask the precise
  question with one of them. There is no separate search verb, and none is needed — a name you half remember stops
  with the exact names that are close, which is the same lookup.
- **Endpoints are names as written in the code**, never guesses: `Owner.method`, `Outer.Inner.method`, `method` (a free
  function, or that name under any owner), `Type` (every method it declares), `file.ts:123` (the callable at that
  line, top-level code included), `file.py` (every method in the file). `Outer$Inner.m`, `Outer.Inner#m`, `m(int,String)`
  and package-qualified `pkg.Outer.Inner.m` are the same name; a Java nested type is found whether or not the outer is
  written (the parser drops it, #667). A name that does not exist stops with the exact names that are close — use one
  of those, or a `file:line` from the issue or a stack trace. Built and self-tested for Java, TypeScript and Python;
  JavaScript works but the engine's JavaScript output is still moving.
- **By default the answer is ONE SHORTEST chain per reached target** — it says so on its last line. Other routes exist
  and are not listed. `--every` adds all of them: first the complete set of methods and calls that lie on *any* chain
  from a source to a target (from Datalog, polynomial — `301 methods and 935 calls` for `Jsoup.parse → Tokeniser.emit`),
  by file, then the simple paths through it, shortest first, up to `--paths N` (default 20; the count is exponential,
  so the set is the complete answer and the list is a sample of it). Each hop is marked: unmarked = a resolved call, `[multi_inferred]` =
  one of a sound target set, `[dispatch]` = an instantiated override reached through its base, `[defines]` = a closure
  under the callable that defines it. The `verified:` line means every hop was looked up again in graph.sqlite and a
  plain BFS found the same length; a `✗` means the answer is wrong — report it, do not use it.
- **No chain is an answer with a bound.** "no chain of resolved calls" is followed by whether unresolved sites *would*
  connect the two by name, and at which `file:line` — that is the site to read, not a path to claim. The `bound:` line
  counts unresolved calls on the chain shown: other chains may exist that the graph cannot see.
- **A call into a library is an endpoint too — with or without `--library`.** `path '*' 'new ArrayList'`,
  `path '*' Files.readAllBytes`, `path '*' readAllBytes`, `path '*' 'Collections.*'`, `path '*' open`: the name as the parser
  wrote it at the call site (kind `new` or method, and the receiver written before it), matched at every unresolved site,
  in any language. With `--library` staged the same call is a resolved library method and matches by qualified name. A
  client declaration always wins over both. The node has in-edges only — nothing is inferred about the library body — and
  the answer says how many sites were matched and where.
- **A type the code uses but does not declare is an endpoint**: `path Foo.run File` — every place `File` is touched,
  as one target: `new File` at unresolved sites, the library methods of `java.io.File` when staged,
  and the methods whose body references the name where the parser gives a line. The answer says which of those it
  matched (Java type references carry no line, so there it is the constructor calls and identifier uses).
- **A decoration is an endpoint**: `path '@GetMapping' 'new File'`, `path '@*Mapping' Files.readAllBytes`, `path '@Test' X`,
  `path '@Get' '*'`, `path '@Controller' Svc.load` — every method carrying it, so "from any method with this decoration to X"
  is one call. A decoration on the **type** is carried by every method that type declares, which is what the class-level form
  of every framework needs (`@RestController`, `@Controller`, `@Injectable`, `@Component`, `@Entity`); on Spring Cloud Config
  Server that is 78 methods for `@*Mapping` where the method-level rows alone are 29. The decorations come from the index's
  decorations table **or, where a front end records a decorator as a call and not as a decoration, from those call sites** —
  a TypeScript or JavaScript graph has an empty decorations table and its `@Get(':sku')` sitting in `call_sites` as a
  `DECORATOR_CALL`, so Nest, Angular and TypeORM used to answer `no method carries @Get` with an empty list of decorations,
  which reads as "this repository has no such handler". The owner is the narrowest declaration whose span holds the decorator
  line, so `@Get` lands on the method and `@Controller`, which the call site charges to the module, lands on the class.
  A graph that records no decoration at all now says so, instead of printing an empty list.
- **End to end, any shape:** `path Type1 method4` asks whether *any* method of Type1 reaches *any* declaration named
  method4 — a type on either end is all its methods, a bare name is every declaration under any owner (a free function
  in Python/TS/JS has its file as owner). The same rule in every language; nothing is forced to be typed.
- **A name under many owners** (`close`, `run`, `toString`): the closure is computed once from the sources, so a
  thousand targets cost nothing; the answer is which owners' declarations are reached and how far, nearest first,
  then the nearest chains. Narrow with `Owner.close`, `--in <path fragment>` (both endpoints restricted to files
  containing it), `--limit N`, or `--all` for every chain.
- `Outer$Inner.m` and `Outer$1.m` are looked up through the nesting table, not by string: Inner at any depth inside
  Outer; `$N` the N-th anonymous class in source order (javac's numbering — checked against `javap` on jsoup's
  TraversorTest, 10/10) or, for an enum, the N-th constant with a body. A miss says which part is wrong: no such
  outer / no nested type X (lists them) / only k anonymous classes (with lines) / no method m (lists the methods).
- **One endpoint = a closure, not a chain.** `path '*' X` is everything that can reach X — by hop, by file, and the
  *entry points* among them, nearest first. An entry point is decided by one language-neutral fact — nothing resolved
  calls it (the caller is outside the graph: a framework, a runner, reflection) or it is a test; a decoration on it is
  shown as information, never used to decide. `path X '*'` is everything X reaches, and the library calls X makes itself
  (the platform methods where the client graph ends), listed but never traversed. `--in src/main` keeps only the part
  under that path; `--depth N` bounds the hops. Each closure is cross-checked against a plain BFS (the `verified:` line)
  and bounded by the unresolved calls inside it.
- **An empty answer names the framework that owns it.** `path '*' <handler>` for a live route used to print "0
  method(s)", which is true of calls and false of the program. When the upstream closure is empty the registration is
  named instead — *create_order is registered as a route "/orders" by @post (app/api.py:43)* — and when two endpoints
  have no chain, a key that connects them is reported with the line that writes it, including the two spellings of one
  path (`/orders/o-1/price` written against `/orders/{order_id}/price` registered). It is reported, never walked: a
  chain here means control reaches B from A *through these calls*, and a registration is not a call. `impact` is the
  verb that follows the hop, and the answer says so rather than ending at a dead end. The conventions come from the
  one module both tools read (`scripts/ax_registration.py`).
- **What it cannot find, by construction** — say so instead of guessing: a call whose receiver the engine could not type
  (DI-injected, unbound generic, a parameter in a dynamic language) stops the chain and is counted in `bound:`; callbacks
  handed to a library (`executor.submit(task)`, `list.forEach(fn)`) are reached from their definer (`[defines]`) but never
  from the library that invokes them; calls the framework makes (HTTP dispatch, JUnit, `main`) have no edge — the callee
  is an entry point; reflection / string dispatch / event buses / config-wired beans are invisible; overloads sharing a
  name are all resolved together (a signature in the query is stripped); a method overriding a library method is called
  by the library, so its upstream ends there; code outside `--src` or in another language is not in the graph; a
  by-name or written match can be a same-named other thing. A chain says control can reach B from A through these
  calls — nothing about the values that travel it.
- Both directions are tried; the reverse is labelled.
- `axiomcode path --selftest <lang>` replays the engine's own expected edges through the tool and separates engine gaps
  from tool losses; run it after touching `dl/path.dl` or the exporter. Needs `souffle` on PATH.

`scripts/` holds `axiomcode` (the entry) and what it dispatches to: `axiomcode-build` (the pipeline), `axiomcode-index`, `axiomcode-graph`, `viewer.html`, `axiomcode-path` with `dl/path.dl`, `axiomcode-impact` with `dl/impact.dl` (the path tool's resolver and edge facts, its own rules and fact export), `axiomcode-changed` (an edit → the declarations it touched, with the kind of change).
