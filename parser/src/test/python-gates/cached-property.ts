/**
 * `@cached_property` is a property getter, not an instance method.
 *
 * `functools.cached_property` is `@property` with a memo: a descriptor whose `__get__` runs
 * the decorated body once and caches the result, so `obj.x` is A READ THAT RUNS A METHOD
 * BODY, exactly as `@property` is. The classifier tested only `property` / `.property`, so
 * it fell through to `INSTANCE_METHOD` and every consumer saw a plain method that is never
 * called: the read was attributed as a field access rather than the call it is, the body
 * looked unreached, and anything invoked on the result had no type to dispatch on, because
 * the type comes from the getter's return and nothing consults it.
 *
 * Why this gate exists ALONGSIDE the frozen golden, which also moves when this regresses:
 * the golden had FROZEN THE DEFECT. `verified/categories/methods/method_kinds.py` has
 * carried `@functools.cached_property def cached` since it was written, and its golden row
 * said `methodKind=INSTANCE_METHOD` — so the snapshot agreed with the bug and could not
 * report it. A golden catches a CHANGE; only a named expectation catches a WRONG VALUE that
 * was there from the start.
 *
 * The spellings matter and are all here. `cached_property` is bare when imported directly,
 * dotted through its module otherwise, and the third-party re-exports are dotted more
 * deeply still — `django.utils.functional.cached_property` is the common one. A suffix test
 * covers all three, the same way `.setter` and `.deleter` are already covered.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { PythonProjectAnalyzer } from '@/workflows/python/python-project-analyzer';

const SOURCE = `import functools
from functools import cached_property

import django.utils.functional


class Registry:
    def lookup(self, k):
        return k


class Settings:
    _path = "p"

    @functools.cached_property
    def dotted(self) -> Registry:
        return Registry(self._path)

    @cached_property
    def bare(self) -> Registry:
        return Registry(self._path)

    @django.utils.functional.cached_property
    def third_party(self) -> Registry:
        return Registry(self._path)

    @property
    def plain_property(self) -> Registry:
        return Registry(self._path)

    @plain_property.setter
    def plain_property(self, value: Registry) -> None:
        self._value = value

    @property
    def deletable(self) -> Registry:
        return Registry(self._path)

    @deletable.deleter
    def deletable(self) -> None:
        del self._value

    @staticmethod
    def a_static() -> int:
        return 1

    @classmethod
    def a_class(cls) -> int:
        return 2

    def an_instance_method(self) -> int:
        return 3


class WritesItsOwnAttribute:
    """A cached property is simultaneously a getter and a FIELD: the first read writes an
    instance attribute of the same name. Reclassifying must not cost the field its row."""

    @functools.cached_property
    def value(self) -> int:
        return 1

    def reset(self) -> None:
        self.value = 2
`;

/** method name -> the methodKind it must carry, and why. */
const EXPECTED: ReadonlyArray<readonly [string, string, string]> = [
  ['dotted', 'PROPERTY_GETTER', '@functools.cached_property'],
  ['bare', 'PROPERTY_GETTER', '@cached_property, imported directly'],
  ['third_party', 'PROPERTY_GETTER', '@django.utils.functional.cached_property, a re-export'],
  // ── controls: every neighbouring decorator keeps the kind it already had ──
  ['a_static', 'STATIC_METHOD', 'control: @staticmethod'],
  ['a_class', 'CLASS_METHOD', 'control: @classmethod'],
  ['an_instance_method', 'INSTANCE_METHOD', 'control: no decorator at all'],
  ['lookup', 'INSTANCE_METHOD', 'control: an ordinary method on another class'],
];

/**
 * A name declared twice — `@property` plus its `.setter` — must yield BOTH kinds, one per
 * definition. Asserted separately because a single-kind lookup would silently accept only
 * the first, and the setter/deleter tests sit right beside the one being changed.
 */
const BOTH_KINDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['plain_property', ['PROPERTY_GETTER', 'PROPERTY_SETTER']],
  ['deletable', ['PROPERTY_GETTER', 'PROPERTY_DELETER']],
];

export async function cachedProperty(): Promise<number> {
  const problems: string[] = [];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'py-cachedprop-'));
  const source = path.join(root, 'src');
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, 'props.py'), SOURCE);

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

  const kindsByName = new Map<string, string[]>();
  for (const m of tsv('all-python-methods.csv')) {
    const name = m.name ?? '';
    if (!kindsByName.has(name)) {
      kindsByName.set(name, []);
    }
    kindsByName.get(name)!.push(m.methodKind ?? '');
  }

  for (const [name, want, why] of EXPECTED) {
    const got = kindsByName.get(name);
    if (!got) {
      problems.push(`${name} (${why}): no method row emitted at all`);
    } else if (!got.includes(want)) {
      problems.push(`${name} (${why}): expected ${want}, got ${got.sort().join('/')}`);
    }
  }

  for (const [name, wanted] of BOTH_KINDS) {
    const got = kindsByName.get(name) ?? [];
    for (const want of wanted) {
      if (!got.includes(want)) {
        problems.push(
          `${name}: expected a ${want} definition, saw only ${got.sort().join('/') || '(none)'}`
        );
      }
    }
  }

  // The field side. A cached property writes an instance attribute of the same name on first
  // read, so it is a getter AND a field. Reclassifying routes it down the path `@property`
  // already takes, and that path only ever ADDS a modifier — but "only ever" is the kind of
  // claim that should be checked rather than asserted, so: the field keeps its row.
  const valueFields = tsv('all-python-fields.csv').filter((f) => f.name === 'value');
  if (valueFields.length === 0) {
    problems.push(
      'the attribute a cached property writes lost its field row; reclassifying must not ' +
      'suppress the field, only describe the method'
    );
  }

  fs.rmSync(root, { recursive: true, force: true });
  const cached = EXPECTED.filter(([, k]) => k === 'PROPERTY_GETTER').length;
  console.log(`  ${kindsByName.size} distinct method name(s); ${cached} cached_property ` +
    `spelling(s) checked against 4 unchanged neighbours, both property/setter and ` +
    `property/deleter pairs, and the written attribute's field row`);
  for (const problem of problems) {
    console.log(`  FAIL  ${problem}`);
  }
  return problems.length === 0 ? 0 : 1;
}
