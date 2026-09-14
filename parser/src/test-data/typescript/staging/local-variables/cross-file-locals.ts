// fixture: local-variables/cross-file-locals
// nature: runtime-bearing
//
// Port of Java's `CrossFileLocalVariables.java`: local variables whose types
// are declared in another module, so resolving them requires following an
// import edge first.
//
// The TypeScript-specific part is that some of these locals are typed by
// names imported with `import type` -- erased bindings. Those locals are real
// and runtime-bearing; the TYPE they carry is not. A parser that conflates
// the two will either lose the local or invent an import edge.

import { Priority, RequestBuilder, Result, distance, validate } from "./helper-types";
import type { Coordinate, ValidationOutcome } from "./helper-types";

// --- a local typed by an imported class, via a static factory ----------

export function usingResult(raw: string): string {
    const parsed: Result<number> = Result.success(Number(raw));
    const mapped = parsed.map((value) => value.toFixed(2));
    const settled = mapped.orElse("0.00");
    return settled;
}

// --- a local typed by an imported INTERFACE (erased) -------------------

export function usingInterface(): number {
    const origin: Coordinate = { x: 0, y: 0 };
    const target: Coordinate = { x: 3, y: 4 };
    const span = distance(origin, target);
    return span;
}

// --- a local typed by an imported enum, and one holding a member -------

export function usingEnum(level: Priority): string {
    const escalated: Priority = level === Priority.High ? Priority.High : Priority.Normal;
    const name = Priority[escalated];
    return name;
}

// --- a local built through a fluent chain across the boundary ---------

export function usingBuilder(path: string): string {
    const builder = new RequestBuilder();
    const configured = builder.withPath(path).withHeader("accept", "application/json");
    const request = configured.build();
    const headerCount = request.headers.size;
    return `${request.path}#${headerCount}`;
}

// --- a local typed by an imported discriminated union, then narrowed --

export function usingUnion(name: string): readonly string[] {
    const outcome: ValidationOutcome = validate(name);
    if (outcome.ok) {
        const empty: readonly string[] = [];
        return empty;
    }
    const errors = outcome.errors;
    return errors;
}

// --- a destructured local whose pattern comes from an imported type --

export function destructuredAcrossFiles(point: Coordinate): number {
    const { x, y } = point;
    const { x: alsoX = 0 } = point;
    return x + y + alsoX;
}

// --- a generic local instantiated with an imported type --------------

export function genericAcrossFiles(point: Coordinate): number {
    const cache = new Map<string, Coordinate>();
    const results: Array<Result<Coordinate>> = [Result.success(point)];
    cache.set("origin", point);
    return cache.size + results.length;
}
