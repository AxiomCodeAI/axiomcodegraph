/**
 * A call whose result is splatted is still a named call.
 *
 * `[*items()]` and `{*items()}` — a single splatted element in a list or set display —
 * are mis-nested by tree-sitter-python as `call(function: list_splat(*, items))`, as
 * though the source had said `(*items)()`. It did not: the `*` applies to the call's
 * RESULT. The parser read the callee straight off that field, so `fn.type` was
 * `list_splat` rather than `identifier`, the site fell through to `DYNAMIC_CALL`, and
 * `calleeName` came out empty.
 *
 * `DYNAMIC_CALL` is documented in the call-site schema as `getattr` / `eval` / `exec` —
 * unresolvable BY CONSTRUCTION and marked so. A named module-level function inside a list
 * display is fully static, so the label told every consumer the opposite of the truth and
 * the engine had to declare a blind spot at a site it could resolve exactly.
 *
 * The attribute form is the same mis-nesting one level deeper and is worth pinning
 * separately, because the symptom differs: `[*obj.method()]` parses as
 * `attribute(object: list_splat(*, obj))`, so `calleeName` SURVIVES as `method` while the
 * RECEIVER text comes out `*obj` — a receiver no engine can resolve, and a wrong answer
 * rather than a missing one.
 *
 * The controls are the point of the fixture: five sibling unpacking forms are nested
 * correctly and must stay correct. Two splats in one display parse correctly too, which is
 * what shows the defect is the single-element case and not `*` in a display generally.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `class Obj:
    def method(self):
        return [1]


def items():
    return [1, 2]


def mapping():
    return {"a": 1}


def take(n):
    return [n]


obj = Obj()


def a_name_in_list():      return [*items()]
def b_name_in_set():       return {*items()}
def c_attr_in_list():      return [*obj.method()]
def d_attr_in_set():       return {*obj.method()}
def e_nested_argument():   return [*take(*items())]
def f_two_splats():        return [*items(), *items()]
def g_parenthesized():     return [*(items())]
def h_tuple_display():     return (*items(),)
def i_dict_unpacking():    return {**mapping()}
def j_call_argument():     return take(*items())
def k_plain_call():        return items()
`;

/**
 * enclosing function -> the call sites it must contain, as
 * `callKind/calleeName/receiverKind/receiverText`.
 *
 * Keyed on the enclosing FUNCTION rather than on a line number, so the fixture can be
 * edited without silently re-pointing an assertion at a different construct.
 *
 * Every entry is an EXACT expectation rather than "not DYNAMIC_CALL": the defect replaced
 * one specific answer with another, so a rule that only forbade the wrong value would pass
 * on a third wrong value.
 */
const EXPECTED: ReadonlyArray<readonly [string, readonly string[], string]> = [
  // ── the mis-nested shapes ──
  ['a_name_in_list', ['SIMPLE_CALL/items/NONE/'], 'a splatted name in a list display'],
  ['b_name_in_set', ['SIMPLE_CALL/items/NONE/'], 'a splatted name in a set display'],
  ['c_attr_in_list', ['METHOD_CALL/method/NAME/obj'], 'a splatted attribute in a list display'],
  ['d_attr_in_set', ['METHOD_CALL/method/NAME/obj'], 'a splatted attribute in a set display'],
  // Two calls on one line: the splatted outer one and the inner argument, which was
  // already correct. A fix that unwrapped too eagerly and collapsed them fails here.
  ['e_nested_argument', ['SIMPLE_CALL/items/NONE/', 'SIMPLE_CALL/take/NONE/'],
    'a splatted call taking a splatted argument'],

  // ── controls: nested correctly by the grammar, and correct before this change ──
  ['f_two_splats', ['SIMPLE_CALL/items/NONE/', 'SIMPLE_CALL/items/NONE/'],
    'control: two splats in one display, which the grammar nests correctly'],
  ['g_parenthesized', ['SIMPLE_CALL/items/NONE/'], 'control: a parenthesised splatted call'],
  ['h_tuple_display', ['SIMPLE_CALL/items/NONE/'], 'control: a tuple display'],
  ['i_dict_unpacking', ['SIMPLE_CALL/mapping/NONE/'], 'control: dict unpacking'],
  ['j_call_argument', ['SIMPLE_CALL/take/NONE/', 'SIMPLE_CALL/items/NONE/'],
    'control: a splat in an argument list, where it belongs'],
  ['k_plain_call', ['SIMPLE_CALL/items/NONE/'], 'control: a plain call'],
];

export async function splatCallee(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-splat-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'splat.py'), SOURCE);

  const outputDir = path.join(root, 'out');
  await new PythonProjectAnalyzer().analyze({
    rootDir: source,
    outputDir,
    baseMservPath: '/repo',
    serviceVersionLinkHash: 'SERVICE_VERSION_' + '0'.repeat(32),
  });

  const tsv = (file: string): Record<string, string>[] => {
    const lines = fs.readFileSync(path.join(outputDir, file), 'utf-8').split('\n').filter(Boolean);
    const header = lines[0]!.split('\t');
    return lines.slice(1).map((l) => {
      const cells = l.split('\t');
      return Object.fromEntries(header.map((h, i) => [h, cells[i] ?? '']));
    });
  };

  const methodName = new Map<string, string>();
  for (const m of tsv('all-python-methods.csv')) {
    methodName.set(m.pyMethodUniqueHash ?? '', m.name ?? '');
  }

  const sites = tsv('all-python-call-sites.csv');
  const byFunction = new Map<string, string[]>();
  let dynamic = 0;
  const nameless: string[] = [];
  for (const c of sites) {
    const owner = methodName.get(c.pyMethodLinkHash ?? '') ?? '<unknown>';
    const shape = `${c.callKind}/${c.calleeName}/${c.receiverKind}/${c.receiverText}`;
    if (!byFunction.has(owner)) {
      byFunction.set(owner, []);
    }
    byFunction.get(owner)!.push(shape);
    if (c.callKind === 'DYNAMIC_CALL') {
      dynamic += 1;
    }
    if ((c.calleeName ?? '') === '') {
      nameless.push(`${owner} ${c.callKind}`);
    }
  }

  for (const [fn, want, why] of EXPECTED) {
    const got = (byFunction.get(fn) ?? []).slice().sort();
    const expected = want.slice().sort();
    if (JSON.stringify(got) !== JSON.stringify(expected)) {
      problems.push(
        `${fn} (${why}): expected ${expected.join(' + ')}, saw ${got.join(' + ') || '(no call site)'}`
      );
    }
  }

  // The general property, stated once: nothing in this file is dynamic. `DYNAMIC_CALL`
  // means unresolvable by construction, and every callee here is written down.
  if (dynamic > 0) {
    problems.push(`${dynamic} site(s) still DYNAMIC_CALL; no callee in this file is dynamic`);
  }

  // A call site carrying a callKind but no name is the shape the issue reported. Assert the
  // absence directly, so a future construct that loses its name fails here too.
  if (nameless.length > 0) {
    problems.push(`call site(s) with an empty calleeName: ${nameless.join(', ')}`);
  }

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`  ${sites.length} call site(s) across ${EXPECTED.length} unpacking forms; ` +
    `${dynamic} dynamic, ${nameless.length} nameless — 5 mis-nested shapes and ` +
    `5 correctly-nested controls checked`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
