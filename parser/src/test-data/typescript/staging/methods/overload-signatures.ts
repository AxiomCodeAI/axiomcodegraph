// fixture: methods/overload-signatures
// nature: runtime-bearing
//
// Port of Java's `MethodOverloadPatterns.java`, and the place the Java model
// bends furthest without breaking.
//
// In Java, four overloads of `process` are four methods with four bodies. In
// TypeScript they are N *signatures* -- which are erased and have no body --
// followed by exactly one implementation signature, which is NOT itself
// callable from outside. Overload sets therefore have a shape Java has no row
// for: several declarations, one implementation, and a compiler-chosen winner
// per call site.
//
// This fixture covers the DECLARATION syntax only. Which signature a given
// call resolves to is adjudicated by checker.getResolvedSignature and is
// half two's subject, by assignment.
//
// Shaped after the overload sets that really exist: DOM addEventListener,
// Node's readFile, and the compiler's own createSourceFile.

export interface EventMap {
    click: { readonly x: number; readonly y: number };
    keydown: { readonly key: string };
}

// --- function overloads: differing arity ---------------------------------

export function connect(url: string): string;
export function connect(host: string, port: number): string;
export function connect(host: string, port: number, secure: boolean): string;
export function connect(hostOrUrl: string, port?: number, secure = false): string {
    if (port === undefined) {
        return hostOrUrl;
    }
    return `${secure ? "https" : "http"}://${hostOrUrl}:${port}`;
}

// --- function overloads: same arity, different parameter types ----------

export function normalise(value: string): string;
export function normalise(value: number): string;
export function normalise(value: readonly string[]): string;
export function normalise(value: string | number | readonly string[]): string {
    if (typeof value === "number") {
        return value.toFixed(2);
    }
    return typeof value === "string" ? value.trim() : value.join(",");
}

// --- function overloads: differing RETURN types, the union-narrowing form -

export function parse(text: string, asJson: true): unknown;
export function parse(text: string, asJson?: false): string;
export function parse(text: string, asJson?: boolean): unknown {
    return asJson === true ? JSON.parse(text) : text;
}

// --- generic overloads, and a mix of generic and non-generic ------------

export function first(items: readonly string[]): string | undefined;
export function first<T>(items: readonly T[]): T | undefined;
export function first<T>(items: readonly T[]): T | undefined {
    return items[0];
}

export function collect<T>(item: T): T[];
export function collect<T>(items: readonly T[]): T[];
export function collect<T>(itemOrItems: T | readonly T[]): T[] {
    return Array.isArray(itemOrItems) ? [...(itemOrItems as readonly T[])] : [itemOrItems as T];
}

// --- method overloads on a class, including a static overload set -------

export class Emitter {
    private readonly listeners = new Map<string, Array<(payload: never) => void>>();

    // an overload set keyed on a literal type, as addEventListener really is
    on(event: "click", handler: (payload: EventMap["click"]) => void): this;
    on(event: "keydown", handler: (payload: EventMap["keydown"]) => void): this;
    on(event: string, handler: (payload: never) => void): this;
    on(event: string, handler: (payload: never) => void): this {
        const existing = this.listeners.get(event) ?? [];
        existing.push(handler);
        this.listeners.set(event, existing);
        return this;
    }

    // overloaded method differing in arity
    emit(event: string): number;
    emit(event: string, payload: unknown): number;
    emit(event: string, payload?: unknown): number {
        void payload;
        return this.listeners.get(event)?.length ?? 0;
    }

    // a static overload set alongside the instance ones
    static create(): Emitter;
    static create(events: readonly string[]): Emitter;
    static create(events: readonly string[] = []): Emitter {
        const emitter = new Emitter();
        for (const event of events) {
            emitter.listeners.set(event, []);
        }
        return emitter;
    }

    // an overloaded accessor-like getter pair is NOT possible; an overloaded
    // method whose implementation is private is:
    private dispatch(event: string): void;
    private dispatch(event: string, times: number): void;
    private dispatch(event: string, times = 1): void {
        for (let i = 0; i < times; i++) {
            void this.emit(event);
        }
    }

    fire(event: string): void {
        this.dispatch(event, 2);
    }
}

// --- an overload set declared in an object literal type, implemented once -

export const codec: {
    encode(value: string): string;
    encode(value: Uint8Array): string;
} = {
    encode(value: string | Uint8Array): string {
        return typeof value === "string" ? value : String.fromCharCode(...value);
    },
};

// --- overloads that differ only by optionality ---------------------------

export function schedule(task: () => void): number;
export function schedule(task: () => void, delayMs: number): number;
export function schedule(task: () => void, delayMs?: number): number {
    task();
    return delayMs ?? 0;
}
