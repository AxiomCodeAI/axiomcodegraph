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
of a destructured parameter (`function f({ cb = () => {} })`) cannot be attributed and
are not.

## PD-JS-6 — a `for..of` binding is linked to the iterated expression by nothing

```js
for (const item of items) item.run();
```

The binding has no initializer; the iterated expression is an ITERABLE root of the same
method. **Workaround:** `resolution/arrays.dl` joins on (module, line).
