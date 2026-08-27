# categories/ — Python fixtures, organised like `src/test-data/java`

One directory per entity kind, so a failure names the *area* before it names the
fact. Twelve categories, each a single self-contained file:

| category | what it pins down |
|---|---|
| `types` | class forms: plain, derived, multiple bases, slots, enum, metaclass, nested |
| `methods` | every `methodKind`: static, class, property, setter, cached, abstract, generator, async, async-generator, and all five parameter kinds |
| `fields` | every `fieldOrigin`: class body, annotation-only, slots, self-assign, augassign, dataclass, NamedTuple, TypedDict |
| `expressions` | every literal type, collection, operator, subscript, slice, f-string, star, walrus, and the four assignment forms |
| `imports` | plain, dotted, aliased, from, from-aliased, relative, deep-relative, conditional |
| `scopes` | closure, `nonlocal`, `global`, four comprehension scopes, two lambdas **on one line**, class scope, nested function reaching `self` |
| `decorators` | bare, called, dotted, stacked, PEP 614 subscript, keyword arguments, decorated class |
| `type-references` | annotation, string forward-ref, alias, `isinstance`, `cast`, except tuple, generic parameters |
| `comprehensions` | list/set/dict/generator, nested, conditional, in a default, in a class body |
| `blocks` | if/elif/else, for-else, while-else, try/except/else/finally, nested `with`, `match` with class, sequence, mapping and guard patterns |
| `comments` | shebang, coding cookie, docstrings at four levels, `# type:`, `# noqa`, `# pragma`, comment runs |
| `integration` | a layered service: dataclass, store, repository, service, and a builder |

## The admission rule

Every file is **100% reachable**: each call site links to a declared entity or is
a builtin. `golden-gate.ts --select` enforces this by measurement, and a file that
fails is not admitted. That is what makes the corpus a tripwire — a later
unresolved call is a regression, never an argument about analysis scope.

Several files carry a comment explaining a construct deliberately *not* invoked —
`functools.lru_cache`, `super().__init_subclass__`, a two-hop attribute chain. Each
would add a site the parser legitimately cannot resolve today, and would cost the
file its place here without testing anything more about the construct under study.
The construct is still present; only the unresolvable call is gone.

## What you may and may not edit

Add source freely. **Never hand-write an expected fact.** Expectations live in
`../verified/_golden/`, are generated from parser output, and are re-verified
against CPython by `--bless` before being frozen.
