/**
 * BLANK THE BRANCHES THIS EMISSION DOES NOT COMPILE, BEFORE PARSING.
 *
 * tree-sitter parses both arms of a `#if`; Roslyn parses one. That mismatch is
 * the single largest source of C# parse failures, because the published grammar
 * has no rule for a directive in most declaration positions and recovers with
 * an ERROR node — 30 of the 41 shapes it cannot read are preprocessor shapes,
 * and on the BCL stratum they cost 1,890 parse gaps and 11.9 points of recall.
 *
 * None of that is the grammar's fault and none of it needs a fork. The parser
 * already knows which branch this emission takes: the target framework and the
 * define set are inputs, in `cs_module`'s primary key. So the directives and the
 * untaken arms are blanked to WHITESPACE before the grammar ever sees the text,
 * and what it gets is ordinary C#.
 *
 * Measured: 27 of the 30 preprocessor torture fixtures stop erroring.
 *
 * ## Blanked, never removed
 *
 * Every blanked character becomes a space and every newline is kept, so the
 * text stays byte-for-byte the same LENGTH. Offsets, lines and columns are
 * therefore unchanged, and every span the extractors emit still points at the
 * real source. Deleting the regions instead would shift every position after
 * the first directive — which is the defect the BOM fix was about, at the scale
 * of a whole file.
 *
 * ## It also makes branch selection structural
 *
 * The extractors resolve `#if` branches while walking, so a row from an untaken
 * arm was always a possibility that had to be checked for. After blanking the
 * untaken arm is not in the text: no row can come from it, because there is
 * nothing there to walk. That is a stronger guarantee than a check.
 */
import { implicitFrameworkSymbols } from '@/parsers/csharp/extractors/preproc-context';

/**
 * The BASE symbol set a file compiles under: the caller's and the framework's.
 *
 * The file's own `#define`/`#undef` are applied by `blankAndReport` as it
 * walks, not here: a `#define` inside a dead `#if` arm must not apply, and only
 * the walk knows which arms are live. Doing it in a separate pass defined both
 * arms of every `#if`/`#else` pair that guarded a define.
 */
export function resolveFileSymbols(
  targetFramework: string,
  defineConstants: readonly string[]
): Set<string> {
  const symbols = new Set<string>([
    ...defineConstants,
    ...implicitFrameworkSymbols(targetFramework),
  ]);
  // The file's own `#define`/`#undef` are NOT read here. They are applied by
  // `blankAndReport` as it walks, because a `#define` inside a dead `#if` arm
  // must not apply and only the walk knows which arms are live.
  return symbols;
}

/**
 * Evaluates a `#if` condition against the active set.
 *
 * The grammar is deliberately tiny — identifiers, `true`, `false`, `!`, `&&`,
 * `||`, `==`, `!=` and parentheses — and anything outside it is treated as
 * FALSE rather than guessed. A wrong branch is worse than a conservatively
 * dropped one: it puts code in the fact base that this configuration does not
 * compile.
 */
function holds(condition: string, active: ReadonlySet<string>): boolean {
  const text = condition.trim();
  if (!/^[A-Za-z0-9_\s!&|()=]*$/.test(text)) {
    return false;
  }
  const expression = text.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (name) =>
    name === 'true' ? 'true' : name === 'false' ? 'false' : active.has(name) ? 'true' : 'false'
  );
  try {
    // eslint-disable-next-line no-new-func
    return Boolean(new Function(`"use strict"; return (${expression});`)());
  } catch {
    return false;
  }
}

/**
 * The condition of a `#if`/`#elif`, with the trailing comment removed.
 *
 * `#if MODERN   // the new path` is a legal directive whose condition is
 * `MODERN`. The C# grammar for the tail of a directive line is
 * `whitespace? single_line_comment? new_line`, so the comment is not part of
 * the expression — and {@link holds} treats anything outside its tiny
 * expression grammar as FALSE, deliberately. Together those two rules meant a
 * commented `#if` was unparseable, therefore false, therefore took its `#else`:
 * the one arm the file does not compile. It is not a rare spelling. Two of the
 * three classes in the span fixture lost their attribute to it, and
 * `attributeCount` resolved the branch the same way, so the count and the rows
 * agreed about code that is not in the program.
 *
 * A delimited comment is stripped too. Roslyn accepts it in a directive's
 * whitespace, and if one is left unterminated the text falls back to
 * unparseable — which is the conservative answer, not a guess.
 */
function conditionOf(text: string, keyword: 'if' | 'elif'): string {
  return text
    .replace(keyword === 'if' ? /^#\s*if/ : /^#\s*elif/, '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/.*$/, '')
    .trim();
}

/**
 * One conditional region the blanking pass walked over.
 *
 * THE BLANKING PASS IS THE ONLY THING THAT STILL SEES THESE. `cs_preproc_region`
 * was built by walking the tree for `preproc_if` nodes; blanking turns those
 * into whitespace, so the tree has none and the relation came out EMPTY — the
 * `#if` audit trail, gone, as a side effect of fixing `#if` parsing.
 *
 * So the pass that reads the directives reports them. That is the better source
 * anyway: it sees every directive, including the ones in positions where the
 * grammar produced an ERROR rather than a `preproc_if` node, which the tree walk
 * could never have recorded.
 */
export interface BlankedRegion {
  readonly kind: 'IF' | 'ELIF' | 'ELSE';
  readonly conditionText: string;
  readonly conditionSymbols: readonly string[];
  readonly isActive: boolean;
  /**
   * An earlier arm of this chain was taken.
   *
   * Distinct from `!isActive`, and the distinction is the column's reason for
   * existing: an arm can be dead because its own condition was false, or
   * because the chain was already satisfied and its condition was never
   * evaluated at all. Reporting the second as the first claims a condition was
   * tested when it was not.
   */
  readonly earlierTaken: boolean;
  /**
   * What the arm HELD, read from the original text.
   *
   * Shape used to come from the branch's parsed body. A blanked arm has no
   * parsed body, so it is classified from the source lines between this
   * directive and the one that closes the arm — which is the only place the
   * information still exists once the text is whitespace.
   */
  readonly shape: 'TYPE_LEVEL' | 'DECLARATION' | 'STATEMENT' | 'ENUM_MEMBERS' | 'FRAGMENT' | 'EMPTY';
  readonly branchIndex: number;
  /**
   * Index into the report of the arm this one is NESTED IN, or -1 at the top.
   *
   * A nested `#if` is a fact about provenance an engine needs: a declaration
   * inside `#if A` inside `#if B` is in the program only when both hold, and a
   * region row with no parent cannot say so.
   */
  readonly parentIndex: number;
  /** 1-based, and the line of the DIRECTIVE, not of the arm it opens. */
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Classifies an arm from its own source lines.
 *
 * Deliberately coarse and ordered most-specific first. A line that opens a type
 * makes the arm TYPE_LEVEL; a member signature makes it DECLARATION; `case`
 * makes it ENUM_MEMBERS or a switch section; anything with a statement
 * terminator is STATEMENT; nothing at all is EMPTY. Whatever is left is
 * FRAGMENT, which is the honest answer for a partial construct — half a base
 * list, a run of modifiers — and those are exactly the arms the published
 * grammar could not parse anyway.
 */
function shapeOfLines(lines: readonly string[]): BlankedRegion['shape'] {
  const body = lines.map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('//'));
  if (body.length === 0) {
    return 'EMPTY';
  }
  const text = body.join(' ');
  // DECLARATION and TYPE_LEVEL are easy to invert, and the enum is explicit:
  // DECLARATION is TOP-LEVEL — a type, a namespace, a using. TYPE_LEVEL is
  // MEMBERS INSIDE a type. A branch holding `class C { }` is therefore
  // DECLARATION, not TYPE_LEVEL, however type-ish it reads.
  if (
    /\b(class|struct|interface|record|enum|delegate)\s+\w/.test(text) ||
    /^\s*(namespace|using)\b/.test(body[0]!)
  ) {
    return 'DECLARATION';
  }
  if (/^\s*case\b/.test(body[0]!) || body.every((l) => /^\w+(\s*=\s*[^,]+)?,?$/.test(l))) {
    return 'ENUM_MEMBERS';
  }
  // A member of a type: a signature, an accessor, a field. `(` after a
  // modifier or a return type is the tell; a terminated line with a modifier
  // and no `(` is a field.
  if (/\b(public|private|protected|internal|static|virtual|override|abstract|async|void|event)\b/.test(text)) {
    return 'TYPE_LEVEL';
  }
  if (text.endsWith(';') || text.endsWith('}')) {
    return 'STATEMENT';
  }
  return 'FRAGMENT';
}

/** A line of spaces the same length as the one it replaces. */
const blankOf = (line: string): string => ' '.repeat(line.length);

/**
 * Blanks every conditional directive and every arm this emission does not take.
 *
 * Nested `#if` is handled by the stack: an arm inside an untaken arm is untaken
 * whatever its own condition says, which is why `taken` is ANDed with the
 * enclosing frame rather than read on its own.
 */
export function blankInactiveRegions(source: string, active: ReadonlySet<string>): string {
  return blankAndReport(source, active).text;
}

/** The identifiers a condition names, in source order, deduplicated. */
function symbolsOf(condition: string): string[] {
  const out = new Set<string>();
  for (const name of condition.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []) {
    if (name !== 'true' && name !== 'false') {
      out.add(name);
    }
  }
  return [...out];
}

/**
 * Blanks, and REPORTS every conditional region it walked over.
 *
 * The report is what `cs_preproc_region` is built from now. A branch's
 * `endLine` is the line of the directive that closes it — `#elif`, `#else` or
 * `#endif` — so the arms of one chain tile the region without overlapping.
 */
export function blankAndReport(
  source: string,
  active: ReadonlySet<string>
): { readonly text: string; readonly regions: readonly BlankedRegion[] } {
  if (!source.includes('#')) {
    return { text: source, regions: [] };
  }
  // The symbol set EVOLVES as the file is walked, because that is what a
  // preprocessor does. A `#define` inside a dead arm must not apply, and a
  // `#define` before a later `#if` must. Resolving the prologue in a separate
  // pass got this wrong: it applied every `#define` it saw, so a file with
  //
  //     #if PLATFORM_A
  //     #define USE_PRIMARY
  //     #else
  //     #define USE_FALLBACK
  //     #endif
  //
  // came out with BOTH defined and every branch keyed on either of them took
  // the wrong arm.
  const symbols = new Set<string>(active);
  const lines = source.split('\n');
  const out: string[] = [];
  const regions: BlankedRegion[] = [];
  /** `taken` — this arm is live. `satisfied` — some earlier arm already was. */
  const stack: { taken: boolean; satisfied: boolean; open: number[] }[] = [];
  /** The arm currently enclosing anything new: the innermost open arm. */
  const enclosing = (): number => {
    const frame = stack[stack.length - 1];
    const index = frame?.open[frame.open.length - 1];
    return index ?? -1;
  };
  /**
   * Closes the arm a directive opened, and classifies it.
   *
   * The arm's shape can only be read once its extent is known, which is when
   * the NEXT directive arrives — so both the end line and the shape are filled
   * in here rather than at the opening directive.
   */
  const closeOpenArm = (frame: { open: number[] } | undefined, line: number): void => {
    const index = frame?.open[frame.open.length - 1];
    const region = index === undefined ? undefined : regions[index];
    if (index === undefined || region === undefined) {
      return;
    }
    regions[index] = {
      ...region,
      endLine: line,
      shape: shapeOfLines(lines.slice(region.startLine, line - 1)),
    };
  };
  const insideDeadArm = (): boolean => stack.some((frame) => !frame.taken);
  const live = (): boolean => !insideDeadArm();

  for (const [index, line] of lines.entries()) {
    const text = line.trim();
    if (/^#\s*if\b/.test(text)) {
      const condition = conditionOf(text, 'if');
      const live = holds(condition, symbols);
      const taken = live && !insideDeadArm();
      // Captured BEFORE the frame is pushed, so it names the arm this `#if`
      // sits inside rather than itself.
      const parentIndex = enclosing();
      stack.push({ taken, satisfied: live, open: [regions.length] });
      regions.push({
        kind: 'IF',
        conditionText: condition,
        conditionSymbols: symbolsOf(condition),
        isActive: taken,
        earlierTaken: false,
        shape: 'EMPTY',
        branchIndex: 0,
        parentIndex,
        startLine: index + 1,
        endLine: index + 1,
      });
      out.push(blankOf(line));
      continue;
    }
    if (/^#\s*elif\b/.test(text)) {
      const frame = stack[stack.length - 1];
      if (frame !== undefined) {
        closeOpenArm(frame, index + 1);
        const condition = conditionOf(text, 'elif');
        const live = holds(condition, symbols);
        const alreadySatisfied = frame.satisfied;
        frame.taken = live && !frame.satisfied && !stack.slice(0, -1).some((f) => !f.taken);
        frame.satisfied = frame.satisfied || live;
        frame.open.push(regions.length);
        regions.push({
          kind: 'ELIF',
          conditionText: condition,
          conditionSymbols: symbolsOf(condition),
          isActive: frame.taken,
          earlierTaken: alreadySatisfied,
          shape: 'EMPTY',
          branchIndex: frame.open.length - 1,
          // An `#elif`/`#else` shares its `#if`'s parent: they are arms of one
          // chain, not children of each other.
          parentIndex: regions[frame.open[0]!]?.parentIndex ?? -1,
          startLine: index + 1,
          endLine: index + 1,
        });
      }
      out.push(blankOf(line));
      continue;
    }
    if (/^#\s*else\b/.test(text)) {
      const frame = stack[stack.length - 1];
      if (frame !== undefined) {
        closeOpenArm(frame, index + 1);
        const alreadySatisfied = frame.satisfied;
        frame.taken = !frame.satisfied && !stack.slice(0, -1).some((f) => !f.taken);
        frame.satisfied = true;
        frame.open.push(regions.length);
        regions.push({
          kind: 'ELSE',
          conditionText: '',
          conditionSymbols: [],
          isActive: frame.taken,
          earlierTaken: alreadySatisfied,
          shape: 'EMPTY',
          branchIndex: frame.open.length - 1,
          // Arms of one chain share the `#if`'s parent; they are not children
          // of each other.
          parentIndex: regions[frame.open[0]!]?.parentIndex ?? -1,
          startLine: index + 1,
          endLine: index + 1,
        });
      }
      out.push(blankOf(line));
      continue;
    }
    if (/^#\s*endif\b/.test(text)) {
      closeOpenArm(stack[stack.length - 1], index + 1);
      stack.pop();
      out.push(blankOf(line));
      continue;
    }
    const directive = /^#\s*(define|undef)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text);
    if (directive !== null) {
      // The SYMBOL only — `#define X // why` must not define "X // why".
      if (live()) {
        if (directive[1] === 'define') {
          symbols.add(directive[2]!);
        } else {
          symbols.delete(directive[2]!);
        }
      }
      // A directive is not code; blank it so the grammar never sees it.
      out.push(blankOf(line));
      continue;
    }
    out.push(insideDeadArm() ? blankOf(line) : line);
  }
  return { text: out.join('\n'), regions };
}
