// fixture: type-references/array-and-tuple-types
// nature: type-only
//
// Array, tuple and nested-generic type references. Port of Java's
// `test-array-types.java` and `test-nested-generics.java`, plus the tuple
// forms Java has no equivalent of at all.
//
// Java's use-site wildcards (`? extends Number`, `? super Integer`,
// unbounded `?`) have NO TypeScript analogue and are not simulated here.
// Their nearest counterpart is declaration-site variance, exercised in
// type-parameters/generic-type-declarations.ts. See MANIFEST.md.

export interface Diagnostic {
    readonly code: number;
    readonly message: string;
}

// --- the two spellings of an array type -----------------------------------

export type DiagnosticArray = Diagnostic[];
export type DiagnosticArrayGeneric = Array<Diagnostic>;

// --- readonly arrays, both spellings --------------------------------------

export type FrozenDiagnostics = readonly Diagnostic[];
export type FrozenDiagnosticsGeneric = ReadonlyArray<Diagnostic>;

// --- arrays of primitives and of unions -----------------------------------

export type Codes = number[];
export type Flags = Array<boolean>;
export type Mixed = Array<string | number>;
export type ArrayOfUnions = (Diagnostic | Error)[];

// --- multi-dimensional arrays (Java's String[][]) -------------------------

export type Matrix = number[][];
export type Grid = ReadonlyArray<readonly string[]>;
export type Cube = number[][][];

// --- array of a generic instantiation -------------------------------------

export type MapArray = Array<Map<string, Diagnostic>>;
export type PromiseArray = Promise<Diagnostic>[];

// --- array of a function type (parenthesisation matters) -----------------

export type Handlers = Array<(diagnostic: Diagnostic) => void>;
export type HandlerArrayShorthand = ((diagnostic: Diagnostic) => void)[];

// --- nested generics, one to three deep (Java's Map<String, List<Integer>>) -

export type SingleNested = Map<string, Diagnostic>;
export type DoubleNested = Map<string, Array<Diagnostic>>;
export type TripleNested = Map<string, Map<number, ReadonlyArray<Diagnostic>>>;
export type DeeplyNested = Array<Map<string, Set<ReadonlyArray<Diagnostic>>>>;

// --- generic instantiation whose argument is another type parameter ------

export type Grouped<T> = Map<string, T[]>;
export type NestedGrouped<T, K extends string> = Map<K, Grouped<T>>;

// --- tuples: fixed, named, optional, rest, readonly ----------------------

export type Point = [number, number];
export type NamedPoint = [x: number, y: number];
export type LineSegment = [start: Point, end: Point];
export type OptionalTail = [head: string, tail?: string];
export type WithRest = [first: string, ...rest: number[]];
export type LeadingRest = [...init: string[], last: number];
export type FrozenPair = readonly [string, number];
export type EmptyTuple = [];

// --- tuples nested in generics and arrays --------------------------------

export type EntryList = Array<[key: string, value: Diagnostic]>;
export type PointCloud = ReadonlyArray<readonly [number, number, number]>;

// --- a tuple used as a parameter list (rest-parameter type) --------------

export type Signature = (...args: [source: string, target: string, force?: boolean]) => void;

// --- constructor and abstract-constructor type references ----------------

export type DiagnosticCtor = new (code: number, message: string) => Diagnostic;
export type AbstractDiagnosticCtor = abstract new () => Diagnostic;
