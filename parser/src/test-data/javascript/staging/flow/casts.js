/* @flow */
// fixture: flow/casts.js
// module system: ESM  (governing: staging/flow/package.json, "type": "module")
// nature: runtime-bearing — a Flow cast is erased, and the expression inside it
//   runs. `(x: number)` evaluates `x`.
// expected provenance: FLOW_REJECTED — and if it is ever PROJECT again, four js_parse_gap rows sharing one primary key come back
// syntax floor: Flow cast expressions, from flow.org/en/docs/types/casting
//
// THE LOUD HALF, and the one that stresses ERROR RECOVERY rather than
// classification. A Flow cast `(expr: Type)` is a parenthesised expression with
// a type annotation, which TypeScript's expression grammar has no production
// for — so every one below sends the parser into recovery, and recovery is
// where duplicate rows come from.
//
// ## Why this fixture is about primary keys — MEASURED, through the extractor
//
// `js_parse_gap`'s PK is `(ownerModule, gapKind, startLine, startColumn)`. Every
// parse diagnostic is minted with `gapKind = PARSE_ERROR`, so **the diagnostic
// CODE is not in the key**: any two diagnostics at one line and column produce
// two rows with one primary key. Duplicates DOUBLE, they do not collide, and
// nothing about the output looks wrong.
//
// Run against this file, the parser emits **four `js_parse_gap` rows sharing one
// primary key**, all at column 1 of the line ONE PAST THE LAST — that is,
// `start = the file's length` — each a zero-length `1005: '</' expected.`
// The line number is deliberately not quoted here: editing this comment moves
// it, and a repro that cites a line number rots the first time anyone touches
// the file.
//
// The mechanism joins two decisions that are each defensible alone:
//
//   1. `ScriptKind.JS` carries `languageVariant = JSX` — which is the schema's
//      own stated reason for ruling `scriptKind` provenance-only (§0.0: 0 of
//      2,942 files parse differently between JS and JSX). So `Array<number>` in
//      a position the type grammar cannot accept is read as an **unterminated
//      JSX element**, and the recovery runs to end of file.
//   2. The parse-gap PK omits the diagnostic code.
//
// Neither is wrong by itself. Together, Flow generics become unterminated JSX,
// the diagnostics pile up at one offset, and the rows collapse to one key.
//
// ## What I could NOT reproduce, recorded so nobody re-derives it
//
// A minimal synthetic version does **not** reproduce this. N casts of the form
// `(raw: Array<number>)` in an otherwise empty module produce N diagnostics and
// **zero** at EOF, for N in 0,1,2,3,5,8. I expected the count to be linear in
// the number of generic casts; it is not. Bisecting this file shows the EOF
// count moving up AND down as later lines are added — it rose to five and fell
// back to four twice while I bisected — because an unterminated JSX element
// swallows whatever follows it.
//
// So the collision is an emergent property of a realistic file, not of any one
// construct — which is the argument for this fixture existing rather than a
// three-line regression test. Do not "simplify" it: the simplification does not
// reproduce.
//
// ## It discriminates under all three rulings
//
//   distinct scriptKind — a Flow parser reads these as casts: no gap, no recovery
//   explicit rejection  — zero rows, and the collision cannot occur
//   emit-with-residual  — recovery runs, and whether the residual is deduped by
//                         primary key is exactly what this file asks


const raw: mixed = JSON.parse('{}');
declare function f(x: number): string;
declare function g(): number;
class C { constructor(x: number) { this.x = x; } }
const p: Promise<string> = Promise.resolve('a');
const obj = { a: 1 };

// --- one cast per line: the attributable case ---------------------------------

const simple = (raw: string);
const ofCall = (g(): number);
const ofNew = (new C(1): C);
const ofObject = ({ a: 1 }: { a: number });
const ofArray = ([1, 2]: Array<number>);
const ofMember = (obj.a: number);
const ofTemplate = (`t`: string);

// The double cast — Flow's documented escape hatch for an unsafe conversion,
// `(value: any: Target)`. Two annotations, one parenthesised expression.
const doubleCast = ((raw: any): string);

// A cast whose result is immediately used, so the recovery has to rejoin the
// expression grammar rather than just skip to the next statement.
const thenMember = (raw: string).length;
const thenCall = (raw: Object).toString();
const thenIndex = (raw: Array<number>)[0];
const inBinary = (raw: number) + 1;
const inTernary = (raw: boolean) ? 1 : 2;
const inSpread = [...(raw: Array<number>)];

// --- casts in argument, return and arrow-body position ---------------------------

function consume(x: string): number { return x.length; }
const asArgument = consume((raw: string));
function returnsCast(): string { return (raw: string); }
const arrowBody = () => (raw: string);
const arrowBlock = () => { return (raw: string); };

// --- casts inside an await and a template substitution ----------------------------

export async function awaited(): Promise<number> {
  const v = (await p: string);
  return v.length;
}
const inTemplateSub = `${(raw: string)}`;

// --- TWO casts on ONE line: the stacked case --------------------------------------
//
// If recovery reports more than one diagnostic at the same column, or emits more
// than one node over the same span, these lines are where it shows.

const twoOnALine = (raw: string), alsoOnIt = (raw: number);
const nested = ((raw: any): (string));
const adjacent = [(raw: string), (raw: number), (raw: boolean)];
const chained = ((raw: A): B);

// --- a cast in a position that is ALSO valid JavaScript ------------------------------
//
// The control. `(a, b)` is a comma expression and `(x)` is a parenthesised
// identifier; neither is a cast, and neither may produce a gap. A recogniser
// that treats every parenthesised expression as a possible cast trips here.

const commaExpression = (raw, obj);
const justParens = (raw);
const arrowParams = (a, b) => a + b;
const iife = (function () { return 1; })();

export { simple, ofCall, ofNew, ofObject, ofArray, ofMember, ofTemplate,
  doubleCast, thenMember, thenCall, thenIndex, inBinary, inTernary, inSpread,
  asArgument, returnsCast, arrowBody, arrowBlock, inTemplateSub,
  twoOnALine, alsoOnIt, nested, adjacent, chained,
  commaExpression, justParens, arrowParams, iife };
