<div align="center">

# AxiomCode Parser

**A multi-language static analysis front end that compiles source code into a relational intermediate representation.**

<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg" width="46" height="46" alt="Python" title="Python"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg" width="46" height="46" alt="Java" title="Java"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/xml/xml-original.svg" width="34" height="34" alt="XML" title="XML"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/yaml/yaml-original.svg" width="34" height="34" alt="YAML" title="YAML"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/gradle/gradle-original.svg" width="34" height="34" alt="Gradle" title="Gradle"/>

<sub>Full semantic resolution for <b>Python</b> and <b>Java</b>. Build-graph and dependency resolution for <b>Gradle</b>. Structural extraction for XML, YAML and Properties.</sub>

[What it is](#what-this-is) &nbsp;|&nbsp;
[The IR](#the-intermediate-representation) &nbsp;|&nbsp;
[Languages](#language-support) &nbsp;|&nbsp;
[Architecture](#architecture) &nbsp;|&nbsp;
[Validation](#validation) &nbsp;|&nbsp;
[Usage](#usage)

</div>

---

## What this is

The parser reads a source tree and emits a set of tab separated relations. Every entity gets a
content addressed primary key, and every relationship between entities is a foreign key between
those relations. The result is a normalised, queryable model of a program that can be loaded into a
database, a Datalog engine, or a graph store without further transformation.

It is a front end only. It resolves what can be decided from source text and declared types, and it
stops there. Whole program reasoning such as call chain traversal, data flow, and points to analysis
belongs to the downstream engine that consumes these relations. The contract between the two is that
a link the parser emits is correct, and a link it cannot decide is absent rather than guessed.

There is no standalone CLI. It is consumed as a library through `extractProject()` or as a
subprocess through `dist/index.js`.

## The intermediate representation

The IR is relational rather than tree shaped. A conventional AST answers "what is the syntax here".
This IR answers "what entity is this, and what other entity does it refer to".

Three properties make it useful downstream.

**Content addressed identity.** Each row carries a primary key derived from the entity's own
identifying content, so the same declaration produces the same key across runs and across files that
reference it. Cross file links are ordinary joins rather than a name resolution pass. Child keys
chain off the parent key rather than being re derived from a qualified name, because re deriving
collides whenever two entities share a name, which happens constantly: two classes with a `run`
method, two comprehensions on one line, two parameters called `value`.

**Explicit reference edges.** A method call is not merely text. It is a row in the call site relation
carrying a resolved callee key when the target can be determined, plus the receiver shape, the
argument count, and the enclosing scope. The same applies to type references, field accesses,
inheritance edges, and imports.

**Absence is meaningful.** An unresolved link is empty, never approximate. A downstream query can
therefore distinguish "this call reaches a known target", "this call reaches something outside the
analysed corpus", and "this call cannot be resolved statically". Those three cases require different
handling, and collapsing them destroys information.

Every row also carries a `serviceVersionLinkHash`, so several snapshots of a codebase can occupy the
same tables and be compared.

## Language support

| Language | Maturity | Relations | Parser | What is extracted |
|---|---|---|---|---|
| **Python** | Stable | 19 | tree-sitter-python | Modules, scopes, bindings, types, base classes, methods, parameters, imports, expressions, call sites, type references, fields, decorators and their arguments, blocks, comments, parse gaps, PEP 695 type parameters. |
| **Java** | Stable | 17 | tree-sitter-java | Types, methods, fields, annotations and their arguments, expressions, imports, local variables, blocks, comments, enum constants, generics and type parameters. Covers classes, interfaces, enums, records, and nested types. |
| **XML** | Stable | 3 | sax | Element hierarchy with XPath and namespaces, attributes, and value references including property placeholders and SpEL. |
| **Properties** | Stable | 2 | custom | Keys and typed value segments, with continuation and comment handling. |
| **YAML** | Beta | 2 | yaml | Configuration entries with anchor and alias tracking, multi document support. |
| **Gradle** | Beta | 8 | tree-sitter-groovy | Scripts and their role in the build, blocks, declarations, dependency coordinates split into group/artifact/version, version catalogs, value references with resolution, comments, and parse gaps. Groovy and Kotlin DSL. |

Python and Java are the two languages with full semantic resolution. The configuration formats are
extracted structurally so that configuration values can be correlated with the code that reads them.

Gradle sits between the two. There is no type system to consult, so it is not semantically resolved
in the sense Java is, but it is more than structural: the settings file's project graph, `apply
from:` edges, `project(':core')` dependencies and version catalog accessors are all resolved to the
scripts and entries they name. "Which project declares this dependency, at which version, and where
did that version come from" is a join rather than a text search.

### Gradle is parsed by a grammar that is not its own

This is the one front end where the grammar does not match the language. `tree-sitter-groovy` parses
Groovy; it is handed Kotlin DSL as well, plus Groovy constructs it has no rule for. An `ERROR` node
in this grammar swallows the rest of the enclosing block, so a single unparseable operator can delete
every dependency below it with no signal at all.

The extractor therefore rewrites the source before parsing, under two rules. Every rewrite preserves
line count, so a position reported against the rewritten text is a real line in the original file.
And every rewrite that deletes information emits a row in the parse gap relation, against the
original offsets. That second rule is what keeps "this block declares no dependency" from reading
identically to "this block was rewritten and never parsed" — both produce zero rows, and only one of
them is true. See [CONTRIBUTING-gradle.md](CONTRIBUTING-gradle.md).

### Python and Java are modelled differently on purpose

The two do not share a relation set, because a shared one would be the intersection of what each
language means, and that intersection loses the parts a reasoning engine needs most.

Java has static types, so a receiver's type is usually written down. Python does not, so the Python
IR carries scope and binding structure that Java has no need for: a scope forest mirroring CPython's
own symbol tables, binding rows recording how each name resolves, and reaching assignment edges
through the expression tree so a downstream pass can type a receiver that was never annotated.

Conversely Java carries overload signatures and annotation arguments in a form Python has no use
for, since Python has no overloading.

## Architecture

The pipeline is the same for every language. Only the parsing layer is language specific.

```
detection  ->  parsing  ->  extraction  ->  models  ->  resolution  ->  export
```

| Layer | Directory | Responsibility |
|---|---|---|
| Detection | `language-detectors/` | Identify which languages and build systems a project uses. |
| Parsing | `parsers/<lang>/` | Produce a syntax tree. tree-sitter for Java, Python and Gradle; sax for XML; the `yaml` package for YAML; a hand written scanner for Properties. |
| Extraction | `parsers/<lang>/extractors/` | Walk the tree and emit rows. One extractor per relation family, implementing `BaseExtractor`. |
| Models | `analysis-types/<lang>/` | One class per relation. Builder pattern, content addressed key, CSV serialisation. |
| Resolution | `parsers/<lang>/*-resolution-linker.ts` | Fill in cross entity foreign keys, first within a file and then across the project. |
| Export | `workflows/<lang>/` | Orchestrate discovery, run extractors, stream rows to disk. |

```
src/
  extract.ts               Public API. extractProject() is the single entry point.
  index.ts                 Positional subprocess entry, for the orchestrator contract.
  analysis-types/          Relation models, one directory per language.
  parsers/                 Syntax trees and extraction, one directory per language.
  enums/                   Categorical column values, one namespace per language.
  constants/               CSV file names, entity identifier prefixes.
  interfaces/              BaseExtractor and shared contracts.
  language-detectors/      Project and build system detection.
  schema/python/           Frozen Python relation schema and generated Datalog declarations.
  test/                    Extractor suites, differential gates, corpora.
  test-data/               Committed fixtures, per language.
  types/                   Cross language types only. Language specific types live beside their parser.
  utils/                   Hashing, position mapping, project scanning, tree-sitter helpers.
  workflows/               Per language orchestration.
```

Resolution runs in two passes. The single file pass links what is visible in one file. The project
pass runs once every file has been parsed and links the rest, retrying anything that has no key yet
rather than only rows explicitly marked unresolved. A single file pass can only conclude that a cross
module call is external, and treating that as final would lock in the weaker answer from the less
informed pass.

### Two rules the code depends on

Both were learned from defects that were silent at small scale and wrong at large scale.

**Never store state on a tree-sitter node.** The node wrapper cache in `node-tree-sitter` evicts
entries, so a property assigned during one traversal is gone by the next, and parent walks return
objects that were never tagged. Code that does this works on small files and fails on large ones
with no error. Use side tables keyed on `node.id`.

**Node identity is the byte range, not the start offset.** A start index alone collides for nested
calls such as `super().f()` and for repeated targets in a single statement. Cross stage joins use
`startIndex:endIndex`.

### Adding a language

1. Add a parser under `parsers/<lang>/` returning a syntax tree, plus any dialect detection needed.
2. Define relation models in `analysis-types/<lang>/`, each with a builder, a content addressed key,
   and a CSV header and row.
3. Add enums under `enums/<lang>/` for every categorical column. A string column that could be an
   enum will drift.
4. Write extractors in `parsers/<lang>/extractors/`, one per relation family.
5. Add a resolution linker if the language has cross file references.
6. Register the workflow in `workflows/` and the file names in `constants/`.
7. Add an external oracle. Not optional in practice: every column placed under one here has found at
   least one defect, and columns without one have shipped wrong.

## Validation

The parser is not permitted to grade itself. A fixture written alongside a parser encodes the
author's belief about what the parser should do. It catches regressions, but not a wrong premise,
because the fixture and the code share that premise. A fixture in this repository once asserted that
a class reference must remain unresolved, with a comment explaining why. An independent tool resolved
it. The comment was wrong, the fixture had frozen the error, and the suite had been green for weeks.

Every gate therefore uses something not written for this purpose.

| Oracle | What it decides | Why it is authoritative |
|---|---|---|
| CPython `symtable` | Scope tree, every binding, ten predicates per binding | It is the structure the interpreter consults. A disagreement is a defect, not a modelling preference. |
| CPython `ast` | Decorators, blocks, expression structure | States presence, order and arguments outright rather than inferring them. |
| CPython bytecode | Every call the compiler emitted, and how each name resolves | The compiler has already decided whether a name is local, global, a cell, or an attribute, and records it in the opcode. |
| CPython `sys.settrace` | Which function a call actually reaches | Ground truth for target correctness, not merely call discovery. |
| JVM bytecode | Java call edges | The same role for the Java front end. |
| Gradle `projects` | The build's project graph | Gradle is the implementation that decides which projects a settings file creates. On its first real run it found a directory this parser was reporting as a project and Gradle was not. |

Call graph quality is measured at three increasing strictnesses, because each answers a question the
previous cannot. **Discovery** asks whether a call site was found at all, against the compiled
bytecode, which lists every call whether or not the branch runs. **Target correctness** asks whether
the emitted target is the function the interpreter actually enters, measured by running a closed
world corpus under tracing. **Substrate sufficiency** rebuilds C3 linearisation, override edges,
class hierarchy analysis, rapid type analysis, and argument to parameter binding from the emitted
relations alone, with no parser objects in scope.

Coverage separates unresolved references into two kinds, because conflating them measures the wrong
thing. **Resolvable** means the name matches an entity the run emitted, and is the parser's gap.
**External** means nothing by that name exists in the corpus, and is excluded. A raw resolved over
total ratio tracks how many dependencies a project has rather than how good the parser is.

No scores are published here. They change with every commit, and a number copied into a document is
stale the moment it is written. Each gate prints its own results, including what it could not verify.
A gate that reports only successes is not reporting.

### Known limits

These are properties of the language, not defects.

**Duck typing.** A receiver whose type is written nowhere cannot be typed. Emitting a guess would
produce a false edge, which is worse than no edge: a data flow query that follows it gets a confident
wrong answer.

**Mixin dispatch.** When a class calls an attribute supplied by a sibling base under multiple
inheritance, the attribute genuinely does not exist on that class or its ancestors. It exists only
once a subclass combines them, and several combinations may supply different types.

**Chains beyond one hop.** Each individual hop is linked. Composing them is a reaching definition
join, which belongs to the engine.

**Gradle versions held outside the build scripts.** A build may keep its versions in a properties
file and read them as `versions.netty`. Those keys land in the Properties relations, and nothing
joins the two relation sets, so such references stay unresolved. This is the Gradle front end's
largest coverage gap, and it is real rather than a measurement artefact: the reference is resolvable,
just not from Gradle files alone.

**Grammar level hazards.** tree-sitter-python applies the PEP 695 soft `type` keyword greedily, so
`type(obj).attr = value` parses cleanly as a type alias and the call node disappears. That statement
is recovered, and the part that cannot be is recorded in the parse gap relation so its absence is
visible. Python 2 files are rejected explicitly for the same reason: `print "x"` parses cleanly under
this grammar and would otherwise emit confident nonsense.

## Usage

```bash
npm install          # builds via the prepare hook
```

As a library:

```ts
import { extractProject } from '@axiomcode/parser';

await extractProject({
  projectPath: '/path/to/repo',
  versionLink: '<commit-or-tag>',   // stamped onto every row
  excludeTests: false,
  outputDir: '/path/to/analysis-results',
});
```

As a subprocess:

```bash
node dist/index.js <projectsDir> <serviceVersionLink> <excludeTests:true|false> [outputDir]
```

Both call the same core in `src/extract.ts`.

### Output

Tab separated files, one per relation. Java relations are named `all-*.csv`, Python relations
`all-python-*.csv`, Gradle relations `all-gradle-*.csv`, and the other configuration formats are
prefixed by format. `skipped-files.csv` and
`skipped-python-files.csv` record every file that was not analysed and why, so a consumer can
distinguish an empty result from an unanalysed one.

## Development

```bash
npm run build        # tsc && tsc-alias, emits dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest
```

Extractor suites run three validation layers: per fixture expected values, column arity against the
frozen schema, and referential integrity across every foreign key in the emitted set.

```bash
npx tsx src/test/java-extractor-tests.ts
npx tsx src/test/python-extractor-tests.ts
npx tsx src/test/gradle-tests.ts
```

The Gradle suite adds a fourth layer: twenty checks written from the Gradle DSL's documented
semantics rather than from parser output, so they do not move when the parser does.

Differential gates compare emitted rows against the oracles above.

```bash
npx tsx src/test/python-gates/diff-symtable.ts  <corpus>
npx tsx src/test/python-gates/diff-decorator.ts <corpus>
npx tsx src/test/python-gates/diff-block.ts     <corpus>

python3 src/test/python-gates/generate_xpkg.py /tmp/xpkg 60
python3 src/test/python-gates/trace_calls.py   /tmp/xpkg /tmp/xpkg/main.py > /tmp/edges.jsonl
npx tsx src/test/python-gates/diff-runtime-calls.ts /tmp/xpkg /tmp/edges.jsonl

npx tsx src/test/python-gates/cha-rta-substrate.ts <csv-dir>
npx tsx src/test/python-gates/link-coverage.ts     <corpus>

npx tsx src/test/gradle-gates/corpus-invariants.ts <repo> [<repo> …]
npx tsx src/test/gradle-gates/diff-gradle-model.ts <repo>
```

The Gradle corpus gate asserts nothing about what a given build should contain. It checks properties
true of any correct relational output — every foreign key resolves, no two rows share a key, the
block tree terminates, a script reporting a clean parse really produced no gaps — over repositories
nobody wrote for this parser. It found four defects the fixtures did not, including a key collision
that had merged 88 distinct references into single rows.

`diff-gradle-model.ts` is the external oracle. It needs a JVM and a resolvable build, and when it
cannot run it exits non-zero saying NOT VERIFIED rather than reporting a pass.

The frozen Python relation schema is in
[src/schema/python/PYTHON-FACT-SCHEMA.md](src/schema/python/PYTHON-FACT-SCHEMA.md).
