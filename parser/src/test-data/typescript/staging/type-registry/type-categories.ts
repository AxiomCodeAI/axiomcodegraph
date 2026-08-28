// fixture: type-registry/type-categories
// nature: runtime-bearing
// target: TypeScript 6.0.3 (syntax stable since 4.x)
//
// The declaration forms a TypeScript "type registry" must recognise, in the
// shapes they take in real compiler and library source. Names and members are
// modelled on the TypeScript compiler's own public types (TextRange,
// DiagnosticCategory, SourceFileLike) and on the Node/Express error idiom.
//
// Java's `type-registry/test-type-categories.java` covered class / interface /
// enum / record / @interface. Records and annotation-type declarations have no
// TypeScript analogue; type aliases and class expressions have no Java one.
// See MANIFEST.md for the full correspondence.

// --- interface: the compiler's own TextRange, verbatim in shape -------------

export interface TextRange {
    pos: number;
    end: number;
}

// interface with call, construct, index and method members in one body
export interface DiagnosticMessageChain {
    messageText: string;
    category: DiagnosticCategory;
    code: number;
    next?: DiagnosticMessageChain[];
}

// --- class -----------------------------------------------------------------

export class TextSpan implements TextRange {
    constructor(
        public readonly pos: number,
        public readonly end: number,
    ) {}

    get length(): number {
        return this.end - this.pos;
    }

    contains(position: number): boolean {
        return position >= this.pos && position < this.end;
    }
}

// --- abstract class --------------------------------------------------------

export abstract class DiagnosticReporter {
    abstract report(message: string, category: DiagnosticCategory): void;

    reportError(message: string): void {
        this.report(message, DiagnosticCategory.Error);
    }
}

// --- class extending a built-in, the Node/Express error idiom ---------------

export class HttpError extends Error {
    override readonly name = "HttpError";

    constructor(
        readonly statusCode: number,
        message: string,
        options?: { cause?: unknown },
    ) {
        super(message, options);
    }
}

// --- enum ------------------------------------------------------------------

export enum DiagnosticCategory {
    Warning,
    Error,
    Suggestion,
    Message,
}

// --- type alias: object shape, union, and function type --------------------

export type SourceFileLike = {
    readonly text: string;
    getLineAndCharacterOfPosition(pos: number): { line: number; character: number };
};

export type Severity = "error" | "warning" | "off";

export type DiagnosticFormatter = (chain: DiagnosticMessageChain) => string;

// --- class expression assigned to a const ----------------------------------

export const NullReporter = class extends DiagnosticReporter {
    report(): void {
        // discards every diagnostic
    }
};

// --- named class expression (the binding name and the class name differ) ---

export const CollectingReporter = class CollectingReporterImpl extends DiagnosticReporter {
    readonly lines: string[] = [];

    report(message: string, category: DiagnosticCategory): void {
        this.lines.push(`${DiagnosticCategory[category]}: ${message}`);
    }
};

// --- function declaration and generic function declaration -----------------

export function createTextSpan(pos: number, end: number): TextSpan {
    return new TextSpan(pos, end);
}

export function isDiagnosticChain(value: unknown): value is DiagnosticMessageChain {
    return typeof value === "object" && value !== null && "messageText" in value;
}
