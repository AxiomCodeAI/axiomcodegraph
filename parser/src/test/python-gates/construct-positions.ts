/**
 * CONSTRUCT x POSITION — the gap this gate exists to close.
 *
 * Eight defects were reported against a suite that was fully green, and none of
 * them was a missing construct. Every one was a construct the corpus already
 * covered, in a syntactic POSITION it did not:
 *
 *   chained assignment   works in a function body, dropped targets in a class body
 *   comprehension walrus works under a function, bound the wrong scope at module level
 *   `print >> x`         parses clean as an argument, a dict key and an RHS,
 *                        and only becomes a `print_statement` as a bare statement
 *
 * A corpus that varies construct alone cannot see any of these, because the
 * construct is present and passing somewhere else in the file. So this gate
 * fixes the construct and varies the POSITION, and pairs each broken position
 * with the working one so a regression that "fixes" the pair by breaking both is
 * still red.
 *
 * NO INTERPRETER AT RUNTIME. The expectations below were taken once from the
 * pinned CPython 3.10.4 `symtable` and frozen as literals, so this runs anywhere
 * the project builds. Re-deriving them needs ../../parser-oracle/python; reach
 * for it only when a case here fails and you believe the NEW behaviour is right.
 *
 * Predicate order matches `symtable`:
 *   parameter local global nonlocal free imported
 *   assigned referenced declared_global annotated namespace
 */
import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PREDICATES = ['parameter', 'local', 'global', 'nonlocal', 'free', 'imported',
  'assigned', 'referenced', 'declaredGlobal', 'annotated', 'namespace'] as const;

/** Sources, keyed to the expectation table. Kept byte-exact. */
const SOURCES: Record<string, string> = {
  chained_class: 'class C:\n    a = b = c = 1\n',
  chained_func: 'def f():\n    a = b = c = 1\n    return a, b, c\n',
  chained_module: 'a = b = c = 1\n',
  walrus_module: 'squares = {x4 := i ** 5 for i in range(7)}\n',
  walrus_func: 'def f():\n    s = {y := i for i in range(3)}\n    return s, y\n',
  fstring_spec: 'def width_formatted(value):\n    return f"{value:=10}"\n',
  fstring_walrus: 'def g():\n    return f"{(value := 10)}"\n',
  with_paren: 'def f():\n    with (m() as x):\n        return x\n',
  with_plain: 'def f():\n    with m() as x:\n        return x\n',
  with_multi: 'def f():\n    with (m() as x, n() as y):\n        return x, y\n',
  print_chevron: 'import sys\n\n\ndef f():\n    try:\n        print >> sys.stderr, "message"\n' +
    '    except TypeError:\n        return True\n    return False\n',
};

/** Frozen CPython 3.10.4 truth: case -> [scope, name, predicate bits][]. */
const EXPECTED: Record<string, Array<[string, string, string]>> = {
  chained_class: [
    ['top', 'C', '01100010001'],
    ['C', 'a', '01000010000'],
    ['C', 'b', '01000010000'],
    ['C', 'c', '01000010000'],
  ],
  chained_func: [
    ['top', 'f', '01100010001'],
    ['f', 'a', '01000011000'],
    ['f', 'b', '01000011000'],
    ['f', 'c', '01000011000'],
  ],
  chained_module: [
    ['top', 'a', '01100010000'],
    ['top', 'b', '01100010000'],
    ['top', 'c', '01100010000'],
  ],
  walrus_module: [
    ['top', 'squares', '01100010000'],
    ['top', 'range', '00100001000'],
    ['top', 'x4', '00100000100'],
    ['setcomp', 'i', '01000011000'],
    ['setcomp', 'x4', '00100010100'],
  ],
  walrus_func: [
    ['top', 'f', '01100010001'],
    ['f', 's', '01000011000'],
    ['f', 'range', '00100001000'],
    ['f', 'y', '01000011000'],
    ['setcomp', 'i', '01000011000'],
    ['setcomp', 'y', '00011010000'],
  ],
  fstring_spec: [
    ['top', 'width_formatted', '01100010001'],
    ['width_formatted', 'value', '11000001000'],
  ],
  fstring_walrus: [
    ['top', 'g', '01100010001'],
    ['g', 'value', '01000010000'],
  ],
  with_paren: [
    ['top', 'f', '01100010001'],
    ['f', 'm', '00100001000'],
    ['f', 'x', '01000011000'],
  ],
  with_plain: [
    ['top', 'f', '01100010001'],
    ['f', 'm', '00100001000'],
    ['f', 'x', '01000011000'],
  ],
  with_multi: [
    ['top', 'f', '01100010001'],
    ['f', 'm', '00100001000'],
    ['f', 'x', '01000011000'],
    ['f', 'n', '00100001000'],
    ['f', 'y', '01000011000'],
  ],
  print_chevron: [
    ['top', 'sys', '01100100000'],
    ['top', 'f', '01100010001'],
    ['f', 'print', '00100001000'],
    ['f', 'sys', '00100001000'],
    ['f', 'TypeError', '00100001000'],
  ],
};

/**
 * Python 2 rejection, both directions.
 *
 * Negative tests were absent entirely, which is how `chevron` survived as a
 * rejection trigger: nothing asserted that a valid Python 3 file is ACCEPTED.
 * `print >> sys.stderr, "m"` is byte-identical in the two dialects and is valid
 * Python 3 -- the tuple `(print.__rshift__(stream), "m")` -- so CPython 3.10
 * accepts it and so must we. Only a chevron-LESS `print_statement`, and
 * `exec_statement`, are unambiguously Python 2.
 */
const DIALECT: Array<{ label: string; src: string; reject: boolean }> = [
  { label: 'print >> stream as a bare statement', reject: false,
    src: 'import sys\nprint >> sys.stderr, "m"\n' },
  { label: 'print >> stream as an argument', reject: false,
    src: 'import sys\nf(print >> sys.stderr)\n' },
  { label: 'print >> stream as an assignment RHS', reject: false,
    src: 'import sys\nx = print >> sys.stderr, "m"\n' },
  { label: 'print >> stream as a dict key', reject: false,
    src: 'import sys\nd = {print >> sys.stderr: 1}\n' },
  { label: 'print with a juxtaposed string', reject: true, src: 'print "x"\n' },
  { label: 'print with a juxtaposed name', reject: true, src: 'print x\n' },
  { label: 'exec with a juxtaposed string', reject: true, src: 'exec "code"\n' },
  { label: 'print used as a normal Python 3 call', reject: false, src: 'print(x >> 2)\n' },
];

/**
 * Positions that tree-sitter itself parses wrongly, pinned so they cannot grow.
 *
 * These are upstream grammar defects, not extractor defects: the tree that comes
 * back is either an ERROR or, worse, a clean tree of the wrong shape. They are
 * recorded rather than hidden so the count is visible and can only fall. Raising
 * the bar requires deleting a line here, which is a reviewable act.
 *
 * Measured incidence, so the ratchet is a judgement and not a shrug: across
 * 13,586 stdlib and site-packages files, tree-sitter produces ERROR or MISSING
 * on four, and CPython rejects three of those itself (Python 2 and a deliberate
 * bad-syntax test file). ONE is a real defect, and it is a4-003's construct:
 *
 *   torch/distributed/elastic/rendezvous/utils.py:83
 *       host, *rest = endpoint, *[]
 *
 * a4-005 and a4-023 have no occurrence in that corpus at all. The real fix is a
 * grammar upgrade, which needs tree-sitter core >= 0.23 and so moves Java and
 * TypeScript too; that is a scheduling decision, not a Python one. Until then
 * these degrade as asserted below: marked, and never fabricating.
 */
const KNOWN_TREE_SITTER_DEFECTS: Array<{ id: string; label: string; src: string }> = [
  { id: 'a4-003', label: 'starred empty list in a bare tuple ERRORs and swallows the next statement',
    src: 'x = [1]\nbroken = 1, *[]\nafter = 2\n' },
  { id: 'a4-005', label: 'column-0 comment between a decorator and its def breaks the class body',
    src: 'class C:\n    @property\n# a column-0 comment\n    def m(self):\n        return 1\n' },
  { id: 'a4-023', label: 'starred target with a parenthesized operand loses the assignment node',
    src: 'wb1 = (1, 2, 3)\nname, disabled, *(ws) = wb1\n' },
];

const KNOWN_DEFECT_BAR = 3;

/**
 * Names that MAY be bound despite the defect, because they really are assigned
 * outside the unreadable region. Anything else appearing is fabrication.
 */
const KNOWN_GOOD_BINDINGS: Record<string, string[]> = {
  'a4-003': ['x', 'broken'],
  'a4-005': ['C', 'm', 'self'],
  'a4-023': ['wb1', 'name', 'disabled', 'ws'],
};

type Facts = {
  scopes: Array<Record<string, unknown>>;
  bindings: Array<Record<string, unknown>>;
  fields: Array<Record<string, unknown>>;
  parseGaps: Array<Record<string, unknown>>;
  skippedReason?: string;
};

function extract(src: string, name: string): Facts {
  return new PythonFactExtractor().extract({
    sourceCode: src,
    filePath: `/repo/${name}.py`,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  } as never) as never as Facts;
}

/** Scope hash -> the short name symtable would print. */
function scopeNames(facts: Facts): Map<string, string> {
  const names = new Map<string, string>();
  for (const s of facts.scopes) {
    const qualified = String(s.qualifiedName ?? '');
    const short = String(s.name ?? '');
    names.set(
      String(s.pyScopeUniqueHash),
      short === 'top' || qualified === '' ? 'top' : (qualified.split('.').pop() ?? short)
    );
  }
  return names;
}

export async function constructPositions(): Promise<number> {
  const problems: string[] = [];
  let compared = 0;

  // ---- bindings, same construct in several positions -----------------------
  for (const [id, expected] of Object.entries(EXPECTED)) {
    const src = SOURCES[id];
    if (src === undefined) {
      problems.push(`${id}: no source for the expectation table`);
      continue;
    }
    const facts = extract(src, id);
    if (facts.skippedReason) {
      problems.push(`${id}: rejected as ${facts.skippedReason}, expected to parse`);
      continue;
    }
    const names = scopeNames(facts);
    const mine = new Map<string, string>();
    for (const b of facts.bindings) {
      const scope = names.get(String(b.pyScopeLinkHash)) ?? '?';
      const bits = [b.isParameter, b.isLocal, b.isGlobal, b.isNonlocal, b.isFree, b.isImported,
        b.isAssigned, b.isReferenced, b.isDeclaredGlobal, b.isAnnotated, b.isNamespace]
        .map((v) => (v ? '1' : '0')).join('');
      mine.set(`${scope}|${String(b.name)}`, bits);
    }
    for (const [scope, name, bits] of expected) {
      const key = `${scope}|${name}`;
      const got = mine.get(key);
      compared += 1;
      if (got === undefined) {
        problems.push(`${id}  ${key}: MISSING from py_binding, expected ${bits}`);
        continue;
      }
      if (got !== bits) {
        const differ = PREDICATES.filter((_, i) => got[i] !== bits[i]);
        problems.push(`${id}  ${key}: ours=${got} cpython=${bits} differ on ${differ.join(',')}`);
      }
    }
  }

  // ---- fields, the position the binding table cannot see -------------------
  // py_field is a different relation from py_binding, so a class body can bind
  // all three names and still declare only one attribute.
  const classFields = extract(SOURCES.chained_class!, 'chained_class').fields
    .map((f) => String(f.name)).sort();
  compared += 1;
  if (classFields.join(',') !== 'a,b,c') {
    problems.push(`chained_class  py_field emitted [${classFields.join(',')}], expected a,b,c`);
  }

  // ---- dialect, both directions -------------------------------------------
  for (const c of DIALECT) {
    const rejected = extract(c.src, 'dialect').skippedReason !== undefined;
    compared += 1;
    if (rejected !== c.reject) {
      problems.push(
        `dialect  ${c.label}: ${rejected ? 'REJECTED' : 'accepted'}, expected ` +
        `${c.reject ? 'REJECTED' : 'accepted'}`
      );
    }
  }

  // ---- known upstream defects, ratcheted ----------------------------------
  const stillBroken: string[] = [];
  for (const d of KNOWN_TREE_SITTER_DEFECTS) {
    const facts = extract(d.src, d.id);
    // Presence is NOT the test. All three names in a4-023 are emitted; they are
    // simply emitted as referenced-only, because the misparse loses the
    // assignment node. A `has(name)` check passes on every one of these defects,
    // so the predicate is what gets asserted.
    const assigned = new Set(
      facts.bindings.filter((b) => b.isAssigned).map((b) => String(b.name))
    );
    const referenced = new Set(
      facts.bindings.filter((b) => b.isReferenced).map((b) => String(b.name))
    );
    const healthy =
      (d.id === 'a4-003' && assigned.has('after') && assigned.has('broken')) ||
      (d.id === 'a4-005' && referenced.has('property')) ||
      (d.id === 'a4-023' &&
        assigned.has('name') && assigned.has('disabled') && assigned.has('ws'));
    if (!healthy) {
      stillBroken.push(`${d.id}  ${d.label}`);
    }

    // A known defect is only tolerable if it degrades HONESTLY. Two things are
    // required, and they are asserted rather than assumed:
    //
    //   1. the unreadable region is marked, so a consumer joining py_parse_gap
    //      knows not to trust it -- absence stays meaningful;
    //   2. nothing WRONG comes out. A missing binding is a false negative a
    //      consumer can see; a fabricated one is a false positive it cannot.
    //
    // Without this, "known defect" is just an acknowledgement. With it, the
    // shape of the failure is pinned too, so a future change cannot quietly
    // turn a marked miss into an unmarked wrong answer.
    if (facts.parseGaps.length === 0) {
      problems.push(`${d.id}: degrades SILENTLY, no py_parse_gap marks the region`);
    }
    for (const b of facts.bindings) {
      if (!KNOWN_GOOD_BINDINGS[d.id]!.includes(String(b.name))) {
        problems.push(`${d.id}: fabricated binding ${String(b.name)} from an unreadable region`);
      }
    }
  }

  console.log(`  ${compared} frozen expectations, ${stillBroken.length} known upstream defect(s)`);
  for (const s of stillBroken) {
    console.log(`  KNOWN  ${s}`);
  }
  if (stillBroken.length > KNOWN_DEFECT_BAR) {
    problems.push(
      `known upstream defects rose to ${stillBroken.length}, bar is ${KNOWN_DEFECT_BAR}`
    );
  }
  if (stillBroken.length < KNOWN_DEFECT_BAR) {
    console.log(
      `  NOTE   ${KNOWN_DEFECT_BAR - stillBroken.length} defect(s) now fixed; ` +
      'lower KNOWN_DEFECT_BAR to pin the gain'
    );
  }

  for (const p of problems) {
    console.log(`  FAIL  ${p}`);
  }
  return problems.length === 0 ? 0 : 1;
}
