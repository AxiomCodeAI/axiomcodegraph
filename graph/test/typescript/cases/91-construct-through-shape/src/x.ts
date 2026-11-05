// `new C(spec)` where C's type is a construct signature written as a type literal, an alias
// of one, a constructor type, or an interface. A factory that takes "the class to build"
// is written this way, and only the interface form resolved before.
interface WidgetDef { kind: string }
class Button { constructor(public spec: WidgetDef) {} }

type WidgetClass<T> = { new (spec: WidgetDef): T };
function viaAlias<T>(C: WidgetClass<T>): T { return new C({ kind: "a" }); }
function viaLiteral(C: { new (spec: WidgetDef): Button }): Button { return new C({ kind: "b" }); }

// controls: a constructor type and an interface with a construct signature
function viaCtorType(C: new (spec: WidgetDef) => Button): Button { return new C({ kind: "c" }); }
interface ButtonCtor { new (spec: WidgetDef): Button }
function viaInterface(C: ButtonCtor): Button { return new C({ kind: "d" }); }
const made = viaAlias(Button);
export { viaAlias, viaLiteral, viaCtorType, viaInterface, made };
