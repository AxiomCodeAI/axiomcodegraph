/**
 * The slice of semver a Deno import needs: does a locked or cached version satisfy
 * the range a specifier wrote, and which of several is the highest.
 *
 * `jsr:@std/path@^1.0.0` and `npm:zod@~3.23` name RANGES. The version actually
 * used is in `deno.lock`, or, without a lockfile, is the highest one the cache
 * holds. The lockfile's own specifier keys cannot be looked up by the written
 * range (Deno normalises `^1.0.0` to `1` there), so the range is matched against
 * the locked VERSIONS instead, which is the same answer without depending on how
 * a given Deno release spells its keys.
 *
 * Supported: exact, `^`, `~`, `x`/`*` wildcards, partial versions (`1`, `1.2`),
 * comparators (`>=1.2 <2`), hyphen ranges and `||`. Pre-release versions satisfy
 * only a range that names the same pre-release base, as in npm.
 */

interface Version {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly pre: readonly string[];
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | undefined {
  const m = VERSION.exec(text.trim());
  if (!m) {
    return undefined;
  }
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    pre: m[4] ? m[4].split('.') : [],
  };
}

export function compareVersions(a: string, b: string): number {
  const va = parseVersion(a);
  const vb = parseVersion(b);
  if (!va || !vb) {
    return va ? 1 : vb ? -1 : a.localeCompare(b);
  }
  return compare(va, vb);
}

function compare(a: Version, b: Version): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre.length === 0 || b.pre.length === 0) {
    return (a.pre.length === 0 ? 1 : 0) - (b.pre.length === 0 ? 1 : 0);
  }
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i];
    const y = b.pre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const nx = /^\d+$/.test(x) ? Number(x) : undefined;
    const ny = /^\d+$/.test(y) ? Number(y) : undefined;
    if (nx !== undefined && ny !== undefined) {
      if (nx !== ny) return nx - ny;
    } else if (nx !== undefined) {
      return -1;
    } else if (ny !== undefined) {
      return 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

/** The highest of `versions` that satisfies `range`, or `undefined`. */
export function maxSatisfying(versions: Iterable<string>, range: string): string | undefined {
  let best: string | undefined;
  for (const v of versions) {
    if (satisfies(v, range) && (best === undefined || compareVersions(v, best) > 0)) {
      best = v;
    }
  }
  return best;
}

type Comparator = { readonly op: '<' | '<=' | '>' | '>=' | '='; readonly v: Version };

export function satisfies(versionText: string, rangeText: string): boolean {
  const version = parseVersion(versionText);
  if (!version) {
    return false;
  }
  const range = rangeText.trim();
  if (range === '' || range === '*' || range === 'latest' || range === 'x') {
    return version.pre.length === 0;
  }
  return range.split('||').some((alternative) => {
    const comparators = parseAlternative(alternative.trim());
    if (comparators === undefined) {
      return false;
    }
    if (!comparators.every((c) => test(version, c))) {
      return false;
    }
    // A pre-release only satisfies a range one of whose comparators names a
    // pre-release on the same major.minor.patch.
    return version.pre.length === 0 || comparators.some((c) => c.v.pre.length > 0
      && c.v.major === version.major && c.v.minor === version.minor && c.v.patch === version.patch);
  });
}

function test(v: Version, c: Comparator): boolean {
  const d = compare(v, c.v);
  switch (c.op) {
    case '<': return d < 0;
    case '<=': return d <= 0;
    case '>': return d > 0;
    case '>=': return d >= 0;
    default: return d === 0;
  }
}

/** A partial version: `1`, `1.2`, `1.2.3-pre`, with `x`/`*` for a missing part. */
interface Partial {
  readonly major?: number;
  readonly minor?: number;
  readonly patch?: number;
  readonly pre: readonly string[];
}

function parsePartial(text: string): Partial | undefined {
  const m = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(text);
  if (!m) {
    return undefined;
  }
  const part = (s: string | undefined): number | undefined =>
    s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s);
  const major = part(m[1]);
  const minor = major === undefined ? undefined : part(m[2]);
  const patch = minor === undefined ? undefined : part(m[3]);
  return { major, minor, patch, pre: m[4] ? m[4].split('.') : [] };
}

const v = (major: number, minor: number, patch: number, pre: readonly string[] = []): Version =>
  ({ major, minor, patch, pre });

function parseAlternative(text: string): Comparator[] | undefined {
  const hyphen = /^(\S+)\s+-\s+(\S+)$/.exec(text);
  if (hyphen) {
    const lo = parsePartial(hyphen[1]!);
    const hi = parsePartial(hyphen[2]!);
    if (!lo || !hi) return undefined;
    const out: Comparator[] = [{ op: '>=', v: floor(lo) }];
    if (hi.major === undefined) return out;
    if (hi.minor === undefined) return [...out, { op: '<', v: v(hi.major + 1, 0, 0) }];
    if (hi.patch === undefined) return [...out, { op: '<', v: v(hi.major, hi.minor + 1, 0) }];
    return [...out, { op: '<=', v: v(hi.major, hi.minor, hi.patch, hi.pre) }];
  }
  const out: Comparator[] = [];
  // `>= 1.2` is legal spelling; glue an operator to the version that follows it.
  const tokens = text.replace(/(>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter((t) => t !== '');
  for (const token of tokens) {
    const parsed = comparatorsOf(token);
    if (parsed === undefined) return undefined;
    out.push(...parsed);
  }
  return out;
}

function floor(p: Partial): Version {
  return v(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.pre);
}

function comparatorsOf(token: string): Comparator[] | undefined {
  const m = /^(\^|~>?|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!m) return undefined;
  const op = m[1] ?? '';
  const p = parsePartial(m[2]!);
  if (!p) return undefined;
  if (p.major === undefined) {
    return op === '<' || op === '>' ? [{ op: '<', v: v(0, 0, 0) }] : [];
  }
  const lo = floor(p);
  switch (op) {
    case '^': {
      if (p.major > 0 || p.minor === undefined) return [{ op: '>=', v: lo }, { op: '<', v: v(p.major + 1, 0, 0) }];
      if (p.minor > 0 || p.patch === undefined) return [{ op: '>=', v: lo }, { op: '<', v: v(0, p.minor + 1, 0) }];
      return [{ op: '>=', v: lo }, { op: '<', v: v(0, 0, p.patch + 1) }];
    }
    case '~':
    case '~>': {
      if (p.minor === undefined) return [{ op: '>=', v: lo }, { op: '<', v: v(p.major + 1, 0, 0) }];
      return [{ op: '>=', v: lo }, { op: '<', v: v(p.major, p.minor + 1, 0) }];
    }
    case '>': {
      if (p.minor === undefined) return [{ op: '>=', v: v(p.major + 1, 0, 0) }];
      if (p.patch === undefined) return [{ op: '>=', v: v(p.major, p.minor + 1, 0) }];
      return [{ op: '>', v: lo }];
    }
    case '>=': return [{ op: '>=', v: lo }];
    case '<': return [{ op: '<', v: lo }];
    case '<=': {
      if (p.minor === undefined) return [{ op: '<', v: v(p.major + 1, 0, 0) }];
      if (p.patch === undefined) return [{ op: '<', v: v(p.major, p.minor + 1, 0) }];
      return [{ op: '<=', v: lo }];
    }
    default: {
      // A bare partial is an x-range: `1` is >=1.0.0 <2.0.0, `1.2` is >=1.2.0 <1.3.0.
      if (p.minor === undefined) return [{ op: '>=', v: lo }, { op: '<', v: v(p.major + 1, 0, 0) }];
      if (p.patch === undefined) return [{ op: '>=', v: lo }, { op: '<', v: v(p.major, p.minor + 1, 0) }];
      return [{ op: '=', v: lo }];
    }
  }
}
