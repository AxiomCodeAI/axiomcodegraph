import { JsCallKind, JsReceiverTypeSource } from '@/enums/javascript/call-sites';
import { JsImportResolutionOutcome } from '@/enums/javascript/imports';
import { JsFileFacts } from '@/parsers/javascript/extractors/js-fact-extractor';

/**
 * IR completeness — the measure that replaces "resolution rate".
 *
 * ## Why "what fraction did the parser resolve" is the wrong question
 *
 * The parser emits IR; the engine resolves. Java is the proof:
 * `referencedTypeRegistryLinkHash` is populated **0 times in 67,938 rows**, and
 * that is the design rather than an oversight. Asking a parser built on that
 * principle what fraction it resolved gets the answer zero, correctly, and
 * learns nothing.
 *
 * The right question is whether **every hop an engine would need was emitted**.
 * A receiver whose type lives in another file needs three things and only three:
 * the declared type name as written, the importing module, and the import's
 * `resolvedFilePath`. If those are present the row is complete *even though the
 * parser resolved nothing*.
 *
 * ## The 52.6% ceiling sizes this; it does not cap it
 *
 * The oracle — tsc with `checkJs` — decides 50,740 of 96,544 call sites. That
 * number is what the oracle's gates are sized against, and it is **not** a bound
 * on completeness: a call the checker declines can still have every hop present,
 * which is precisely the `const x = require('y'); x.foo()` case that accounts for
 * 34.4% of the declines.
 *
 * ## Reported PER BUCKET, never as one number
 *
 * A single percentage hides which hop is missing, and the buckets are not
 * interchangeable — `AMBIENT_BUILTIN_TARGET` is a statement about the platform
 * and `RECEIVER_UNTYPED` is a statement about the code. Collapsing them would
 * report a defect population that does not exist, which §7 is entirely about.
 *
 * Two of the buckets are **complete because they say so**: a computed callee and
 * a dynamic-code call are honest terminals, not misses. A gate that counts them
 * as incomplete is measuring the language rather than the parser.
 */
export interface CompletenessBucket {
  readonly total: number;
  readonly complete: number;
}

export interface IrCompletenessReport {
  /** Receiver or callee declared in this file, with a binding link. */
  readonly sameFile: CompletenessBucket;
  /** Reached through an import that carries `resolvedFilePath`. */
  readonly importHop: CompletenessBucket;
  /** Typed only by JSDoc, with the type reference emitted. */
  readonly jsdocTyped: CompletenessBucket;
  /** In the `lib_*` population: a Node builtin or an ECMAScript intrinsic. */
  readonly ambientTarget: CompletenessBucket;
  /** `obj[expr]()` and `eval` — complete BECAUSE they say the name is not fixed. */
  readonly honestlyUnresolvable: CompletenessBucket;
  /** Everything else: a receiver with no channel at all. */
  readonly untyped: CompletenessBucket;
  /**
   * The failure that matters, counted on its own.
   *
   * A call site whose receiver came through an import and which carries **no**
   * `importLinkHash` is unreconstructable by any engine — and it is invisible to
   * every count-based check, because the row exists and is correctly positioned.
   */
  readonly importHopMissing: number;
  readonly callSites: number;
}

/**
 * The running totals, and the reason this measure FOLDS rather than collects.
 *
 * ## Retaining every file's facts is the ceiling, and it was being retained
 *
 * The analyzer streamed its rows to per-relation writers and then pushed the
 * same objects onto an array so this function could run at the end. The comment
 * above that push named it as "the ceiling §10 identifies as the single
 * highest-value architectural change available" — and then did it, which meant
 * peak memory was the ENTIRE fact base as live objects, strictly larger than the
 * CSV it had just finished streaming.
 *
 * It survived an 816-file corpus. At 4,561 files the run died with
 * `FATAL ERROR: Ineffective mark-compacts near heap limit` after 336 seconds,
 * having already written most of its output correctly — the worst shape of
 * failure, because the cost is paid before the crash and the crash names no
 * cause.
 *
 * Nothing in the loop was ever cross-file: every bucket increment depends only
 * on the file in hand. So the measure folds, the facts are released as soon as
 * their rows are appended, and memory is now flat in the number of files.
 */
export interface CompletenessAccumulator {
  readonly sameFile: { total: number; complete: number };
  readonly importHop: { total: number; complete: number };
  readonly jsdocTyped: { total: number; complete: number };
  readonly ambientTarget: { total: number; complete: number };
  readonly honestlyUnresolvable: { total: number; complete: number };
  readonly untyped: { total: number; complete: number };
  importHopMissing: number;
  callSites: number;
}

export function createCompletenessAccumulator(): CompletenessAccumulator {
  return {
    sameFile: { total: 0, complete: 0 },
    importHop: { total: 0, complete: 0 },
    jsdocTyped: { total: 0, complete: 0 },
    ambientTarget: { total: 0, complete: 0 },
    honestlyUnresolvable: { total: 0, complete: 0 },
    untyped: { total: 0, complete: 0 },
    importHopMissing: 0,
    callSites: 0,
  };
}

/** The report, once every file has been folded in. */
export function finishCompleteness(
  accumulator: CompletenessAccumulator
): IrCompletenessReport {
  return {
    sameFile: accumulator.sameFile,
    importHop: accumulator.importHop,
    jsdocTyped: accumulator.jsdocTyped,
    ambientTarget: accumulator.ambientTarget,
    honestlyUnresolvable: accumulator.honestlyUnresolvable,
    untyped: accumulator.untyped,
    importHopMissing: accumulator.importHopMissing,
    callSites: accumulator.callSites,
  };
}

/**
 * Fold ONE file's facts into the running totals, then let them go.
 *
 * Called from the analyzer immediately after the file's rows are appended to
 * their writers, which is the last moment the objects are needed at all.
 */
export function accumulateFileCompleteness(
  buckets: CompletenessAccumulator,
  facts: JsFileFacts
): void {
  {
    // A file classified as bundler output contributes to no denominator. Gate
    // 7.3.5: bundled output is classified, never counted — a bundler's output can
    // carry more call sites than the source tree it was built from, and every
    // one of them teaches nothing.
    if (facts.modules[0]?.sourceProvenance !== 'PROJECT') {
      return;
    }
    const resolvedImports = new Set<string>();
    for (const row of facts.imports) {
      if (row.resolutionOutcome === JsImportResolutionOutcome.RESOLVED_PROJECT
        || row.resolutionOutcome === JsImportResolutionOutcome.RESOLVED_EXTERNAL) {
        resolvedImports.add(row.getHash());
      }
    }
    const typeReferenceOwners = new Set(
      facts.typeReferences.map((row) => row.ownerLinkHash)
    );

    for (const call of facts.callSites) {
      buckets.callSites += 1;
      // An honest terminal, and it comes FIRST: a computed callee is complete
      // because the row says the name is not fixed by syntax, and asking whether
      // its receiver is typed is asking the wrong question of it.
      if (call.callKind === JsCallKind.COMPUTED_CALL
        || call.callKind === JsCallKind.DYNAMIC_CODE_CALL) {
        buckets.honestlyUnresolvable.total += 1;
        buckets.honestlyUnresolvable.complete += 1;
        continue;
      }
      const named = call.calleeName !== '';
      switch (call.receiverTypeSource) {
        case JsReceiverTypeSource.IMPORT_ALIAS: {
          buckets.importHop.total += 1;
          // The three hops §0 names, all present: the name as written, the
          // import, and the resolved path on it.
          const hop = call.importLinkHashValue();
          if (named && hop !== '' && resolvedImports.has(hop)) {
            buckets.importHop.complete += 1;
          } else if (hop === '') {
            buckets.importHopMissing += 1;
          }
          break;
        }
        case JsReceiverTypeSource.LOCAL_CLASS: {
          buckets.sameFile.total += 1;
          if (named) {
            buckets.sameFile.complete += 1;
          }
          break;
        }
        case JsReceiverTypeSource.JSDOC: {
          buckets.jsdocTyped.total += 1;
          if (named && typeReferenceOwners.size > 0) {
            buckets.jsdocTyped.complete += 1;
          }
          break;
        }
        case JsReceiverTypeSource.NODE_BUILTIN: {
          buckets.ambientTarget.total += 1;
          // Complete when the name is there: the target is in the `lib_*`
          // population and is NOT in this project, so there is no further hop
          // for the parser to emit. Counting these as incomplete would report
          // 15.3-24.4% of a real corpus as a parser gap when it is a property of the
          // platform — the environmental class §7 says to name rather than hide.
          if (named) {
            buckets.ambientTarget.complete += 1;
          }
          break;
        }
        default: {
          buckets.untyped.total += 1;
          // A bare `fn()` with a name is as complete as syntax allows: the
          // engine has a name to look up. What it lacks is a receiver type,
          // which no amount of parsing produces.
          if (named && call.receiverText === '') {
            buckets.untyped.complete += 1;
          }
          break;
        }
      }
    }
  }
}

/**
 * The whole measure in one call, for a caller that already holds every file.
 *
 * Only the gate does — the analyzer folds file by file. Kept so the two paths
 * are one implementation rather than two that must be checked against each
 * other.
 */
export function measureIrCompleteness(
  perFile: readonly JsFileFacts[]
): IrCompletenessReport {
  const buckets = createCompletenessAccumulator();
  for (const facts of perFile) {
    accumulateFileCompleteness(buckets, facts);
  }
  return finishCompleteness(buckets);
}

/** One line per bucket, because a single percentage hides which hop is missing. */
export function formatCompleteness(report: IrCompletenessReport): string[] {
  const line = (label: string, bucket: CompletenessBucket): string => {
    const share = bucket.total === 0
      ? '   —'
      : `${((bucket.complete / bucket.total) * 100).toFixed(1)}%`;
    return `   ${label.padEnd(24)}${String(bucket.complete).padStart(8)} / `
      + `${String(bucket.total).padEnd(8)} ${share}`;
  };
  return [
    `   ${'call sites'.padEnd(24)}${String(report.callSites).padStart(8)}`,
    line('same file', report.sameFile),
    line('import hop available', report.importHop),
    line('JSDoc typed', report.jsdocTyped),
    line('ambient/builtin target', report.ambientTarget),
    line('honestly unresolvable', report.honestlyUnresolvable),
    line('receiver untyped', report.untyped),
    `   ${'import hop MISSING'.padEnd(24)}${String(report.importHopMissing).padStart(8)}`
      + '   <- the only one that is a defect',
  ];
}
