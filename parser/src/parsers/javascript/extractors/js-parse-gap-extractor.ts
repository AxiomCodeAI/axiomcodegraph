import * as ts from 'typescript';

import { JsCallSiteRegistry } from '@/analysis-types/javascript/JsCallSiteRegistry';
import { JsExpressionRegistry } from '@/analysis-types/javascript/JsExpressionRegistry';
import { JsImportRegistry } from '@/analysis-types/javascript/JsImportRegistry';
import { JsParseGapRegistry } from '@/analysis-types/javascript/JsParseGapRegistry';
import { JsScopeRegistry } from '@/analysis-types/javascript/JsScopeRegistry';
import { JsTypeReferenceRegistry } from
  '@/analysis-types/javascript/JsTypeReferenceRegistry';
import { JsParseGapKind } from '@/enums/javascript/parse-gaps';
import { JsScopeKind } from '@/enums/javascript/scopes';
import { JsSpecifierKind } from '@/enums/javascript/imports';
import { JsTypeReferenceKind } from '@/enums/javascript/type-references';
import { parseDiagnosticsOf, pointAtOffset } from '@/utils/javascript';

/**
 * `js_parse_gap` — what the parser could not do, recorded as **data rather than
 * a log line**.
 *
 * ## Why a relation and not a warning
 *
 * §9 of `BUILDING-A-PARSER.md`: *if the analyzer drops something for a
 * structural reason, it must say so.* On one large framework checkout a nested config silently
 * excluded 1,270 of 1,821 files and **nothing counted them** — the run reported
 * success with a fact base missing two thirds of the project.
 *
 * A log line is not a count, and a count that is not in the fact base cannot be
 * joined against the rows that are. `relatedRelation` and `relatedLinkHash` name
 * the row the gap is about, so a consumer can ask "what is missing from
 * `js_call_site` here" and get an answer rather than a number.
 *
 * ## It reads the emitted rows rather than instrumenting the passes
 *
 * Every gap below is already visible in the fact base — an import with
 * `specifierKind = NON_LITERAL`, a type reference with
 * `referenceKind = UNKNOWN_SYNTAX`, an expression with `isTruncated`. Deriving
 * the gaps from those rows rather than threading a reporter through five
 * extractors means the two can never disagree: a gap row exists exactly when the
 * fact it describes is in the relation it names.
 *
 * The one exception is a **parse diagnostic**, which is not in any relation
 * because the construct it concerns never became a row at all.
 */
export interface ParseGapOptions {
  readonly sourceFile: ts.SourceFile;
  readonly moduleHash: string;
  readonly serviceVersionLinkHash: string;
  readonly imports: readonly JsImportRegistry[];
  readonly typeReferences: readonly JsTypeReferenceRegistry[];
  readonly expressions: readonly JsExpressionRegistry[];
  readonly callSites: readonly JsCallSiteRegistry[];
  readonly scopes: readonly JsScopeRegistry[];
  readonly hasFlowPragma: boolean;
  /**
   * Is the file's own top-level scope strict?
   *
   * Decides whether a strict-mode-only grammar diagnostic is a real gap. See
   * {@link STRICT_MODE_ONLY_DIAGNOSTICS}.
   */
  readonly isStrictModeFile: boolean;
}

export function extractParseGaps(options: ParseGapOptions): JsParseGapRegistry[] {
  const out: JsParseGapRegistry[] = [];
  // The same gap, reported twice, is one gap.
  //
  // `ts.createSourceFile` recovers from an unterminated JSX element by emitting
  // `1005: '</' expected.` ELEVEN TIMES at the same offset — a cascade, not
  // eleven problems. Over 4,561 files that produced 194 duplicate primary keys
  // out of 196, and a duplicate PK does not collide, it DOUBLES: a consumer
  // asking how much the parser failed to do at that position would have been
  // told eleven times as much.
  //
  // Widening the key does not fix this and cannot: the rows are identical in
  // every column, so they are identical facts. They are dropped here, where the
  // knowledge that a compiler repeats itself belongs, and the key stays
  // discriminating so two DIFFERENT gaps at one position still make two rows.
  const minted = new Set<string>();
  const mint = (init: {
    gapKind: JsParseGapKind;
    detail: string;
    relatedRelation: string;
    relatedLinkHash: string;
    startLine: number;
    startColumn: number;
    isRecoverable: boolean;
  }): void => {
    const row = new JsParseGapRegistry({
      ...init,
      ownerModuleLinkHash: options.moduleHash,
      serviceVersionLinkHash: options.serviceVersionLinkHash,
    });
    if (minted.has(row.getHash())) {
      return;
    }
    minted.add(row.getHash());
    out.push(row);
  };

  // Parse diagnostics. Should be rare — zero over 25.9 MB of TypeScript — and
  // emitted anyway, because an always-empty relation that suddenly has rows is a
  // signal and a missing relation is a silence.
  for (const diagnostic of parseDiagnosticsOf(options.sourceFile)) {
    if (!options.isStrictModeFile
      && STRICT_MODE_ONLY_DIAGNOSTICS.has(diagnostic.code)) {
      // NOT a gap. TypeScript applies these grammar rules unconditionally
      // because it has no sloppy mode to be in; in a sloppy CommonJS file the
      // construct is legal, `node --check` accepts it, and — verified on
      // `cjs/hoisting/sloppy-implicit-global.js` — every row is still emitted:
      // the literals, the bindings, all of it. Minting a PARSE_ERROR here would
      // report a defect that does not exist, which §7 says is as wrong as
      // hiding one.
      //
      // Narrow on purpose: exactly the codes whose rule is "…in strict mode",
      // and only when the file is not in it. A genuine syntax error still
      // produces a row.
      continue;
    }
    const at = pointAtOffset(diagnostic.start ?? 0, options.sourceFile);
    mint({
      gapKind: JsParseGapKind.PARSE_ERROR,
      detail: `${diagnostic.code}: `
        + ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      relatedRelation: 'js_module',
      relatedLinkHash: options.moduleHash,
      startLine: at.startLine,
      startColumn: at.startColumn,
      // The compiler recovers and produces a tree, so the rest of the file is
      // still extracted. The gap says which part was not.
      isRecoverable: true,
    });
  }

  // `require(variable)`. Unresolvable BY CONSTRUCTION, and the row already says
  // so — this makes it countable alongside every other thing the parser
  // declined to answer, rather than only discoverable by filtering js_import.
  for (const row of options.imports) {
    if (row.specifierKind === JsSpecifierKind.STRING_LITERAL) {
      continue;
    }
    mint({
      gapKind: JsParseGapKind.NON_LITERAL_SPECIFIER,
      detail: row.specifier,
      relatedRelation: 'js_import',
      relatedLinkHash: row.getHash(),
      startLine: row.startLine,
      startColumn: row.startColumn,
      // Not recoverable by any amount of static analysis: the specifier's value
      // is a runtime fact.
      isRecoverable: false,
    });
  }

  // A JSDoc type expression that could not be decomposed. EXPECTED to be
  // non-empty: JSDoc type syntax is not standardised, and Closure, TypeScript
  // and jsdoc.app all differ. The text is preserved on the type-reference row.
  for (const row of options.typeReferences) {
    if (row.referenceKind !== JsTypeReferenceKind.UNKNOWN_SYNTAX) {
      continue;
    }
    mint({
      gapKind: JsParseGapKind.UNKNOWN_JSDOC_SYNTAX,
      detail: row.typeName,
      relatedRelation: 'js_type_reference',
      relatedLinkHash: row.getHash(),
      startLine: row.startLine,
      startColumn: row.startColumn,
      isRecoverable: true,
    });
  }

  // The depth cap fired and a subtree was dropped. 32, not TypeScript's
  // effective 20: the corpus reaches depth 67 with a p99 of 26.
  for (const row of options.expressions) {
    if (!row.wasTruncated()) {
      continue;
    }
    mint({
      gapKind: JsParseGapKind.DEPTH_CAP_REACHED,
      detail: row.expressionKind,
      relatedRelation: 'js_expression',
      relatedLinkHash: row.getHash(),
      startLine: row.startLine,
      startColumn: row.startColumn,
      isRecoverable: true,
    });
  }

  // `eval` and `new Function`. The call IS emitted — a fact base that omits it
  // asserts the program has no dynamic code, which is a stronger claim than
  // admitting one call cannot be followed — and the gap says the target is not.
  for (const row of options.callSites) {
    if (!row.isDynamicCode) {
      continue;
    }
    mint({
      gapKind: JsParseGapKind.DYNAMIC_CODE,
      detail: row.calleeText,
      relatedRelation: 'js_call_site',
      relatedLinkHash: row.getHash(),
      startLine: row.startLine,
      startColumn: row.startColumn,
      isRecoverable: false,
    });
  }

  // A `with` body, where NO name is statically resolvable. The honest answer is
  // to mark the scope rather than emit confident bindings that may all be wrong.
  for (const row of options.scopes) {
    if (row.scopeKind !== JsScopeKind.WITH) {
      continue;
    }
    mint({
      gapKind: JsParseGapKind.WITH_STATEMENT_SCOPE,
      detail: 'every name in this body may be shadowed by the with object',
      relatedRelation: 'js_scope',
      relatedLinkHash: row.getHash(),
      startLine: row.startLine,
      startColumn: row.startColumn,
      isRecoverable: false,
    });
  }

  // A `@flow` pragma. `ts.createSourceFile` parses the grammar Flow shares with
  // TypeScript and MIS-PARSES the rest silently, so this row is the only place
  // the disagreement becomes visible at all.
  if (options.hasFlowPragma) {
    mint({
      gapKind: JsParseGapKind.FLOW_SYNTAX,
      detail: 'file carries a @flow pragma; syntax outside the shared grammar is mis-parsed',
      relatedRelation: 'js_module',
      relatedLinkHash: options.moduleHash,
      startLine: 1,
      startColumn: 1,
      isRecoverable: true,
    });
  }

  return out;
}

/**
 * Grammar rules TypeScript enforces unconditionally that apply only in strict
 * mode.
 *
 * `ts.createSourceFile` has no sloppy mode, so it reports these on code that is
 * legal in a non-strict CommonJS file and that Node — the schema's named second
 * oracle — accepts. The nodes are produced either way, so nothing is lost and
 * nothing should be reported.
 *
 * ## The general rule, now ruled and written down
 *
 * `js-oracle` reproduced this rather than taking it on report — on
 * `var mode = 0777` tsc emits 1121/1487 and the AST is complete, zero unbuilt
 * nodes — and generalised it so the next case needs no ruling:
 *
 * > **`js_parse_gap` asserts a row is missing. Where no row is missing there is
 * > no gap — whatever the compiler says.**
 *
 * This set is the operational form of that rule for the class of diagnostics
 * where completeness has actually been verified. Widening it means doing the
 * same check, not assuming: confirm the rows are emitted, then add the code.
 *
 * There is deliberately no `gapKind` for oracle disagreement. A tsc-versus-Node
 * disagreement belongs in `../parser-oracle/javascript/` beside the V8
 * adjudicator — the same place `resolverAgreement` went, and for the same
 * reason: recording it here would mean the parser running two resolvers.
 */
const STRICT_MODE_ONLY_DIAGNOSTICS: ReadonlySet<number> = new Set([
  1121,  // Octal literals are not allowed. Use the syntax '0o755'.
  1487,  // Octal escape sequences are not allowed. Use the syntax '\x41'.
  1210,  // Code contained in a class is evaluated in strict mode…
  1212,  // Identifier expected. '{0}' is a reserved word in strict mode.
  1213,  // …in strict mode. Class definitions are automatically in strict mode.
  1214,  // …in strict mode. Modules are automatically in strict mode.
  1215,  // Invalid use of '{0}'. Modules are automatically in strict mode.
  1250,  // Function declarations are not allowed inside blocks in strict mode…
  1251,  // …when targeting 'ES5'. Class definitions are automatically in strict mode.
  1252,  // …when targeting 'ES5'. Modules are automatically in strict mode.
]);
