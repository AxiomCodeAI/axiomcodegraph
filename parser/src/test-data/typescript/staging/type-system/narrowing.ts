// fixture: type-system/narrowing
// nature: runtime-bearing
//
// Discriminated unions and every narrowing mechanism. This is the file where
// a runtime check and a type-level consequence are the SAME syntax: the
// `if` is emitted, the narrowing it performs is not.
//
// Java's nearest construct is `instanceof` pattern matching, which narrows one
// nominal type. TypeScript narrows structurally, by discriminant property, by
// `typeof`, by `in`, by truthiness, by equality against a literal, and by
// user-defined predicates and assertion functions.

// --- the discriminated union, the canonical shape ---------------------

export type Shape =
    | { readonly kind: "circle"; readonly radius: number }
    | { readonly kind: "rect"; readonly width: number; readonly height: number }
    | { readonly kind: "tri"; readonly base: number; readonly height: number };

export function area(shape: Shape): number {
    switch (shape.kind) {
        case "circle":
            return Math.PI * shape.radius ** 2;
        case "rect":
            return shape.width * shape.height;
        case "tri":
            return (shape.base * shape.height) / 2;
        default:
            return assertNever(shape);
    }
}

// --- exhaustiveness enforced by `never` ------------------------------

export function assertNever(value: never): never {
    throw new Error(`unexpected variant: ${JSON.stringify(value)}`);
}

// --- narrowing by discriminant in an if/else chain -------------------

export function describe(shape: Shape): string {
    if (shape.kind === "circle") {
        return `circle r=${shape.radius}`;
    } else if (shape.kind === "rect") {
        return `rect ${shape.width}x${shape.height}`;
    }
    return `tri b=${shape.base}`;
}

// --- a boolean discriminant: the Result union ----------------------

export type Result<T> =
    | { readonly ok: true; readonly value: T }
    | { readonly ok: false; readonly error: Error };

export function unwrap<T>(result: Result<T>, fallback: T): T {
    return result.ok ? result.value : fallback;
}

// --- narrowing by typeof --------------------------------------------

export function stringify(value: string | number | boolean | bigint | symbol | null | undefined): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toFixed(2);
    if (typeof value === "boolean") return value ? "yes" : "no";
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "symbol") return value.description ?? "symbol";
    if (value === null) return "null";
    return "undefined";
}

// --- narrowing by typeof "object" and "function" -------------------

export function callOrRead(value: (() => string) | { readonly text: string }): string {
    return typeof value === "function" ? value() : value.text;
}

// --- narrowing by instanceof ----------------------------------------

export class NotFound extends Error {
    readonly status = 404;
}
export class Conflict extends Error {
    readonly status = 409;
}

export function statusOf(error: unknown): number {
    if (error instanceof NotFound) return error.status;
    if (error instanceof Conflict) return error.status;
    if (error instanceof Error) return 500;
    return 0;
}

// --- narrowing by the `in` operator ---------------------------------

export interface Cat { readonly meow: () => string }
export interface Dog { readonly bark: () => string }

export function speak(animal: Cat | Dog): string {
    return "meow" in animal ? animal.meow() : animal.bark();
}

// --- narrowing by truthiness and by nullish checks ----------------

export function lengthOf(value: string | null | undefined): number {
    if (!value) return 0;
    return value.length;
}

export function firstTag(tags?: readonly string[]): string {
    if (tags === undefined || tags.length === 0) return "";
    const first = tags[0];
    return first ?? "";
}

// --- narrowing by equality against a literal union ---------------

export type Level = "debug" | "info" | "error";

export function isSevere(level: Level): boolean {
    if (level === "debug" || level === "info") return false;
    return level === "error";
}

// --- user-defined type predicates ---------------------------------

export function isCat(animal: Cat | Dog): animal is Cat {
    return "meow" in animal;
}

export function isNonEmpty<T>(items: readonly T[]): items is readonly [T, ...T[]] {
    return items.length > 0;
}

export function isDefined<T>(value: T | null | undefined): value is T {
    return value !== null && value !== undefined;
}

export function usePredicates(animals: readonly (Cat | Dog)[], values: readonly (string | null)[]): string {
    const cats = animals.filter(isCat);
    const defined = values.filter(isDefined);
    if (isNonEmpty(defined)) {
        return `${cats.length}:${defined[0]}`;
    }
    return String(cats.length);
}

// --- a `this`-based predicate -------------------------------------

export class Box<T> {
    constructor(private readonly value: T | undefined) {}

    hasValue(): this is Box<T> & { readonly value: T } {
        return this.value !== undefined;
    }

    read(fallback: T): T {
        return this.value ?? fallback;
    }
}

// --- assertion functions ------------------------------------------

export function assertIsString(value: unknown): asserts value is string {
    if (typeof value !== "string") {
        throw new TypeError("expected a string");
    }
}

export function assertDefined<T>(value: T | null | undefined): asserts value is T {
    if (value === null || value === undefined) {
        throw new TypeError("expected a value");
    }
}

export function assert(condition: unknown, message: string): asserts condition {
    if (!condition) {
        throw new Error(message);
    }
}

export function useAssertions(raw: unknown, maybe: string | undefined): string {
    assertIsString(raw);
    assertDefined(maybe);
    assert(raw.length > 0, "empty");
    return raw + maybe;
}

// --- narrowing that survives into a closure, and one that does not -

export function narrowingAndClosures(value: string | undefined): () => number {
    if (value === undefined) {
        return () => 0;
    }
    // `value` stays narrowed inside this closure because it is a const-like
    // parameter never reassigned
    return () => value.length;
}

// --- narrowing an unknown down to a structural shape -------------

export function isShape(value: unknown): value is Shape {
    return (
        typeof value === "object" &&
        value !== null &&
        "kind" in value &&
        typeof (value as { kind: unknown }).kind === "string"
    );
}

export function parseShape(json: string): number {
    const parsed: unknown = JSON.parse(json);
    if (isShape(parsed)) {
        return area(parsed);
    }
    return 0;
}
