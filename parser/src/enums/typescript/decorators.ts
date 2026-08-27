/** `ts_decorator` / `ts_decorator_argument` enums — schema §4.18, §4.19. */

/** `ts_decorator` c1. */
export enum TsDecoratorKind {
  /** `@Injectable` — no call, the reference itself is the decorator. */
  MARKER = 'MARKER',
  /** `@Component({...})` — a factory call whose RESULT is the decorator. */
  CALL = 'CALL',
  MEMBER_EXPRESSION = 'MEMBER_EXPRESSION',
  COMPUTED = 'COMPUTED',
}

/** `ts_decorator` c2. */
export enum TsDecoratorContext {
  CLASS_DECLARATION = 'CLASS_DECLARATION',
  METHOD_DECLARATION = 'METHOD_DECLARATION',
  FIELD_DECLARATION = 'FIELD_DECLARATION',
  ACCESSOR_DECLARATION = 'ACCESSOR_DECLARATION',
  /** Legal ONLY under `experimentalDecorators`; the standard system has no such thing. */
  PARAMETER_DECLARATION = 'PARAMETER_DECLARATION',
  AUTO_ACCESSOR = 'AUTO_ACCESSOR',
}

/**
 * `ts_decorator` c13 — which decorator system the GOVERNING tsconfig selected.
 *
 * This is not cosmetic and it is not a per-repository constant. The two systems
 * differ in evaluation order, in what the decorator function receives, and in
 * whether parameter decorators are legal at all. `annotations/legacy/` in the
 * fixture corpus compiles under `experimentalDecorators` with its own
 * tsconfig, and its facts legitimately differ from the standard-decorator
 * fixtures three directories up.
 *
 * So this value must come from the tsconfig that actually GOVERNS the file —
 * resolved per file by walking up and honouring `extends`, `include` and
 * `exclude` — never from a run-wide assumption. Assuming one system for a
 * repository is wrong for exactly the repositories that matter: the ones
 * migrating between the two.
 */
export enum TsDecoratorSystem {
  /** TS 5.0+, ECMAScript stage 3. The default when `experimentalDecorators` is off. */
  STANDARD_TC39 = 'STANDARD_TC39',
  /** `experimentalDecorators: true`. Angular, NestJS, TypeORM. */
  LEGACY_EXPERIMENTAL = 'LEGACY_EXPERIMENTAL',
}

/** `ts_decorator` c14 — a decorator may SUBSTITUTE the entity, which no Java annotation can. */
export enum TsDecoratorSemantics {
  REPLACES_TARGET = 'REPLACES_TARGET',
  OBSERVES_TARGET = 'OBSERVES_TARGET',
  UNKNOWN = 'UNKNOWN',
}

/** `ts_decorator_argument` c2. */
export enum TsDecoratorArgumentValueType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  BOOLEAN = 'BOOLEAN',
  NULL = 'NULL',
  UNDEFINED = 'UNDEFINED',
  IDENTIFIER = 'IDENTIFIER',
  OBJECT = 'OBJECT',
  ARRAY = 'ARRAY',
  ARROW = 'ARROW',
  CALL = 'CALL',
  /** A class named as a DI token — the pattern the whole relation exists to capture. */
  CLASS_REFERENCE = 'CLASS_REFERENCE',
  TEMPLATE = 'TEMPLATE',
  UNKNOWN = 'UNKNOWN',
}
