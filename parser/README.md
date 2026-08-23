<div align="center">

# AxiomCode Parser

**A multi-language static analysis front end that compiles source code into a relational intermediate representation.**

<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/java/java-original.svg" width="44" height="44" alt="Java" title="Java"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/python/python-original.svg" width="44" height="44" alt="Python" title="Python"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/xml/xml-original.svg" width="44" height="44" alt="XML" title="XML"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/yaml/yaml-original.svg" width="44" height="44" alt="YAML" title="YAML"/>
&nbsp;&nbsp;
<img src="https://cdn.jsdelivr.net/gh/devicons/devicon@latest/icons/gradle/gradle-original.svg" width="44" height="44" alt="Gradle" title="Gradle"/>

[Intermediate Representation](#the-intermediate-representation) &nbsp;|&nbsp;
[Languages](#language-support) &nbsp;|&nbsp;
[Quality](docs/IR-QUALITY.md) &nbsp;|&nbsp;
[Architecture](src/README.md) &nbsp;|&nbsp;
[Usage](#usage)

</div>

---

## What this is

The parser reads a source tree and emits a set of tab separated relations. Every entity gets a
content addressed primary key, and every relationship between entities is a foreign key between
those relations. The result is a normalised, queryable model of a program that can be loaded into
a database, a Datalog engine, or a graph store without further transformation.

It is a front end only. It resolves what can be decided from source text and declared types, and
it stops there. Whole program reasoning such as call chain traversal, data flow, and points to
analysis belongs to the downstream engine, which consumes these relations. The contract between
the two is that a link the parser emits is correct, and a link it cannot decide is absent rather
than guessed.

There is no standalone CLI. The parser is consumed as a library through `extractProject()` or as a
subprocess through `dist/index.js`.

## The intermediate representation

The IR is relational rather than tree shaped. A conventional AST answers "what is the syntax here".
This IR answers "what entity is this, and what other entity does it refer to".

Three properties make it useful downstream.

**Content addressed identity.** Each row carries a primary key derived from the entity's own
identifying content, so the same declaration produces the same key across runs and across files
that reference it. Cross file links are ordinary joins rather than a name resolution pass.

**Explicit reference edges.** A method call is not merely text. It is a row in the call site
relation carrying a resolved callee key when the target can be determined, plus the receiver
shape, the argument count, and the enclosing scope. The same applies to type references, field
accesses, inheritance edges, and imports.

**Absence is meaningful.** An unresolved link is empty, never approximate. A downstream query can
therefore distinguish "this call reaches a known target", "this call reaches something outside the
analysed corpus", and "this call cannot be resolved statically". Those three cases require
different handling and collapsing them destroys information.

Every row also carries a `serviceVersionLinkHash`, so several snapshots of a codebase can occupy
the same tables and be compared.

## Language support

| Language | Maturity | Relations | Parser | What is extracted |
|---|---|---|---|---|
| **Java** | Stable | 17 | tree-sitter-java | Types, methods, fields, annotations and their arguments, expressions, imports, local variables, blocks, comments, enum constants, generics and type parameters. Covers classes, interfaces, enums, records, and nested types. |
| **Python** | Stable | 19 | tree-sitter-python | Modules, scopes, bindings, types, base classes, methods, parameters, imports, expressions, call sites, type references, fields, decorators and their arguments, blocks, comments, parse gaps, PEP 695 type parameters. |
| **XML** | Stable | 3 | sax | Element hierarchy with XPath and namespaces, attributes, and value references including property placeholders and SpEL. |
| **Properties** | Stable | 2 | custom | Keys and typed value segments, with continuation and comment handling. |
| **YAML** | Beta | 2 | yaml | Configuration entries with anchor and alias tracking, multi document support. |
| **Gradle** | Alpha | 3 | tree-sitter-groovy | Blocks, declarations, and value references, oriented toward dependency and version extraction. |

Java and Python are the two languages with full semantic resolution. The configuration formats are
extracted structurally so that configuration values can be correlated with code that reads them.

### Java and Python are modelled differently on purpose

The two languages do not share a relation set, because a shared one would have to be the
intersection of what each language means, and that intersection loses the parts a reasoning engine
needs most.

Java has static types, so a receiver's type is usually written down. Python does not, so the
Python IR carries the scope and binding structure that Java does not need: a `py_scope` forest
that mirrors CPython's own symbol tables, `py_binding` rows recording how each name resolves,
and reaching assignment edges through the expression tree so a downstream pass can type a receiver
that was never annotated.

Conversely Java carries overload signatures and annotation arguments in a form Python has no use
for, since Python has no overloading.

## Quality

The parser is measured against oracles built independently of it, not against fixtures written
alongside it. For Python the oracles are CPython itself: `symtable` for the scope and binding
structure, `ast` for decorators and blocks, the compiled bytecode for call site discovery, and
`sys.settrace` for whether a resolved call target is the function the interpreter actually enters.
For Java the oracle is JVM bytecode.

Current figures are not published here because they change with every commit and a stale number is
worse than none. The gates print their results, including what they could not verify, and
[docs/IR-QUALITY.md](docs/IR-QUALITY.md) documents the methodology and how to run them.

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

Both paths call the same core in `src/extract.ts`.

## Output

Tab separated files, one per relation, written to the output directory. Java relations are named
`all-*.csv`, Python relations `all-python-*.csv`, and the configuration formats are prefixed by
format. `skipped-files.csv` and `skipped-python-files.csv` record every file that was not analysed
and why, so a consumer can distinguish an empty result from an unanalysed one.

## Development

```bash
npm run build        # tsc && tsc-alias, emits dist/
npm run typecheck    # tsc --noEmit
npm test             # vitest

npx tsx src/test/java-extractor-tests.ts     # Java extractor suite
npx tsx src/test/python-extractor-tests.ts   # Python extractor suite
```

## Further reading

- [src/README.md](src/README.md) for the source layout and how to add a language
- [docs/IR-QUALITY.md](docs/IR-QUALITY.md) for measurement methodology and results
- [src/schema/python/PYTHON-FACT-SCHEMA.md](src/schema/python/PYTHON-FACT-SCHEMA.md) for the frozen Python relation schema
