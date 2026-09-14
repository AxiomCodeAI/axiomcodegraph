// fixture: methods/parameter-forms
// nature: runtime-bearing
//
// Port of Java's `MethodParamsTest.java`: every parameter form a method or
// function can declare.
//
// Java forms with no TypeScript analogue: `final` parameters, primitive
// parameter types (byte/short/char), and use-site wildcard parameter types.
// TypeScript forms with no Java analogue: optional parameters, default values,
// destructured (object and array) parameters, a leading `this` parameter, and
// parameter properties on a constructor.
//
// Modelled on the option-bag signatures that dominate real TypeScript APIs.

export interface CompilerOptions {
    readonly strict: boolean;
    readonly target: string;
    readonly outDir?: string;
}

export interface Logger {
    log(message: string): void;
}

export class Compiler {
    private readonly messages: string[] = [];

    // --- required parameters ----------------------------------------------
    compile(fileName: string, options: CompilerOptions): boolean {
        this.messages.push(`${fileName}:${options.target}`);
        return options.strict;
    }

    // --- optional parameter -----------------------------------------------
    emit(fileName: string, outDir?: string): string {
        return outDir === undefined ? fileName : `${outDir}/${fileName}`;
    }

    // --- default value (typed by inference) -------------------------------
    watch(fileName: string, intervalMs = 250): number {
        void fileName;
        return intervalMs;
    }

    // --- default value with an explicit annotation ------------------------
    format(message: string, indent: number = 0): string {
        return " ".repeat(indent) + message;
    }

    // --- default value that is an object literal --------------------------
    configure(options: CompilerOptions = { strict: true, target: "ES2022" }): CompilerOptions {
        return options;
    }

    // --- rest parameter ---------------------------------------------------
    addAll(...fileNames: string[]): void {
        this.messages.push(...fileNames);
    }

    // --- required, optional and rest in one signature ---------------------
    report(prefix: string, category?: string, ...details: readonly string[]): string {
        return [prefix, category ?? "info", ...details].join(" ");
    }

    // --- destructured object parameter with an inline type ---------------
    resolve({ strict, target }: CompilerOptions): string {
        return `${strict}/${target}`;
    }

    // --- destructured object parameter with renaming and defaults --------
    load({
        target: targetName,
        outDir = "dist",
        strict = false,
    }: CompilerOptions): string {
        return `${targetName}/${outDir}/${strict}`;
    }

    // --- destructured object parameter with a default for the whole bag --
    start({ strict }: CompilerOptions = { strict: false, target: "ES2022" }): boolean {
        return strict;
    }

    // --- destructured array parameter, with rest -------------------------
    range([start, end, ...rest]: readonly number[]): number {
        return (start ?? 0) + (end ?? 0) + rest.length;
    }

    // --- nested destructuring --------------------------------------------
    describe({ options: { target } }: { options: CompilerOptions }): string {
        return target;
    }

    // --- a `this` parameter (erased; Java has no syntax for it) ----------
    dump(this: Compiler, logger: Logger): void {
        for (const message of this.messages) {
            logger.log(message);
        }
    }

    // --- parameter whose type is a function type -------------------------
    onEach(callback: (message: string, index: number) => void): void {
        this.messages.forEach(callback);
    }

    // --- parameter whose type is a generic instantiation ----------------
    merge(other: Map<string, ReadonlyArray<CompilerOptions>>): number {
        return other.size;
    }

    // --- generic parameters, including a constrained one -----------------
    pluck<T extends CompilerOptions, K extends keyof T>(source: T, key: K): T[K] {
        return source[key];
    }

    // --- union-typed and nullable parameters ----------------------------
    normalise(input: string | readonly string[] | null): readonly string[] {
        if (input === null) {
            return [];
        }
        return typeof input === "string" ? [input] : input;
    }
}

// --- constructor parameter properties, mixed with plain parameters -------

export class DiagnosticSink {
    constructor(
        private readonly logger: Logger,
        readonly limit: number,
        prefix: string,
        public verbose = false,
    ) {
        this.prefix = prefix;
    }

    private readonly prefix: string;

    write(message: string): void {
        if (this.verbose) {
            this.logger.log(`${this.prefix}${message}`.slice(0, this.limit));
        }
    }
}

// --- free functions: the same forms outside a class ---------------------

export function withDefaults(target = "ES2022", strict = true): CompilerOptions {
    return { target, strict };
}

export function tail<T>(first: T, ...rest: T[]): T[] {
    return [first, ...rest];
}

export const destructuringArrow = ({ strict }: CompilerOptions, ...extra: string[]): string =>
    `${strict}${extra.length}`;
