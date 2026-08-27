# Working on the Gradle front end

Read this before changing anything under `src/parsers/gradle`,
`src/analysis-types/gradle`, `src/enums/gradle`, or
`src/workflows/gradle`.

## The one thing that makes Gradle different

Every other language in this repository is parsed by a grammar written for it.
Gradle is not. `tree-sitter-groovy` parses Groovy, and it is asked to handle:

- Kotlin DSL (`.gradle.kts`), which is a different language,
- Groovy constructs it has no rule for — GString interpolation, the Elvis
  operator, empty single-quoted strings, closure parameter lists,
- and non-ASCII bytes, which it does not accept at all.

None of those fail locally. An `ERROR` node in this grammar swallows the rest
of the enclosing block, so one unparseable `?:` on line 12 silently deletes
every dependency below it. That is why `src/parsers/gradle/extractors/
gradle-file-extractor.ts` rewrites the source before parsing.

**Two rules keep the rewriting honest. Do not break either.**

### 1. Every rewrite preserves line count

Use `this.rewrite(...)`, which carries forward the newlines a replacement
consumed. Never call `String.replace` directly on the source.

Positions are reported against the rewritten text. A rewrite that swallows a
newline shifts every row below it by one line — silently, and only on the files
that happen to contain a multi-line construct, which is why it survives a test
suite built from short fixtures.

### 2. Every lossy rewrite emits a parse gap

`this.rewrite(source, pattern, replacer, GradleParseGapReason.X)`. If the
rewrite round-trips — the `__INTERP__` placeholder and the `'_EMPTY_'`
stand-in are both restored afterwards — pass `null`. If it deletes information
nothing recovers, it needs a reason.

This is what separates *"this block declares no dependency"* from *"this block
was rewritten and the parser never saw inside it"*. Both produce zero rows.
Only one of them is true. A consumer cannot tell them apart without the
parse-gap relation, and will assume the first.

## The relation set

Nine relations. `GradleScript` is the root of the key chain; everything else
chains off a script hash.

| Relation | File | What it holds |
|---|---|---|
| `GradleScript` | `all-gradle-scripts.csv` | One row per file. Script kind, dialect, project path, parse status, counts. |
| `GradleBlock` | `all-gradle-blocks.csv` | Every `{ }`. Tree via `parentBlockHash`. |
| `GradleDeclaration` | `all-gradle-declarations.csv` | Dependencies, plugins, repositories, properties, tasks, configurations, excludes, includes. |
| `GradleDependencyCoordinate` | `all-gradle-dependency-coordinates.csv` | A dependency split into group/artifact/version. |
| `GradleCatalogEntry` | `all-gradle-catalog-entries.csv` | `gradle/libs.versions.toml`. |
| `GradleValueReference` | `all-gradle-value-references.csv` | `${x}`, `$x`, `System.getenv`, catalog accessors. |
| `GradleComment` | `all-gradle-comments.csv` | Comments, with a commented-out-code hint. |
| `GradleParseGap` | `all-gradle-parse-gaps.csv` | Regions the rows do not fully represent. |
| skipped files | `skipped-gradle-files.csv` | Files never analysed, and why. |

### Keys chain, and use byte ranges

Both rules from the README's "Two rules the code depends on" are live here, not
theoretical:

- A key derived from a name collides constantly. Every subproject has a
  `dependencies` block; a forty-module build declares `version` forty times.
- A key derived from a start offset collides too. `a.each { b.each { } }` puts
  two closures on one line, and `exclude group: 'a'; exclude group: 'b'` is two
  declarations on one.

So every key mixes in its parent's hash and the full `startLine:startColumn`
to `endLine:endColumn` range. A collision here is not a duplicate row — it is
one row where there were two, and every child of the lost one silently
reparents.

**If you add a relation, run the corpus gate before believing it.** Duplicate
keys in the value-reference relation survived the entire fixture suite and
showed up 88 times in the first real repository.

## Resolution runs in two passes

`gradle-file-extractor.ts` resolves what one file can see. Everything else is
`gradle-resolution-linker.ts`, after every file is parsed.

Do not move a link earlier to "simplify". A single-file pass reading
`include ':core'` can only conclude that `:core` is not in this file, which is
the weaker answer, and writing it down as final locks out the stronger one that
is sitting in the corpus.

### Coverage is split three ways, on purpose

`GradleReferenceResolution` distinguishes:

- **resolved** — matched a declaration or catalog entry.
- **`UNRESOLVED_IN_CORPUS`** — something by that name IS in the analysed files
  and the link was still not made. The parser's gap. This is the number that
  should shrink.
- **`EXTERNAL`** — nothing by that name exists anywhere. `System.getenv('CI')`
  has no declaration to point at and never will.

A raw resolved-over-total ratio measures how many environment variables a build
reads. Do not compute one.

## Running the checks

```bash
# fixtures and the entry point — no Gradle, no JVM, no network
npx tsx src/test/gradle-tests.ts
npx tsx src/test/gradle-tests.ts --list      # what each check proves
npx tsx src/test/gradle-tests.ts --bless     # rewrite goldens (read below first)

# invariants over real repositories, plus the coverage split
npx tsx src/test/gradle-gates/corpus-invariants.ts <repo> [<repo> …]

# the external oracle
npx tsx src/test/gradle-gates/diff-gradle-model.ts <repo>
```

### One suite runs through `extractProject()`, and it has to

Four of the five fixture suites drive `GradleProjectAnalyzer` directly. The
`entry-point` suite does not — it calls `extractProject()`, the function a
caller actually uses.

That is not ceremony. `extractProject` runs project detection first and hands
the analyzer scan targets that OVERLAP by construction: the repository root is
prepended so root-level config is never missed, and every detected project
underneath it is added as well. A test that builds its own single target never
sees this, and the overlap broke three things at once — every file analysed
twice, one build script emitted as both `PROJECT_BUILD` and `SCRIPT_PLUGIN`,
and the duplicate rows carrying different `baseMservPath` values so their keys
differed and a uniqueness check saw nothing wrong.

If you change discovery, ownership, or anything that reads `baseMservPath`,
this is the suite that will tell you.

### `--bless` is not a fix

Re-blessing turns a red suite green and records the new behaviour as intended.
It is correct only when you have decided, from Gradle's documented semantics or
from the differential gate, that the new output is right. If a golden changed
and you cannot say why in one sentence, you have found a defect, not a stale
expectation.

The behavioural checks in `gradle-tests.ts` are the ones that push back on
this: they are written from what Gradle does, not from what this parser emits,
so they do not move when the parser does.

## What is not verified

Honest list. Each of these is a place where a defect would currently ship.

- **The differential gate needs a working build.** It runs `--offline`, so a
  build whose plugins are not in the local Gradle cache reports NOT VERIFIED
  and exits 3. Most real repositories do this on a clean machine. When it
  cannot run, the project graph and coordinates are checked by nothing outside
  this repository.
- **Coordinates are compared only one way.** Gradle prints the transitive
  closure; this is a front end that reads declarations. A declared module
  absent from Gradle's resolution is worth reading; the reverse is expected.
- **Nothing checks blocks, comments, or parse gaps against an oracle.** There is
  no external authority that enumerates the `{ }` blocks in a build file. The
  fixture goldens are all these have.
- **Cross-format resolution does not happen.** Elasticsearch keeps its versions
  in `build-tools-internal/version.properties` and reads them as
  `versions.netty`. Those live in the Properties relations, and nothing joins
  the two, so they stay `UNRESOLVED_IN_CORPUS` — 832 of them. This is the
  single largest coverage gap and it is a real one, not a measurement artefact.
- **`buildFileName` is detected, not evaluated.** A settings file that renames
  build files is recognised by the presence of the assignment, and the
  conventional `<name>.gradle` is then tried. A build that computes some other
  name will not link.
- **Groovy slashy strings are not tracked by the comment scanner.** A `//`
  inside `/foo\/bar/` reads as a comment. The failure mode is a spurious
  comment row, not a lost declaration.
- **Gradle detection is by file presence, not by a detector.** There is no
  `gradle-detector.ts` alongside the Java and Python ones, and
  `ProjectLanguage.GROOVY` is never assigned. The Gradle analyzer is handed
  every scan target and finds build files by name, which is why it works on a
  repository the project scanner classifies as Java, or as nothing at all. It
  also means a Gradle build is never reported in the "Projects by language"
  summary.
- **`stripKotlinTypeCasts` is over-eager.** It matches any ` as Word`, so a
  Groovy string containing the English word "as" before a capitalised word is
  rewritten. It emits a `DROPPED_TYPE_CAST` gap either way, so the damage is
  visible rather than silent.

## Adding a construct

1. Add the enum value first. A string column that could be an enum will drift.
2. Emit it, and add a behavioural check to `gradle-tests.ts` written from
   Gradle's semantics rather than from what your change happens to produce.
3. Run the corpus gate over at least one large real build. Fixtures do not have
   enough shapes in them to find a key collision or a dangling foreign key.
4. If the construct affects the project graph or a coordinate, run the
   differential gate.
