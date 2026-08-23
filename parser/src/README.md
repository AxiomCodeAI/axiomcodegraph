# Source Layout

This document describes how the parser is organised, what each layer is responsible for, and how
to add a language. It is language neutral. For what the IR is and why, see the
[root README](../README.md). For how well it works, see [docs/IR-QUALITY.md](../docs/IR-QUALITY.md).

## Layers

The pipeline is the same for every language. Only the parsing layer is language specific.

```
detection  ->  parsing  ->  extraction  ->  models  ->  resolution  ->  export
```

| Layer | Directory | Responsibility |
|---|---|---|
| Detection | `language-detectors/` | Identify which languages and build systems a project uses. |
| Parsing | `parsers/<lang>/` | Produce a syntax tree. tree-sitter for Java, Python and Gradle; sax for XML; the `yaml` package for YAML; a hand written scanner for Properties. |
| Extraction | `parsers/<lang>/extractors/` | Walk the tree and emit rows. One extractor per relation family. |
| Models | `analysis-types/<lang>/` | One class per relation. Builder pattern, content addressed primary key, CSV serialisation. |
| Resolution | `parsers/<lang>/*-resolution-linker.ts` | Fill in cross entity foreign keys, first within a file and then across the project. |
| Export | `workflows/<lang>/` | Orchestrate discovery, run extractors, stream rows to disk. |

## Directory map

```
src/
  extract.ts               Public API. extractProject() is the single entry point.
  index.ts                 Positional subprocess entry, kept for the orchestrator contract.

  analysis-types/          Relation models, one directory per language.
    java/                    17 relations
    python/                  19 relations
    xml/ yaml/ properties/ gradle/

  parsers/                 Syntax trees and extraction.
    java/extractors/         15 extractors
    python/extractors/       14 extractors
    xml/ yaml/ properties/ gradle/

  enums/                   Categorical column values, one namespace per language.
  constants/               CSV file names, entity identifier prefixes.
  interfaces/              BaseExtractor and shared contracts.
  language-detectors/      Project and build system detection.
  schema/python/           Frozen Python relation schema, generated Datalog declarations.
  test/                    Extractor suites, gates, oracles, corpora.
  types/                   Shared type definitions.
  utils/                   Hashing, position mapping, project scanning, tree-sitter helpers.
  workflows/               Per language orchestration.
```

## Two rules that the code depends on

These are not stylistic preferences. Both were learned from defects that were silent at small
scale and wrong at large scale.

**Never store state on a tree-sitter node.** The node wrapper cache in `node-tree-sitter` evicts
entries, so a property assigned during one traversal is gone by the next, and `.parent` walks
return objects that were never tagged. Code that does this works on small files and fails on large
ones without any error. Side tables keyed on `node.id` are the supported way to carry per node
state.

**Node identity is the byte range, not the start offset.** `startIndex` alone collides for nested
calls such as `super().f()` and for repeated targets in a single statement. Cross stage joins use
`startIndex:endIndex`.

## Identity and linking

Every relation has a primary key generated from the entity's own identifying content, so the key
is stable across runs and can be computed by any stage that knows the entity.

Child keys chain off the parent key rather than being re derived from a qualified name. Re deriving
collides whenever two entities share a name, which in practice happens constantly: two classes with
a `run` method, two comprehensions on one line, two parameters called `value`.

Resolution runs in two passes. The single file pass links what is visible in one file. The project
pass runs once every file has been parsed and links the rest, retrying anything that has no key yet
rather than only rows explicitly marked unresolved. The distinction matters: a single file pass can
only conclude that a cross module call is external, and treating that as final would lock in the
weaker answer from the less informed pass.

## Adding a language

1. Add a parser under `parsers/<lang>/` that returns a syntax tree, along with any dialect
   detection the language needs.
2. Define relation models in `analysis-types/<lang>/`. Each needs a builder, a content addressed
   key, and a CSV header and row.
3. Add enums under `enums/<lang>/` for every categorical column. A string column that could be an
   enum will drift.
4. Write extractors in `parsers/<lang>/extractors/`, one per relation family, implementing
   `BaseExtractor`.
5. Add a resolution linker if the language has cross file references.
6. Register the workflow in `workflows/` and the file names in `constants/`.
7. Add an oracle. This is not optional in practice. Every column placed under an external oracle in
   this codebase has found at least one defect, and columns without one have shipped wrong.

## Testing

```bash
npx tsx src/test/java-extractor-tests.ts     # Java extractor suite
npx tsx src/test/python-extractor-tests.ts   # Python extractor suite
npm test                                      # vitest
```

The extractor suites are not `npm test`. They run three validation layers: per fixture expected
values, column arity against the frozen schema, and referential integrity across every foreign key
in the emitted set.

Beyond the suites, `src/test/python-gates/` holds differential gates that compare emitted rows
against CPython itself. These are the instruments that find real defects, and they are committed
rather than run ad hoc, because a measurement nobody can reproduce is not a measurement.
