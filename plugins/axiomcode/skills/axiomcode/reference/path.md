# path — the endpoint grammar and what it cannot find


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
  of those, or a `file:line` from the issue or a stack trace. Built and self-tested for Java, TypeScript, Python
  and C#; JavaScript works but the engine's JavaScript output is still moving.
- **By default the answer is ONE SHORTEST chain per reached target** — it says so on its last line. Other routes exist
  and are not listed. `--every` adds all of them: first the complete set of methods and calls that lie on *any* chain
  from a source to a target (from Datalog, polynomial — `301 methods and 935 calls` for `Parser.parse → Lexer.emit`),
  by file, then the simple paths through it, shortest first, up to `--paths N` (default 20; the count is exponential,
  so the set is the complete answer and the list is a sample of it). The `verified:` line means every hop was looked up
  again in graph.sqlite and a plain BFS found the same length; a `✗` means the answer is wrong — report it, do not use it.
- **Every hop reads `[tier · kind @ file:line]`.** The *tier* is how certain the edge is; the *kind* is what sort of
  call it is, in one vocabulary that means the same thing in all five languages (`call` · `new` · `ctor` · `super` ·
  `decorator` · `property` · `method-ref` · `with` · `import` · `eval` · `dynamic`); and the *line* is where the call
  is WRITTEN, which is where you check it — the name after the arrow already tells you the callee, and its own
  declaration line follows it. The tiers an answer used are legended beneath it, so none of them has to be looked up:
  `known_edge` resolved to one declaration, `multi_inferred` several fit and each is real, `dispatch` a base method to
  an override the project instantiates, `callback_registered` handed over as a value and invoked by whoever holds it,
  `boundary_lib` / `ambient_terminal` into a dependency or the platform, `defines` **not a call at all** — the callee
  is written inside that body, so it runs only after it. The engine emits eleven tiers and thirty kinds across the
  five languages and they do not share a vocabulary; `scripts/ax_edges.py` is the single table that normalises them,
  and an unrecognised tier ranks LAST there rather than being silently treated as certain.
- **The hop count counts calls.** A chain's header says `7 call(s)` — containment hops (`defines`) are listed
  separately (`+2 containment hop(s)`) and excluded, because "A reaches B in 11 calls" is false when five of the
  eleven are a closure sitting inside a body.
- **`--json`** gives the same answer as one document — every hop with its tier, kind, call site, callee declaration
  and whether it is a call — with the prose carried alongside it, so nothing is lost by asking for the machine shape.
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
  of every framework needs (`@RestController`, `@Controller`, `@Injectable`, `@Component`, `@Entity`); on one Spring service that is 78 methods for `@*Mapping` where the method-level rows alone are 29. The decorations come from the index's
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
  Outer; `$N` the N-th anonymous class in source order (javac's numbering — checked against `javap` on a JVM parser's traversal tests, 10/10) or, for an enum, the N-th constant with a body. A miss says which part is wrong: no such
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
