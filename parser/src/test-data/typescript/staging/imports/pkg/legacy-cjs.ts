// fixture: imports/pkg/legacy-cjs (support module)
// nature: runtime-bearing
//
// A module using `export =`, the TypeScript-only CommonJS export form. This
// is how a very large share of the DefinitelyTyped corpus and pre-ESM library
// code is written, so a parser that only understands ES module syntax cannot
// read a large part of the real ecosystem.

interface FormatOptions {
    readonly indent: number;
    readonly newline: string;
}

declare namespace formatter {
    type Options = FormatOptions;
}

function formatter(text: string, options?: FormatOptions): string {
    const indent = " ".repeat(options?.indent ?? 0);
    return `${indent}${text}${options?.newline ?? ""}`;
}

export = formatter;
