// fixture: enums/enum-forms
// nature: runtime-bearing
//
// Port of Java's `SimpleStatus.java`. A TypeScript enum, unlike a type alias
// or interface, IS emitted: it becomes an object literal at runtime, so an
// enum declaration is runtime-bearing and its members are real property
// accesses.
//
// Java enum features with no TypeScript analogue -- constructors, fields,
// methods, per-constant class bodies, abstract methods implemented per
// constant, and `implements` on an enum. None of them are simulated; the
// idiomatic replacements (a lookup record and a plain function) are shown
// instead, because that is what TypeScript code actually does.
//
// Shaped after the enums in the TypeScript compiler and in HTTP libraries.

// --- numeric enum, auto-incrementing from 0 ------------------------------

export enum DiagnosticCategory {
    Warning,
    Error,
    Suggestion,
    Message,
}

// --- numeric enum with explicit initialisers, and continuation ---------

export enum NodeFlags {
    None = 0,
    Let = 1,
    Const = 2,
    // a member initialised from a constant expression over earlier members
    BlockScoped = Let | Const,
    Ambient = 1 << 4,
    ContextFlags = Ambient | BlockScoped,
}

// --- a numeric enum where only the first member is initialised ---------

export enum Priority {
    Low = 1,
    Normal,
    High,
    Critical,
}

// --- string enum ---------------------------------------------------------

export enum HttpMethod {
    Get = "GET",
    Post = "POST",
    Put = "PUT",
    Delete = "DELETE",
    Patch = "PATCH",
}

// --- heterogeneous enum (legal, and rare in practice) ------------------

export enum Mixed {
    No = 0,
    Yes = "YES",
}

// --- computed members: a member whose value is not a compile-time constant

export enum FileAccess {
    None = 0,
    Read = 1 << 1,
    Write = 1 << 2,
    ReadWrite = Read | Write,
    // computed member -- forces a runtime evaluation
    Length = "abc".length,
}

// --- an enum declared but not exported (module-local) -------------------

enum InternalState {
    Idle,
    Running,
}

// --- reverse mapping, which numeric enums have and string enums do not --

export function categoryName(category: DiagnosticCategory): string {
    return DiagnosticCategory[category] ?? "unknown";
}

// --- member access in value position ------------------------------------

export function isError(category: DiagnosticCategory): boolean {
    return category === DiagnosticCategory.Error;
}

export function methodAllowsBody(method: HttpMethod): boolean {
    return method === HttpMethod.Post || method === HttpMethod.Put || method === HttpMethod.Patch;
}

export function hasFlag(flags: NodeFlags, flag: NodeFlags): boolean {
    return (flags & flag) !== 0;
}

// --- the replacement for Java's per-constant behaviour: a lookup record --
//     (Java: `enum Operation { PLUS { int apply(..) } ... }`)

export const operations = {
    plus: (a: number, b: number): number => a + b,
    minus: (a: number, b: number): number => a - b,
    multiply: (a: number, b: number): number => a * b,
} as const;

export type Operation = keyof typeof operations;

export function apply(operation: Operation, a: number, b: number): number {
    return operations[operation](a, b);
}

// --- the replacement for Java's enum fields: a metadata record ---------
//     (Java: `HttpMethod("GET", true)` with getters)

interface MethodMetadata {
    readonly idempotent: boolean;
    readonly label: string;
}

export const httpMethodMetadata: Readonly<Record<HttpMethod, MethodMetadata>> = {
    [HttpMethod.Get]: { idempotent: true, label: "Get" },
    [HttpMethod.Post]: { idempotent: false, label: "Post" },
    [HttpMethod.Put]: { idempotent: true, label: "Put" },
    [HttpMethod.Delete]: { idempotent: true, label: "Delete" },
    [HttpMethod.Patch]: { idempotent: false, label: "Patch" },
};

export function isIdempotent(method: HttpMethod): boolean {
    return httpMethodMetadata[method].idempotent;
}

// --- an enum used in a switch, the commonest consumption site ---------

export function describe(state: Priority): string {
    switch (state) {
        case Priority.Low:
            return "low";
        case Priority.Normal:
            return "normal";
        case Priority.High:
        case Priority.Critical:
            return "urgent";
        default:
            return "unknown";
    }
}

export function internalStateCount(): number {
    return Object.keys(InternalState).length;
}
