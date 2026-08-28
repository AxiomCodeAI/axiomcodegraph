// fixture: methods/constructor-patterns
// nature: runtime-bearing
//
// Port of Java's `ConstructorPatterns.java`.
//
// The central difference: Java overloads constructors with several bodies;
// TypeScript declares N overload SIGNATURES plus exactly one implementation,
// and the signatures are erased. A parser that models a TypeScript constructor
// the way Java models one will over-count implementations.
//
// Java's generic constructors (`public <U> Ctor(...)`) have no analogue --
// a TypeScript constructor cannot declare its own type parameters; only the
// class can. The idiomatic replacement is a static generic factory, included
// below.

export interface Point {
    readonly x: number;
    readonly y: number;
}

// --- implicit constructor (none written) ---------------------------------

export class Origin {
    readonly x = 0;
    readonly y = 0;
}

// --- a single explicit constructor ---------------------------------------

export class Vector implements Point {
    constructor(
        readonly x: number,
        readonly y: number,
    ) {}
}

// --- constructor overload signatures plus one implementation ------------

export class Range {
    readonly start: number;
    readonly end: number;

    constructor(span: number);
    constructor(start: number, end: number);
    constructor(bounds: readonly [number, number]);
    constructor(startOrSpanOrBounds: number | readonly [number, number], end?: number) {
        if (Array.isArray(startOrSpanOrBounds)) {
            const [start, stop] = startOrSpanOrBounds as readonly [number, number];
            this.start = start;
            this.end = stop;
        } else if (end === undefined) {
            this.start = 0;
            this.end = startOrSpanOrBounds as number;
        } else {
            this.start = startOrSpanOrBounds as number;
            this.end = end;
        }
    }
}

// --- constructor calling super(), with extra work before and after ------

export class Segment extends Range {
    readonly label: string;

    constructor(start: number, end: number, label: string) {
        super(start, end);
        this.label = label;
    }
}

// --- protected constructor: subclassable but not directly constructible --

export abstract class Shape {
    protected constructor(readonly name: string) {}

    abstract area(): number;
}

export class Circle extends Shape {
    constructor(readonly radius: number) {
        super("circle");
    }

    area(): number {
        return Math.PI * this.radius ** 2;
    }
}

// --- private constructor + static factories: the singleton idiom --------

export class ConnectionPool {
    private static instance: ConnectionPool | undefined;

    private constructor(readonly size: number) {}

    static getInstance(size = 10): ConnectionPool {
        ConnectionPool.instance ??= new ConnectionPool(size);
        return ConnectionPool.instance;
    }

    static reset(): void {
        ConnectionPool.instance = undefined;
    }
}

// --- generic class whose constructor uses the class type parameters -----

export class Cell<T> {
    constructor(private value: T) {}

    read(): T {
        return this.value;
    }

    write(next: T): void {
        this.value = next;
    }
}

// --- static generic factories: the replacement for Java's generic ctor --

export class Result<TValue, TError extends Error = Error> {
    private constructor(
        readonly value: TValue | undefined,
        readonly error: TError | undefined,
    ) {}

    static ok<TValue>(value: TValue): Result<TValue, never> {
        return new Result<TValue, never>(value, undefined);
    }

    static fail<TError extends Error>(error: TError): Result<never, TError> {
        return new Result<never, TError>(undefined, error);
    }

    static from<TValue, TError extends Error>(
        producer: () => TValue,
        wrap: (cause: unknown) => TError,
    ): Result<TValue, TError> {
        try {
            return new Result<TValue, TError>(producer(), undefined);
        } catch (cause) {
            return new Result<TValue, TError>(undefined, wrap(cause));
        }
    }

    isOk(): boolean {
        return this.error === undefined;
    }
}

// --- a constructor whose parameters are entirely parameter properties ---

export class HttpClient {
    constructor(
        private readonly baseUrl: string,
        private readonly timeoutMs = 5_000,
        protected readonly headers: ReadonlyMap<string, string> = new Map(),
    ) {}

    describe(): string {
        return `${this.baseUrl}/${this.timeoutMs}/${this.headers.size}`;
    }
}

// --- subclass with no constructor of its own (inherits the base one) ----

export class JsonClient extends HttpClient {
    parse(text: string): unknown {
        return JSON.parse(text);
    }
}
