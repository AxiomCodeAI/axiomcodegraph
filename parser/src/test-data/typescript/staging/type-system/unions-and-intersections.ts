// fixture: type-system/unions-and-intersections
// nature: type-only
//
// Unions and intersections have no analogue in either Java or Python. A union
// is not a supertype and an intersection is not multiple inheritance: both are
// set operations over structural types, and both are anonymous.
//
// Shaped after the union types that really occur: JSON values, the compiler's
// node unions, Redux-style actions, and option bags combined by intersection.

export interface Identified { readonly id: string }
export interface Timestamped { readonly updatedAt: number }
export interface Owned { readonly ownerId: string }

// --- unions of primitives, literals, and the mixed case -----------------

export type Primitive = string | number | boolean | bigint | symbol | null | undefined;
export type Alignment = "left" | "center" | "right";
export type Bit = 0 | 1;
export type Falsy = false | 0 | "" | null | undefined;
export type LooseAlignment = Alignment | (string & {});

// --- a recursive union: the JSON value, the canonical example ----------

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | readonly JsonValue[]
    | { readonly [key: string]: JsonValue };

// --- unions of object types, and of function types ---------------------

export type Shape =
    | { readonly kind: "circle"; readonly radius: number }
    | { readonly kind: "rect"; readonly width: number; readonly height: number };

export type Callback = ((value: string) => void) | ((value: number) => void);

// --- union including array, tuple and generic instantiations ----------

export type Many<T> = T | readonly T[];
export type Result<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: Error };

// --- intersections: combining object types ----------------------------

export type Entity = Identified & Timestamped;
export type OwnedEntity = Identified & Timestamped & Owned;

// --- intersection of an interface with an inline object type ----------

export type WithMeta = Identified & { readonly meta: Record<string, string> };

// --- intersection producing `never` on conflicting primitive members --

export type Conflicting = { readonly id: string } & { readonly id: number };

// --- intersection of function types: an overload set by another route -

export type Overloaded = ((value: string) => string) & ((value: number) => number);

// --- intersection with a call signature and properties (a callable bag)

export type Middleware = {
    (request: string): string;
    readonly name: string;
};

// --- the distribution asymmetry: union of intersections vs intersection
//     of unions are not the same type ---------------------------------

export type UnionOfIntersections = (Identified & Timestamped) | (Identified & Owned);
export type IntersectionOfUnions = Identified & (Timestamped | Owned);

// --- unions nested in generics, and generic constraints over unions ---

export type Lookup = ReadonlyMap<string, Shape | null>;
export type NonNullish<T extends Primitive> = Exclude<T, null | undefined>;

// --- union with `never` (absorbed) and with `unknown` (absorbing) -----

export type WithNever = string | never;
export type WithUnknown = string | unknown;
export type IntersectWithNever = string & never;
export type IntersectWithUnknown = string & unknown;

// --- optional members vs a union with undefined, which differ --------

export interface OptionalMember { readonly value?: string }
export interface UndefinedUnionMember { readonly value: string | undefined }
