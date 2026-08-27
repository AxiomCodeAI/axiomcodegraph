/**
 * The syntactic form of a decorator.
 *
 * Positions 0–12 of `ts_decorator` mirror `java_annotation`, and the shared
 * `annotation_on` projection reads them. But a decorator is NOT an annotation: a
 * Java annotation is inert metadata, while a decorator is an expression that
 * RUNS at class-definition time and may REPLACE its target. That is why every
 * decorator row carries `tsExpressionLinkHash` into the call graph, and why
 * `@Component({ … })` is a call site like any other.
 *
 * ```ts
 * @Injectable                     // MARKER            — the reference IS the decorator
 * @Component({ … })               // CALL              — a factory whose RESULT decorates
 * @core.Injectable()              // MEMBER_EXPRESSION — reached through a namespace
 * @(decorators["audit"])          // COMPUTED          — the name is not statically known
 * @(record("parenthesised"))      // CALL              — parentheses are punctuation
 * ```
 *
 * Schema §4.18 c1.
 */
export enum TsDecoratorKind {
  /** `@Injectable` — no call; the reference itself decorates. */
  MARKER = 'MARKER',
  /** `@Component({ … })` — a factory call whose RETURN VALUE decorates. */
  CALL = 'CALL',
  /** `@core.Injectable` — reached through a dotted path. */
  MEMBER_EXPRESSION = 'MEMBER_EXPRESSION',
  /** `@(map["key"])` — the decorator is not statically named. */
  COMPUTED = 'COMPUTED',
}
