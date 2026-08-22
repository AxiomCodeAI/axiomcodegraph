# CSV emission and link hashes — Python vs Java

Measured, not read off the source: both analyzers were run and the **same**
integrity check (`tools/csv_integrity.py`) applied to both outputs.

- Java: `src/test-data/java` — 76 files → 17 files, 35,379 rows
- Python: 795 CPython 3.10.4 stdlib files → 11 files, 871,514 rows

## What is shared

Both emit **tab-separated** files with a `.csv` extension, one relation per
file, a header line, and the primary key as the last column. Both mint keys
through `EntityUtils.generateEntityHash(prefix, content)` — MD5 over a `||`
-joined content string, prefixed with the relation name — and both express
foreign keys as `*LinkHash` columns carrying that prefixed hash. Both chunk
writes at 50,000 rows to dodge V8's maximum string length.

So the wire format is the same. The differences are in discipline.

## Where Python is stricter

| | Java | Python |
|---|---|---|
| Fields escaped (`escapeTsv`) | 7 of 11 registries | **10 of 10** |
| Duplicate primary keys | **78 rows / 64 keys** in `all-type-references.csv` on the repo's own test data | **0** in 871,509 rows of real stdlib |
| Dangling foreign keys | 0 | 0 |
| Row arity vs header | 0 breaks | 0 breaks |
| Determinism | not asserted | byte-identical across runs, sorted path order |

The Java duplicates are **byte-identical rows** — same owner expression, same
`typeName`, same everything — and the reason the key cannot separate them is
visible in the row: `startLine` and `endLine` are empty for
`PATTERN_BINDING_TYPE` references, so position is absent from the hash input.

Python's keys include position by construction, and the schema argues the case
explicitly for `py_scope` and `py_method`: `startColumn` is in the key *because
of lambdas* — `g = (lambda: 1, lambda: 2)` gives two rows whose
`qualifiedName`, `signature` and `startLine` are identical. That is the same
class of bug as the Java one, anticipated instead of hit.

## Where Python differs in a way that needs a decision

1. **Empty relation → a zero-byte file.** Python writes an empty file so a
   consumer can tell "no rows" from "the parser never ran". But it writes *no
   header*, so a header-driven reader (`csv.DictReader`, a Datalog loader) sees
   a file with no columns rather than a valid empty relation. Java instead
   skips the file entirely. Neither writes the third option, a header-only
   file, which is the one that satisfies both readings. Measured: 5 of 11 files
   are zero-byte on a corpus with no classes.

2. **The skipped-files CSV has no key column.** Java's ends with
   `uniqueFileHash`; Python's ends with `detail`, free text. It is also the one
   Python file whose fields are joined **unescaped** — safe today only because
   `construct` holds a node-type name (`print_statement`) rather than source
   text, but `filePath` is unescaped too and a path may legally contain a tab.

3. **Python is not wired into `extract.ts`.** The top-level entry point runs
   Java, Gradle, XML, YAML and Properties analyzers; `PythonProjectAnalyzer`
   exists and works but nothing calls it. Presumably deliberate while Python is
   unfrozen — worth confirming rather than discovering later.

## The one that will bite: memory

Both analyzers accumulate every row in memory and export at the end. Python's
"accumulate, then export" is a deliberate choice, and the reason is good —
byte-identical output is a gate, and streaming rows in filesystem-enumeration
order cannot deliver it. But the corpus reaches the limit:

| files | py_expression rows | peak RSS |
|---|---|---|
| 400 | 248,819 | 828 MB |
| 795 | 604,766 | 1.50 GB |
| 1,713 (the whole 3.10 stdlib) | — | **OOM at the 4 GB default heap** |

Roughly 1.9 MB of heap per source file, dominated by `py_expression` (~760
rows/file). A3's own commit message reports a 13,586-file run, so that must
already be running with a raised heap.

Determinism and streaming are not actually in conflict: sorting the file list
up front (which the analyzer already does) makes the total order known before
any row is produced, so rows could be appended per file and stay byte-identical.
That is a design question for the human, not a defect — but at 1,713 files the
current shape does not complete.
