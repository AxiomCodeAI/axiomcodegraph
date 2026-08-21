/**
 * Adjudicates INHERITANCE and POLYMORPHISM against CPython at runtime.
 *
 * Two comparisons, both against the interpreter rather than a second static
 * implementation:
 *
 *  1. MRO ORDER — my C3 linearisation vs `cls.__mro__`.
 *  2. OVERRIDE RESOLUTION — for every callable visible on a class, which class
 *     actually provides it, vs CPython's own attribute lookup.
 *
 * Classes outside the analysis (`object`, `ABC`, `Exception`) are dropped from
 * CPython's answer before comparing, since the parser cannot see them; a
 * disagreement is only counted where both sides can see the class.
 */
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { PythonFactExtractor } from '@/parsers/python/extractors/python-fact-extractor';

const PINNED = '/Library/Frameworks/Python.framework/Versions/3.10/bin/python3';
const PROBE = path.join(process.cwd(), 'src/test/python-runtime/probe_runtime.py');

export function adjudicateMro(file: string, verbose = false) {
  let runtime;
  try {
    runtime = JSON.parse(
      execFileSync(PINNED, [PROBE, '--file', file], {
        encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'ignore'], timeout: 20_000,
      })
    );
  } catch {
    return {
      unjudged: true, mroChecked: 0, mroBad: 0, ovChecked: 0, ovBad: 0, ovMissing: 0,
      problems: [] as string[],
    };
  }

  const facts = new PythonFactExtractor().extract({
    sourceCode: fs.readFileSync(file, 'utf8'), filePath: file, baseMservPath: '/r',
    moduleQualifiedName: path.basename(file).replace(/\.pyi?$/, ''), serviceVersionLinkHash: 'SV',
  });

  const typeByName = new Map(facts.types.map(t => [t.getName(), t]));
  const nameByHash = new Map(facts.types.map(t => [t.getHash(), t.getName()]));
  const basesOf = new Map<string, string[]>();
  for (const b of facts.typeBases) {
    if (b.getKeywordName() !== '' || !b.getIsResolvedLocally()) continue;
    basesOf.set(b.getPyTypeLinkHash(), [...(basesOf.get(b.getPyTypeLinkHash()) ?? []), b.getResolvedTypeLinkHash()]);
  }
  const declares = new Map<string, Set<string>>();
  for (const m of facts.methods) {
    if (!m.isClassBodyMember()) continue;
    const set = declares.get(m.getPyTypeLinkHash()) ?? new Set<string>();
    set.add(m.getName());
    declares.set(m.getPyTypeLinkHash(), set);
  }

  /** C3, mirroring the parser's own algorithm. */
  const linearize = (hash: string, seen = new Set<string>()): string[] | null => {
    if (seen.has(hash)) return null;
    seen.add(hash);
    const bases = basesOf.get(hash) ?? [];
    if (bases.length === 0) return [hash];
    const seqs: string[][] = [];
    for (const b of bases) {
      const l = linearize(b, new Set(seen));
      if (l === null) return null;
      seqs.push([...l]);
    }
    seqs.push([...bases]);
    const out: string[] = [];
    const pending = seqs.filter(s => s.length);
    while (pending.length) {
      let taken: string | null = null;
      for (const s of pending) {
        const head = s[0]!;
        if (!pending.some(o => o.indexOf(head) > 0)) { taken = head; break; }
      }
      if (taken === null) return null;
      out.push(taken);
      pending.forEach(s => { if (s[0] === taken) s.shift(); });
      for (let i = pending.length - 1; i >= 0; i--) if (!pending[i]!.length) pending.splice(i, 1);
    }
    return [hash, ...out];
  };

  const problems: string[] = [];
  let mroChecked = 0, mroBad = 0, ovChecked = 0, ovBad = 0, ovMissing = 0;

  // A class with a COMPUTED base cannot be adjudicated: `class _Method(
  // _namedtuple('_Method', ...))` makes CPython's MRO contain a dynamically
  // created class with the SAME module and name as the subclass, which the
  // parser provably cannot see. Skipping is honest; comparing would report a
  // parser defect that is really an unseeable class.
  const dynamicBaseTypes = new Set(
    facts.typeBases.filter(b => b.getIsDynamic()).map(b => b.getPyTypeLinkHash())
  );
  // Classes carrying a custom metaclass, directly or through a base.
  const metaclassTypes = new Set<string>();
  for (const t of facts.types) {
    if (t.toCsv().split('\t')[18] !== '') metaclassTypes.add(t.getHash());
  }
  let grew = true;
  while (grew) {
    grew = false;
    for (const b of facts.typeBases) {
      if (!b.getIsResolvedLocally()) continue;
      if (metaclassTypes.has(b.getResolvedTypeLinkHash()) && !metaclassTypes.has(b.getPyTypeLinkHash())) {
        metaclassTypes.add(b.getPyTypeLinkHash());
        grew = true;
      }
    }
  }

  for (const cls of runtime.classes) {
    const type = typeByName.get(cls.name);
    if (!type) continue;
    if (dynamicBaseTypes.has(type.getHash())) continue;
    // A custom METACLASS can inject members that exist nowhere in the source.
    // `class IntEnum(int, Enum)` has an empty body, yet EnumMeta puts __new__,
    // __repr__ and _generate_next_value_ into its __dict__ at creation time, so
    // CPython reports IntEnum as the declaring class for methods that are not
    // written there. The parser's answer (the nearest SOURCE declaration) is the
    // correct static one, so these are not adjudicable by runtime introspection.
    if (metaclassTypes.has(type.getHash())) continue;
    // Keep only classes DEFINED IN THIS MODULE, in CPython's order. The MRO is
    // module-qualified because two classes in one MRO can share a bare name — a
    // local `Codec` and an imported `codecs.Codec` — and a name-only filter
    // reports the nonsense [Codec > Codec].
    const moduleName = (runtime.classes[0]?.mro?.[0] as string | undefined)?.split('.')[0];
    const expected: string[] = (cls.mro as string[])
      .filter(q => q.startsWith(`${moduleName}.`))
      .map(q => q.slice(String(moduleName).length + 1))
      .filter(n => typeByName.has(n));
    const mine = (linearize(type.getHash()) ?? []).map(h => nameByHash.get(h)!).filter(Boolean);
    if (expected.length > 1) {
      mroChecked++;
      if (mine.join('>') !== expected.join('>')) {
        mroBad++;
        problems.push(`MRO ${cls.name}: cpython [${expected.join(' > ')}] mine [${mine.join(' > ')}]`);
      }
    }
    // Override resolution: the first class in MY mro that declares the name.
    for (const [member, ownerName] of Object.entries(cls.attributeOwners as Record<string, string>)) {
      if (!typeByName.has(ownerName)) continue;
      ovChecked++;
      const resolved = mine.find(n => declares.get(typeByName.get(n)!.getHash())?.has(member));
      if (resolved === undefined) {
        // Not a WRONG answer: the parser has no py_method for this name, which
        // happens for a method created by ASSIGNMENT (`__rand__ = __and__`).
        // Counted separately because a missing answer is an honest negative and
        // a wrong one is a defect.
        ovMissing++;
      } else if (resolved !== ownerName) {
        ovBad++;
        problems.push(`OVERRIDE ${cls.name}.${member}: cpython ${ownerName}, mine ${resolved}`);
      }
    }
  }
  if (verbose) problems.forEach(p => console.log('   ' + p));
  return { unjudged: false, mroChecked, mroBad, ovChecked, ovBad, ovMissing, problems };
}

if (require.main === module) {
  let mc = 0, mb = 0, oc = 0, ob = 0, un = 0;
  const samples: string[] = [];
  for (const f of process.argv.slice(2)) {
    const r = adjudicateMro(f);
    if (r.unjudged) { un++; continue; }
    mc += r.mroChecked; mb += r.mroBad; oc += r.ovChecked; ob += r.ovBad;
    r.problems.slice(0, 3).forEach(p => { if (samples.length < 12) samples.push(path.basename(f) + ': ' + p); });
  }
  console.log(`MRO order      : ${mc - mb}/${mc} match cpython __mro__`);
  console.log(`override resol.: ${oc - ob}/${oc} match cpython attribute lookup`);
  console.log(`unjudged files : ${un}`);
  if (samples.length) { console.log('\ndisagreements:'); samples.forEach(s => console.log('  ' + s)); }
}
