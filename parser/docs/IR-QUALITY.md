# IR Quality

How the intermediate representation is validated, what each oracle decides, and how to reproduce
every measurement.

This document deliberately contains no scores. Figures change with every commit, and a number
copied into a document is stale the moment it is written. Each gate prints its own results,
including what it could not verify. Run them.

---

## 1. Why external oracles

A fixture written alongside a parser encodes the author's belief about what the parser should do.
It catches regressions. It does not catch a wrong premise, because the fixture and the code share
that premise.

This is not hypothetical. A fixture in this repository once asserted that a particular class
reference must remain unresolved, with a comment explaining why. An independent tool resolved it.
The comment was wrong, the fixture had frozen the error, and the suite had been green for weeks.

Every gate therefore uses something not written for this purpose.

| Oracle | What it decides | Why it is authoritative |
|---|---|---|
| CPython `symtable` | Scope tree, every binding, ten predicates per binding | It is the structure the interpreter consults. A disagreement is a defect, not a modelling preference. |
| CPython `ast` | Decorators, blocks, expression structure | States presence, order and arguments outright rather than inferring them. |
| CPython bytecode | Every call the compiler emitted, and how each name resolves | The compiler has already decided whether a name is local, global, a cell, or an attribute, and records it in the opcode. |
| CPython `sys.settrace` | Which function a call actually reaches | Ground truth for target correctness, not merely call discovery. |
| JVM bytecode | Java call edges | The same role for the Java front end. |

---

## 2. What each gate measures

### Structure

`diff-symtable.ts` compares the scope forest and every binding against `symtable`. Ten predicates
per binding are checked: parameter, local, global, free, imported, assigned, namespace, declared
global, nonlocal, and annotated.

`diff-decorator.ts` compares decorators and their arguments against `ast`: presence, order,
application order, kind, dotted path, owner, context, argument count, and every argument name and
keyword flag.

`diff-block.ts` and `diff-expr*.ts` compare control flow blocks and the expression tree against
`ast`.

### Call graph

Three gates at increasing strictness, because each answers a question the previous one cannot.

**Discovery.** The bytecode oracle lists every call instruction the compiler emitted, with the
callee recovered by simulating the operand stack. Stronger than tracing for recall, because the
compiler emits an instruction whether or not the branch ever runs.

**Target correctness.** Discovery is not enough. A tool can find every call and still name the
wrong target. `diff-runtime-calls.ts` runs a closed world corpus under `sys.settrace` and checks
that the emitted target is the function the interpreter entered.

**Substrate sufficiency.** `cha-rta-substrate.ts` builds C3 linearisation, override edges, class
hierarchy analysis, rapid type analysis, and argument to parameter binding using only the emitted
relations, with no parser objects in scope. This tests whether the IR is sufficient for downstream
reasoning rather than asserting that it is.

### Coverage

`link-coverage.ts` separates unresolved references into two kinds, because conflating them
measures the wrong thing.

- **Resolvable**: the name matches an entity this run emitted. This is the parser's gap.
- **External**: nothing by that name exists in the corpus. Not knowable, and excluded from the
  denominator.

A raw resolved over total ratio tracks how many dependencies a project has rather than how good the
parser is.

---

## 3. Principles the gates follow

**Report what you could not check.** A gate that prints only successes is not reporting. Where a
position cannot be verified, or a construct is excluded, the count is printed alongside the result.

**Suspect the instrument first.** Most large discrepancies found during development were defects in
the gate, not the parser. Examples that each looked like a parser failure: joining on a column that
does not exist on the relation; running a path transform twice; keying decorators by owner name so
that every method called `test` pooled together; treating a property getter as a missing call site
when a property access correctly has no call node.

**Know the oracle's own bugs.** CPython 3.10 miscomputes expression positions inside multi line
f-strings, and duplicates `finally` bodies in bytecode so one source call yields two instructions.
Both were initially charged to the parser. Where the oracle is wrong, the gate excludes the case
and prints the exclusion rather than silently dropping it or blaming the wrong side.

**Prefer a closed world for target correctness.** In a corpus with no imports outside the tree,
every call must resolve to something present, so the ceiling is 100 percent by construction rather
than by assertion. `generate_xpkg.py` produces such a corpus, generated rather than hand written so
that every construct appears many times and no single lucky case carries a result.

---

## 4. Known limits

These are properties of the language, not defects, and no amount of parser work removes them.

**Duck typing.** A receiver whose type is written nowhere cannot be typed. Emitting a guess would
produce a false edge, which is worse than no edge: a data flow query that follows it gets a
confident wrong answer.

**Mixin dispatch.** When a class calls an attribute supplied by a sibling base under multiple
inheritance, the attribute genuinely does not exist on that class or its ancestors. It exists only
once a subclass combines them, and several combinations may supply different types.

**Chains beyond one hop.** Each individual hop is linked. Composing them is a reaching definition
join, which belongs to the engine.

**Grammar level hazards.** tree-sitter-python applies the PEP 695 soft `type` keyword greedily, so
`type(obj).attr = value` parses cleanly as a type alias and the call node disappears. That
statement is recovered, and the part that cannot be is recorded in `py_parse_gap` so its absence is
visible. Python 2 files are rejected explicitly for the same reason: `print "x"` parses cleanly
under this grammar and would otherwise emit confident nonsense.

---

## 5. Running the gates

```bash
# Structure
npx tsx src/test/python-gates/diff-symtable.ts  <corpus>
npx tsx src/test/python-gates/diff-decorator.ts <corpus>
npx tsx src/test/python-gates/diff-block.ts     <corpus>

# Call target correctness, against the runtime
python3 src/test/python-gates/generate_xpkg.py /tmp/xpkg 60
python3 src/test/python-gates/trace_calls.py   /tmp/xpkg /tmp/xpkg/main.py > /tmp/edges.jsonl
npx tsx src/test/python-gates/diff-runtime-calls.ts /tmp/xpkg /tmp/edges.jsonl

# Substrate sufficiency and coverage
npx tsx src/test/python-gates/cha-rta-substrate.ts <csv-dir>
npx tsx src/test/python-gates/link-coverage.ts     <corpus>
```

The extractor suites are separate from the gates and run three validation layers: per fixture
expected values, column arity against the frozen schema, and referential integrity across every
foreign key in the emitted set.

```bash
npx tsx src/test/java-extractor-tests.ts
npx tsx src/test/python-extractor-tests.ts
```
