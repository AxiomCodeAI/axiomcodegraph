// fixture: type-system/conditional-types
// nature: type-only
//
// Conditional types are a type-level computation with no runtime shadow at
// all: a term rewriting system embedded in the type checker. Neither Java nor
// Python has anything comparable.
//
// Shaped after the conditional types that ship in lib.es5.d.ts and in real
// libraries: ReturnType, Awaited, and the recursive flatten/deep-partial
// families.

export interface Identified { readonly id: string }
export interface User extends Identified { readonly email: string }

// --- the basic form ------------------------------------------------------

export type IsString<T> = T extends string ? true : false;
export type Nullable<T> = T extends null | undefined ? never : T;

// --- nested conditionals, chained as an if/else ladder ------------------

export type TypeName<T> = T extends string
    ? "string"
    : T extends number
      ? "number"
      : T extends boolean
        ? "boolean"
        : T extends undefined
          ? "undefined"
          : T extends Function
            ? "function"
            : "object";

// --- `infer` in return, parameter, element and property position -------

export type ReturnOf<T> = T extends (...args: never[]) => infer R ? R : never;
export type FirstParam<T> = T extends (first: infer P, ...rest: never[]) => unknown ? P : never;
export type AllParams<T> = T extends (...args: infer P) => unknown ? P : never;
export type ElementOf<T> = T extends readonly (infer E)[] ? E : never;
export type Unwrap<T> = T extends Promise<infer V> ? V : T;
export type IdOf<T> = T extends { readonly id: infer I } ? I : never;
export type InstanceOf<T> = T extends abstract new (...args: never[]) => infer I ? I : never;

// --- multiple `infer` positions in one conditional ---------------------

export type Split<T> = T extends readonly [infer Head, ...infer Tail] ? [Head, Tail] : never;
export type Swap<T> = T extends readonly [infer A, infer B] ? readonly [B, A] : never;
export type FnParts<T> = T extends (arg: infer A) => infer R ? { arg: A; result: R } : never;

// --- `infer` with a constraint, and with a default (TS 4.7 / 5.0) -----

export type FirstString<T> = T extends readonly [infer H extends string, ...unknown[]] ? H : never;

// --- distributive vs non-distributive over a union ---------------------
//     the naked type parameter distributes; the bracketed one does not

export type Distributed<T> = T extends string ? "s" : "other";
export type NotDistributed<T> = [T] extends [string] ? "s" : "other";
export type ExcludeLike<T, U> = T extends U ? never : T;
export type ExtractLike<T, U> = T extends U ? T : never;

// --- recursive conditional types --------------------------------------

export type DeepAwaited<T> = T extends Promise<infer V> ? DeepAwaited<V> : T;

export type Flatten<T> = T extends readonly (infer E)[] ? Flatten<E> : T;

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
    ? T
    : T extends readonly (infer E)[]
      ? ReadonlyArray<DeepReadonly<E>>
      : T extends object
        ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
        : T;

export type PathOf<T> = T extends object
    ? { [K in keyof T & string]: T[K] extends object ? `${K}` | `${K}.${PathOf<T[K]>}` : `${K}` }[keyof T & string]
    : never;

// --- a recursive conditional over a tuple, the arity-manipulating form -

export type Reverse<T extends readonly unknown[]> = T extends readonly [infer H, ...infer R]
    ? readonly [...Reverse<R>, H]
    : readonly [];

export type Length<T extends readonly unknown[]> = T["length"];

// --- conditionals used to constrain and to select --------------------

export type OnlyArrays<T> = T extends readonly unknown[] ? T : never;
export type KeysMatching<T, V> = { [K in keyof T]-?: T[K] extends V ? K : never }[keyof T];

// --- applied to concrete types, so the checker has work to do --------

export type UserId = IdOf<User>;
export type UserKeys = KeysMatching<User, string>;
export type Loaded = DeepAwaited<Promise<Promise<readonly User[]>>>;
export type Flat = Flatten<readonly (readonly (readonly number[])[])[]>;
export type ReversedPair = Reverse<readonly [1, 2, 3]>;
export type Frozen = DeepReadonly<{ a: { b: readonly number[] } }>;
export type Paths = PathOf<{ a: { b: string }; c: number }>;
export type WithoutNull = ExcludeLike<string | number | null, null>;
export type NameOfNumber = TypeName<42>;
export type NoDistribute = NotDistributed<string | number>;
