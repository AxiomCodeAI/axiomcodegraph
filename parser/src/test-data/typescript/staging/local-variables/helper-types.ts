// fixture: local-variables/helper-types (support module)
// nature: runtime-bearing
//
// Types defined in one file and used to type LOCAL variables in another, so
// that local-variable typing has to cross a module boundary. Port of Java's
// `HelperTypes.java`.
//
// Deliberately mixes runtime exports (class, enum, function) with type-only
// exports (interface, type alias), because the consumer's locals must resolve
// against both and only the runtime ones may carry call-graph edges.

export enum Priority {
    Low = 1,
    Normal = 2,
    High = 3,
}

export interface Coordinate {
    readonly x: number;
    readonly y: number;
}

export type ValidationOutcome =
    | { readonly ok: true }
    | { readonly ok: false; readonly errors: readonly string[] };

export class Result<T> {
    private constructor(
        private readonly value: T | undefined,
        readonly error: string | undefined,
    ) {}

    static success<T>(value: T): Result<T> {
        return new Result<T>(value, undefined);
    }

    static failure<T>(error: string): Result<T> {
        return new Result<T>(undefined, error);
    }

    map<U>(fn: (value: T) => U): Result<U> {
        return this.value === undefined
            ? Result.failure<U>(this.error ?? "empty")
            : Result.success(fn(this.value));
    }

    orElse(fallback: T): T {
        return this.value ?? fallback;
    }
}

export class RequestBuilder {
    private readonly headers = new Map<string, string>();
    private path = "/";

    withPath(path: string): this {
        this.path = path;
        return this;
    }

    withHeader(name: string, value: string): this {
        this.headers.set(name, value);
        return this;
    }

    build(): Request {
        return new Request(this.path, this.headers);
    }
}

export class Request {
    constructor(
        readonly path: string,
        readonly headers: ReadonlyMap<string, string>,
    ) {}
}

export function distance(from: Coordinate, to: Coordinate): number {
    return Math.hypot(to.x - from.x, to.y - from.y);
}

export function validate(name: string): ValidationOutcome {
    return name.length > 0 ? { ok: true } : { ok: false, errors: ["name required"] };
}
