// fixture: type-system/overload-resolution
// nature: runtime-bearing
//
// The CALL SITES half of overloading. methods/overload-signatures.ts declares
// overload sets; this file calls them, in shapes where the winning signature
// is decided by the checker rather than readable from the syntax.
//
// Unlike Python's @overload, TypeScript overload resolution is real and
// decidable: checker.getResolvedSignature names the winner, so every call
// below has an oracle-adjudicated answer. Cases are ordered so that the
// distinguishing factor is explicit: arity, argument type, literal type,
// generic inference, and declaration order.

export interface ElementLike {
    readonly tag: string;
}

// --- an overload set discriminated by LITERAL argument type --------
//     (the addEventListener shape)

export type EventPayloads = {
    click: { readonly x: number; readonly y: number };
    keydown: { readonly key: string };
    focus: { readonly target: string };
};

export function on(event: "click", handler: (payload: EventPayloads["click"]) => void): void;
export function on(event: "keydown", handler: (payload: EventPayloads["keydown"]) => void): void;
export function on(event: string, handler: (payload: never) => void): void;
export function on(event: string, handler: (payload: never) => void): void {
    void event;
    void handler;
}

// --- discriminated by ARITY ---------------------------------------

export function slice(source: string): string;
export function slice(source: string, start: number): string;
export function slice(source: string, start: number, end: number): string;
export function slice(source: string, start = 0, end?: number): string {
    return end === undefined ? source.slice(start) : source.slice(start, end);
}

// --- discriminated by ARGUMENT TYPE at equal arity ----------------

export function render(value: string): string;
export function render(value: number): string;
export function render(value: ElementLike): string;
export function render(value: readonly ElementLike[]): string;
export function render(value: string | number | ElementLike | readonly ElementLike[]): string {
    if (typeof value === "string") return value;
    if (typeof value === "number") return value.toFixed(0);
    return Array.isArray(value) ? value.map((v) => v.tag).join("") : (value as ElementLike).tag;
}

// --- discriminated by a BOOLEAN literal, changing the return type -

export function read(path: string, asBuffer: true): Uint8Array;
export function read(path: string, asBuffer?: false): string;
export function read(path: string, asBuffer?: boolean): string | Uint8Array {
    return asBuffer === true ? new Uint8Array() : path;
}

// --- generic and non-generic overloads in one set ---------------
//     declaration ORDER decides which wins when both match

export function first(items: readonly string[]): string | undefined;
export function first<T>(items: readonly T[]): T | undefined;
export function first<T>(items: readonly T[]): T | undefined {
    return items[0];
}

// --- the call sites ---------------------------------------------

export function callSites(element: ElementLike, elements: readonly ElementLike[]): void {
    // literal-typed first argument picks a specific signature
    on("click", (payload) => void payload.x);
    on("keydown", (payload) => void payload.key);
    // a widened string falls through to the catch-all signature
    const dynamicEvent: string = "focus";
    on(dynamicEvent, () => undefined);

    // arity decides
    void slice("abcdef");
    void slice("abcdef", 1);
    void slice("abcdef", 1, 3);

    // argument type decides at equal arity
    void render("text");
    void render(42);
    void render(element);
    void render(elements);

    // a boolean LITERAL selects a different return type than a boolean
    const asBytes = read("/tmp/a", true);
    const asText = read("/tmp/a");
    const asTextExplicit = read("/tmp/a", false);
    void asBytes.byteLength;
    void asText.length;
    void asTextExplicit.length;

    // the non-generic signature is declared first and wins for string[]
    const firstString = first(["a", "b"]);
    // the generic signature wins for anything else
    const firstElement = first(elements);
    void firstString?.length;
    void firstElement?.tag;
}

// --- a call whose argument is itself an overloaded call ---------

export function nestedResolution(): string {
    return render(slice("abcdef", 0, 3));
}

// --- resolution through a variable holding the overloaded function

export function throughAlias(): string {
    const alias = render;
    return alias("via alias");
}
