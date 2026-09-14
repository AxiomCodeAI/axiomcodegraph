// fixture: annotations/decorator-arguments
// nature: runtime-bearing
//
// Port of Java's annotation-VALUE fixtures -- `ValueTypes.java`,
// `test-array-annotations.java`, `test-nested-annotations.java`,
// `NamedArgAnnotationTest.java`, `SingleValueAnnotationTest.java`.
//
// A Java annotation carries a fixed set of element/value pairs drawn from a
// closed grammar (constants, class literals, enum constants, arrays, nested
// annotations). A TypeScript decorator factory takes ARBITRARY EXPRESSIONS,
// so the value grammar is the whole expression grammar. Each Java value form
// is ported to its expression counterpart, plus the forms Java cannot express:
// a function argument, a spread, a template literal, and a computed
// decorator expression.
//
// Also covers the decorator EXPRESSION forms the grammar allows: a bare
// identifier, a call, a property-access chain, and a parenthesised expression.

// --- the decorator factories being applied -------------------------------

type Ctor = abstract new (...args: any[]) => unknown;
type ClassDec = <T extends Ctor>(target: T, context: ClassDecoratorContext) => T;
type MethodDec = <T extends (this: any, ...args: any[]) => any>(
    target: T,
    context: ClassMethodDecoratorContext,
) => T;

export const applied: unknown[] = [];

function record(...values: unknown[]): ClassDec {
    return <T extends Ctor>(target: T, context: ClassDecoratorContext): T => {
        applied.push({ name: context.name, values });
        return target;
    };
}

function recordMethod(...values: unknown[]): MethodDec {
    return <T extends (this: any, ...args: any[]) => any>(
        target: T,
        context: ClassMethodDecoratorContext,
    ): T => {
        applied.push({ method: context.name, values });
        return target;
    };
}

function marker<T extends Ctor>(target: T, context: ClassDecoratorContext): T {
    applied.push({ marker: context.name });
    return target;
}

// a decorator reached through a property-access chain, as `@core.Injectable()`
// and `@t.Field()` are in real code
export const factories = {
    entity: record,
    nested: {
        column: record,
    },
};

// --- value forms: the direct ports of Java's annotation values ----------

export enum Scope {
    Singleton = "singleton",
    Transient = "transient",
}

class ValidatorImpl {}

// bare marker decorator (Java: @Deprecated)
@marker
export class MarkerOnly {}

// single positional value (Java: @Named("MainClass"))
@record("MainClass")
export class SingleValue {}

// several positional values of several primitive types
@record("orders", 42, 9_007_199_254_740_991n, 3.14, true, null, undefined)
export class PrimitiveValues {}

// an options object: the idiomatic stand-in for Java's named elements
// (Java: @Config(name = "MainService", priority = 10))
@record({
    name: "MainService",
    priority: 10,
    description: "Primary service",
    enabled: true,
})
export class NamedArguments {}

// array values (Java: @Target({ ElementType.TYPE, ElementType.METHOD }))
@record(["read", "write"], [1, 2, 3], [])
export class ArrayValues {}

// an enum member reference (Java: RetentionPolicy.RUNTIME)
@record(Scope.Singleton, Scope.Transient)
export class EnumValues {}

// a class reference (Java: String.class)
@record(ValidatorImpl, Array, Error)
export class ClassValues {}

// a nested factory call as an argument (Java: @Complex(nested = @Nested("x")))
@record({ binding: record("bolt"), fallback: marker })
export class NestedDecoratorValue {}

// a computed / non-constant expression argument -- Java permits only
// compile-time constants here
@record(60 * 1000, `${Scope.Singleton}-pool`, [...["a", "b"]], { ...{ deep: true } })
export class ComputedValues {}

// a function argument, which Java has no form for at all
@record((value: string) => value.trim(), function named() {}, class Inline {})
export class FunctionValues {}

// --- decorator EXPRESSION forms ------------------------------------------

// property-access chain, called
@factories.entity({ table: "users" })
export class QualifiedDecorator {}

// deeper property-access chain
@factories.nested.column({ nullable: false, length: 36 })
export class DeepQualifiedDecorator {}

// parenthesised decorator expression (permitted since TypeScript 5.0)
@(record("parenthesised"))
export class ParenthesisedDecorator {}

// --- stacking, and decorators on members --------------------------------

@marker
@record("first")
@record("second")
@factories.entity({ table: "stacked" })
export class StackedDecorators {
    @recordMethod({ ttl: 300, key: "user-cache" })
    load(id: string): string {
        return id;
    }

    @recordMethod("audit")
    @recordMethod(Scope.Transient)
    save(id: string): void {
        applied.push(id);
    }

    @recordMethod()
    static reset(): void {
        applied.length = 0;
    }
}
