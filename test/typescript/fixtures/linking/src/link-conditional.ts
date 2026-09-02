// CONDITIONAL RETURN TYPES — the branches, never the test.
import { condPick, condGuarded } from '@tt/cond';

// Both branches declare `shared`, so a two-candidate set is the correct answer and
// the site is ANSWERED rather than blank.
export function callShared(tag: string): string {
  return condPick('k').shared(tag);        // -> CondAlpha.shared / CondBeta.shared
}

// The same through a conditional whose check names an interface. If the descent ever
// reads the CHECK child, `Marker` becomes a receiver type and `markerOnly` would
// appear as a candidate here.
export function callGuarded(tag: string): string {
  return condGuarded('k').shared(tag);     // -> CondAlpha.shared / CondBeta.shared
}

// A call THROUGH a function-typed member, then a call on its result. The second hop
// is the one that needs the type-level signature's return type.
import { fnRegistry } from '@tt/cond';

export function callThroughFunctionType(name: string, label: string): string {
  return fnRegistry.make(name).finish(label);   // -> CondApi FnHandle.finish
}

// A native static reached through a `typeof Qualified.member` alias.
import { isArrayAlias, assignAlias } from '@tt/cond';

export function callTypeofAlias(x: unknown): boolean {
  return isArrayAlias(x);                    // -> lib.es5  ArrayConstructor.isArray
}
export function callAssignAlias(a: object, b: object): object {
  return assignAlias(a, b);                  // -> lib.es2015.core  ObjectConstructor.assign
}

// ── the compiler names the SIGNATURE, the engine names the IMPLEMENTATION ────
// The shape that produces the divergence, taken from real code: a factory returns a
// value typed as an INTERFACE, the caller DESTRUCTURES a member off it, and calls the
// binding. tsc types the binding from the interface member, so it resolves to the
// bodiless METHOD_SIGNATURE. The engine follows the value flow into the object literal
// the factory actually returned, and names the method that runs.
//
// Both answers are defensible and they are not the same declaration. For a call graph
// the implementation is the useful one, so it is scored IMPLEMENTATION_OF_SIGNATURE
// rather than WRONG — and this fixture exists so that verdict cannot silently regress:
// if it does, these sites become WRONG and the gate's "WRONG must be 0" assertion
// fires. A directly-visible object literal does NOT reproduce it — tsc names the
// implementation there too — which is why the factory is not incidental.
interface EmitCtx {
  emit(code: string): void;
  finish(): string;
}

function createEmitCtx(): EmitCtx {
  const ctx: EmitCtx = {
    emit(code) { void code; },
    finish() { return ''; },
  };
  return ctx;
}

export function useDestructuredFromFactory(code: string): string {
  const { emit, finish } = createEmitCtx();
  emit(code);
  return finish();
}

// ── a DESTRUCTURED PARAMETER, typed from the interface it destructures ───────
// `{ helper, nested }: Ctx` binds names that appear nowhere in the source as
// declarations. The parser emits a row per bound name carrying the property it binds;
// the engine gives each the type of that member on the pattern's type. A method member
// resolves to the method itself (there is no type to inherit); a field member gives the
// binding a type that ordinary member lookup then walks.
interface BindCtx {
  emitOne(code: string): void;
  inner: { deeper(n: number): number };
}

export function useDestructuredParam({ emitOne, inner }: BindCtx, code: string): number {
  emitOne(code);              // -> BindCtx.emitOne   (a METHOD member)
  return inner.deeper(1);     // -> the field's type, then .deeper
}

// A call on a namespace declared inside `declare global`, from a LIBRARY package.
export function callGlobalNamespace(t: object): void {
  TtMeta.defineMeta('k', t);   // -> the namespace's own function member
  TtMeta.getMeta('k', t);
}

// ── a DESTRUCTURED VARIABLE, typed from the value it was destructured FROM ──
// The mirror of the parameter case and the more common one: a context object is
// usually destructured in the BODY. The binding must take the type of the PROPERTY it
// names — typing it as the whole object is not merely imprecise, it produces a
// confident WRONG answer wherever the object carries a member of the same name as the
// one being called.
export function useDestructuredVar(code: string): number {
  const { emitOne, inner } = makeBindCtx();
  emitOne(code);              // -> BindCtx.emitOne
  return inner.deeper(2);     // -> the field's type, then .deeper
}

function makeBindCtx(): BindCtx {
  const c: BindCtx = { emitOne(x) { void x; }, inner: { deeper(n) { return n; } } };
  return c;
}

// ── a METHOD's type variable SHADOWS its class's ────────────────────────────
// Both are named T and they are different entities. Matching a use to its declaration
// by NAME cannot tell them apart and picks one arbitrarily; the parser now links a use
// to the declaration it actually refers to, so the constraint each dispatches against
// is the right one. If that link regresses, `named()` starts answering against the
// class's constraint and `identified()` against the method's.
interface HasIdent { identify(): string }
interface HasLabel { label(): string }

export class ShadowBox<T extends HasIdent> {
  identified(x: T): string {
    return x.identify();          // -> HasIdent.identify  (the CLASS's T)
  }
  named<T extends HasLabel>(x: T): string {
    return x.label();             // -> HasLabel.label     (the METHOD's T, shadowing)
  }
}

// ── an ARROW assigned to a variable annotated with a FUNCTION TYPE ──────────
// Neither parameter is annotated; both are typed by the alias on the const. This is
// how a typed handler, transform or visitor is written, and the contextual rules
// covered only lambdas passed as ARGUMENTS, never this.
export interface ArrowCtx { emitTo(code: string): void }
export type ArrowHandler = (ctx: ArrowCtx, label: string) => void;

export const handleArrow: ArrowHandler = (ctx, label) => {
  ctx.emitTo(label);     // -> ArrowCtx.emitTo, only if `ctx` is typed from the alias
  label.trim();          // -> String.trim
};

// ── an OBJECT-LITERAL METHOD typed by the annotation on the variable ────────
// `code` carries no annotation; it is typed by LitCtx.write's first parameter. The
// method is reached through the literal's EXPRESSION, which is the only link that
// connects it to the annotation — an object-literal method has no declared owner type.
export interface LitCtx {
  write(code: string, times?: number): void;
}

export const litCtx: LitCtx = {
  write(code, times) {
    code.trim();          // -> String.trim, only if `code` is typed from LitCtx
    void times;
  },
};
