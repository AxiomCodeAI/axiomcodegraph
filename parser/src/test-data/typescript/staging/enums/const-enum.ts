// fixture: enums/const-enum
// nature: runtime-bearing
//
// NOTE the nature carefully, because `const enum` is the one construct where
// the runtime/type-only split is genuinely ambiguous, and the fixture states
// which side it falls on so a parser can be held to it:
//
//   - the const enum DECLARATION is erased: no object is emitted for it
//     (unless preserveConstEnums is set), so `ScriptTarget` has no runtime
//     entity and no reverse mapping
//   - a const enum MEMBER ACCESS is inlined to its literal value at the call
//     site, so `ScriptTarget.ES2022` is emitted -- as `99`, not as a property
//     access
//
// This file is runtime-bearing because the functions below are emitted. What
// must NOT appear is a runtime entity for the const enum itself, nor a
// property-access edge from the inlined member reads.
//
// Modelled on ts.ScriptTarget and on the bit-flag const enums used for fast
// paths in real parsers.

// --- a const enum with explicit numeric members -------------------------

export const enum ScriptTarget {
    ES5 = 1,
    ES2015 = 2,
    ES2020 = 7,
    ES2022 = 9,
    ESNext = 99,
    Latest = ESNext,
}

// --- a const enum of bit flags, computed from earlier members ----------

export const enum TokenFlags {
    None = 0,
    PrecedingLineBreak = 1 << 0,
    Unterminated = 1 << 1,
    ExtendedUnicodeEscape = 1 << 2,
    Scientific = 1 << 3,
    NumericLiteralFlags = Scientific | ExtendedUnicodeEscape,
}

// --- a string-valued const enum ----------------------------------------

export const enum Extension {
    Ts = ".ts",
    Tsx = ".tsx",
    Dts = ".d.ts",
    Json = ".json",
}

// --- a module-local const enum ------------------------------------------

const enum InternalPhase {
    Parse = 0,
    Bind = 1,
    Check = 2,
}

// --- consumption sites: each member read below is INLINED --------------

export function supportsClassFields(target: ScriptTarget): boolean {
    return target >= ScriptTarget.ES2022;
}

export function defaultTarget(): ScriptTarget {
    return ScriptTarget.ES2022;
}

export function isDeclarationFile(extension: Extension): boolean {
    return extension === Extension.Dts;
}

export function hasLineBreak(flags: TokenFlags): boolean {
    return (flags & TokenFlags.PrecedingLineBreak) !== 0;
}

export function phaseOrder(): readonly number[] {
    return [InternalPhase.Parse, InternalPhase.Bind, InternalPhase.Check];
}

// --- a const enum member used as a computed property key ---------------

export const extensionLabels = {
    [Extension.Ts]: "TypeScript",
    [Extension.Tsx]: "TypeScript JSX",
    [Extension.Dts]: "Declarations",
    [Extension.Json]: "JSON",
};

// --- a const enum member in a switch ------------------------------------

export function describeTarget(target: ScriptTarget): string {
    switch (target) {
        case ScriptTarget.ES5:
            return "es5";
        case ScriptTarget.ES2015:
            return "es2015";
        case ScriptTarget.ESNext:
            return "esnext";
        default:
            return "other";
    }
}
