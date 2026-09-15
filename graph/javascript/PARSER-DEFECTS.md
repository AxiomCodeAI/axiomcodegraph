# Parser defects the JavaScript rules work around

Each entry: the construct, a minimal repro, the column that should carry it, what the
engine does instead, and where the workaround lives so it can be retired when the parser
fix lands. The engine repo never edits the parser; defects are filed on the parser tracker.

## PD-JS-1 — a shorthand object-literal method has no expression row

```js
const registry = { start() { return this.stop(); }, stop() { return 0; } };
registry.start();
```

`js_method` carries `start` and `stop` (FUNCTION_EXPRESSION, named), but the
OBJECT_LITERAL expression has no PROPERTY_KEY / PROPERTY_VALUE child for either — the
`f: function () {}` form does. A member lookup on the literal's value therefore finds
nothing, and `this` inside `start` has no owner.

**Workaround:** `resolution/value-flow.dl` `literal_owns_method` attributes a
FUNCTION_EXPRESSION method with no introducing expression to the innermost
OBJECT_LITERAL of the same module whose span contains its start. Position arithmetic,
confined to that one relation.

## PD-JS-2 — a class expression is linked to its js_type by nothing

```js
export const Klass = class { run() { return 2; } };
new Klass().run();
```

The expression row is FUNCTION_EXPRESSION with an empty `introducesDeclarationLinkHash`,
and the js_type row (ANONYMOUS_CLASS, CLASS_EXPRESSION) has an empty
`sourceExpressionLinkHash`. The variable's `initializerKind` says CLASS and its
initializer is the expression, so the link is the only thing missing.

**Workaround:** `resolution/value-flow.dl` joins a FUNCTION_EXPRESSION that introduces no
method to a js_type at the same (module, line, column). `type_source_expr` is projected
so the position join retires by itself once the column is populated.

## PD-JS-3 — `export default function|class <Name>` under its local name — parser#176, FIXED

Fixed in the parser for the NAMED forms (exported as `default`, `defaultExportLinkHash`
set); the engine-side class recovery (`module_default_recovered`) was retired the same
day. Residue: the ANONYMOUS `export default function () {}` row still carries
`targetKind = EXPRESSION_VALUE` with no target and no source expression. The
function-declaration row's `modifiers` reads `default,export`, and
`resolution/module-graph.dl` recovers the default export from that.

## PD-JS-4 — a function declaration inside a block is owned by the enclosing function scope

```js
function outer() { if (x) { function inner() {} inner(); } }
```

`js_variable` for `inner` is declared in the BLOCK scope (both declarationScope and
syntacticScope); `js_method` for `inner` has `ownerScopeLinkHash` = the FUNCTION scope.
The two never meet on scope, and no column links the binding to the method.

**Workaround:** `containment/ownership.dl` `function_binding_method` joins on
(module, name, line) for this case.

## PD-JS-5 — a parameter's default expression is linked to the parameter by nothing

```js
function f(cb = () => {}) { cb(); }
```

`js_method_parameter` carries `hasDefault` and `defaultValueText`; the default is emitted
as a PARAMETER_DEFAULT root expression owned by the method. No column joins the two.

**Workaround:** `resolution/value-flow.dl` joins on (owner method, text). Inner defaults
of a destructured parameter (`function f({ cb = () => {} })`) are linked since #673: a
reference to the pattern binding carries the default's root in `js_expression` c35
(`bindingDefaultLinkHash`), and `expr_binding_default` adds the default's value to the
reference's, for parameter and variable patterns alike.

## PD-JS-6 — a `for..of` binding is linked to the iterated expression by nothing

```js
for (const item of items) item.run();
```

The binding has no initializer; the iterated expression is an ITERABLE root of the same
method. **Workaround:** `resolution/arrays.dl` joins on (module, line).

## PD-JS-7 — a dotted superclass is linked to an import by its LAST segment — parser#479, FIXED (#494)

```js
const { Base } = require('./other');   // an unrelated Base
const ns = require('./lib/base');
class A extends ns.Base {}
```

`js_type_heritage.importLinkHash` names the `{ Base }` import (matched by the simple
name) and `superTypeName` is `Base`; only `superTypeExpressionText` holds `ns.Base`.
Followed, the link gave a WRONG superclass. Since #494 the link names the ROOT
identifier's binding and every `EXTENDS_CLAUSE` row carries `sourceExpressionLinkHash`.
**Retained:** `projections/types.dl` projects the text as `heritage_text`, and
`resolution/type-hierarchy.dl` still decides the import rules on the text being undotted
— harmless on the fixed IR, and the expression rule below now decides these rows.

## PD-JS-8 — an `extends` expression that is not a name has no expression row — parser#479, FIXED (#494)

```js
class Mixed extends Mixin(Base) {}
class Sub extends require('./types').Gadget {}
```

`EXTENDS_CLAUSE` rows carried an empty `sourceExpressionLinkHash`, so there was nothing
to evaluate. Since #494 the row links the expression, and one rule in
`resolution/type-hierarchy.dl` — `type_super` from `expr_value` of the linked expression
— resolves a mixin call, a member of a `require()`, a conditional and an awaited import.
The name rules stay for the `OBJECT_CREATE_PROTOTYPE` form.

## PD-JS-9 — a getter is a js_method row like any method

`get svc() { return new Service(); }` is a `METHOD` row whose modifiers carry `get`. A
member read `x.svc` must yield the getter's RETURN value, and `x.svc()` must not
resolve to the accessor. **Workaround:** `projections/methods.dl` projects
`method_modifiers`; `type_own_getter` / `type_own_static_getter` hold accessors apart
from `type_own_member`, and `prop_value` on a getter is its `return_value`. Not a
defect as such — recorded because the split is the engine's, not the IR's.

## PD-JS-10 — a destructuring binding carried no path — parser#487, FIXED (#494)

```js
const { cb: renamed, inner: { deep }, ...rest } = o;
const [first, ...others] = xs;
function f({ a: { b } }, [c]) {}
```

Every binding of a pattern was a row with the pattern's initializer and its own name —
`renamed` could only be looked up as a property named `renamed`. Since #494 `js_variable`
carries `bindingPath` (`cb`, `inner.deep`, `0`, `1...`) and `isRestBinding` (c25, c26,
after the hash), and a reference to a parameter-pattern binding carries the same path on
`js_expression` (c34). `resolution/value-flow.dl`'s `path_value` walks a path from a
value; the three consumers are pattern variables, pattern-parameter references, and a
destructured `require()` whose `importedName` is a path (`nested.inner`).
