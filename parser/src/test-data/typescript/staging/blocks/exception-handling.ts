// fixture: blocks/exception-handling
// nature: runtime-bearing
//
// Port of Java's `NestedBlockLinking.java` (try/catch/finally half),
// `ComprehensiveExceptionPatterns.java` and `AdvancedExceptionHandling.java`.
//
// The single largest gap between the two languages sits here. TypeScript has
// NO checked exceptions and NO throws clause, so Java's THROWS_CLAUSE context
// and its entire `ThrowsPatterns.java` fixture have no port -- see
// MANIFEST.md. It also has no multi-catch (`catch (A | B e)`) and no typed
// catch parameter at all: a catch binding is `any` or `unknown`, never a
// declared exception type, so the type of a caught value must be recovered by
// narrowing rather than read off the declaration.
//
// What TypeScript adds: an optional catch binding, promise rejection as a
// parallel error channel, and `never`-returning functions.
//
// Shaped after real error handling: a typed error hierarchy, a retry loop,
// and async error propagation.

// --- an error hierarchy, the TypeScript replacement for checked exceptions

export class AppError extends Error {
    override readonly name: string = "AppError";

    constructor(
        message: string,
        readonly code: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
    }
}

export class ValidationError extends AppError {
    override readonly name = "ValidationError";

    constructor(
        message: string,
        readonly fields: readonly string[],
    ) {
        super(message, "VALIDATION");
    }
}

export class ConnectionError extends AppError {
    override readonly name = "ConnectionError";

    constructor(
        readonly host: string,
        readonly attempt: number,
        cause?: unknown,
    ) {
        super(`cannot reach ${host}`, "CONNECTION", { cause });
    }
}

const log: string[] = [];

// --- try / catch ---------------------------------------------------------

export function tryCatch(payload: string): string {
    try {
        return JSON.parse(payload) as string;
    } catch (error) {
        log.push(String(error));
        return "";
    }
}

// --- try / catch / finally ----------------------------------------------

export function tryCatchFinally(payload: string): string {
    let handle = "open";
    try {
        return JSON.parse(payload) as string;
    } catch (error) {
        log.push(String(error));
        return "";
    } finally {
        handle = "closed";
        log.push(handle);
    }
}

// --- try / finally, with no catch at all -------------------------------

export function tryFinally(work: () => number): number {
    let started = false;
    try {
        started = true;
        return work();
    } finally {
        log.push(`started=${started}`);
    }
}

// --- optional catch binding (no parameter) -----------------------------

export function optionalCatchBinding(payload: string): boolean {
    try {
        JSON.parse(payload);
        return true;
    } catch {
        return false;
    }
}

// --- a catch binding annotated `unknown`, then narrowed ---------------
//     this is the TypeScript replacement for Java's multi-catch

export function narrowingCatch(work: () => void): string {
    try {
        work();
        return "ok";
    } catch (error: unknown) {
        if (error instanceof ValidationError) {
            return `invalid:${error.fields.join(",")}`;
        }
        if (error instanceof ConnectionError) {
            return `unreachable:${error.host}@${error.attempt}`;
        }
        if (error instanceof AppError) {
            return `app:${error.code}`;
        }
        if (error instanceof Error) {
            return `error:${error.message}`;
        }
        return `unknown:${String(error)}`;
    }
}

// --- nested try inside a try, and a try inside a catch ---------------

export function nestedTry(work: () => void, cleanup: () => void): string {
    try {
        try {
            work();
        } catch (inner) {
            log.push(`inner ${String(inner)}`);
            throw new AppError("rethrown", "INNER", { cause: inner });
        } finally {
            log.push("inner finally");
        }
        return "ok";
    } catch (outer) {
        try {
            cleanup();
        } catch {
            log.push("cleanup failed");
        }
        return `outer:${String(outer)}`;
    } finally {
        log.push("outer finally");
    }
}

// --- a try inside a loop, with retry and a rethrow on exhaustion -----

export function retry<T>(work: () => T, attempts: number): T {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return work();
        } catch (error) {
            lastError = error;
            log.push(`attempt ${attempt} failed`);
            if (attempt === attempts) {
                break;
            }
        }
    }
    throw new ConnectionError("upstream", attempts, lastError);
}

// --- throw statements: an Error, a subclass, and a non-Error value ---

export function throwForms(kind: string): never {
    if (kind === "validation") {
        throw new ValidationError("bad input", ["email"]);
    }
    if (kind === "plain") {
        throw new Error("plain");
    }
    if (kind === "literal") {
        // legal in JavaScript: any value may be thrown
        throw "a string, not an Error";
    }
    throw new AppError("unhandled", "UNKNOWN");
}

// --- a function whose return type is `never` -------------------------

export function assertNever(value: never): never {
    throw new AppError(`unexpected ${String(value)}`, "EXHAUSTIVE");
}

// --- async: try/catch around await, and rejection handling ----------

export async function asyncTryCatch(load: () => Promise<string>): Promise<string> {
    try {
        return await load();
    } catch (error) {
        if (error instanceof ConnectionError) {
            return "";
        }
        throw error;
    } finally {
        log.push("async finally");
    }
}

// --- await inside a finally, and a rethrow from a catch ------------

export async function asyncFinallyAwait(
    load: () => Promise<string>,
    close: () => Promise<void>,
): Promise<string> {
    try {
        return await load();
    } catch (error) {
        throw new AppError("load failed", "LOAD", { cause: error });
    } finally {
        await close();
    }
}

// --- promise rejection as the error channel, without try/catch ------

export function promiseChain(load: () => Promise<string>): Promise<string> {
    return load()
        .then((text) => text.trim())
        .catch((error: unknown) => {
            log.push(String(error));
            return "";
        })
        .finally(() => {
            log.push("settled");
        });
}

// --- a try/catch inside a generator ---------------------------------

export function* resilient(items: readonly string[]): Generator<string> {
    for (const item of items) {
        try {
            yield JSON.parse(item) as string;
        } catch {
            yield "";
        }
    }
}

export function drainLog(): readonly string[] {
    return log;
}
