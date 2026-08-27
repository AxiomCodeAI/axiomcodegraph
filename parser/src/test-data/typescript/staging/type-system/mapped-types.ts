// fixture: type-system/mapped-types
// nature: type-only
//
// Mapped types iterate the keys of one type to build another, optionally
// rewriting the key itself (`as`, TS 4.1) and adding or removing the
// `readonly` and `?` modifiers. No Java or Python construct is comparable.
//
// Shaped after the mapped types in lib.es5.d.ts (Partial, Required, Readonly,
// Pick, Record) and after the getter/event-map generators real libraries ship.

export interface User {
    id: string;
    email: string;
    age: number;
    readonly createdAt: number;
    nickname?: string;
}

export type Handler = (payload: unknown) => void;

// --- the homomorphic forms: modifiers added and removed ---------------

export type AllOptional<T> = { [K in keyof T]?: T[K] };
export type AllRequired<T> = { [K in keyof T]-?: T[K] };
export type AllReadonly<T> = { readonly [K in keyof T]: T[K] };
export type Mutable<T> = { -readonly [K in keyof T]: T[K] };
export type AddBoth<T> = { readonly [K in keyof T]+?: T[K] };
export type StripBoth<T> = { -readonly [K in keyof T]-?: T[K] };

// --- mapping over a key union rather than over `keyof` ---------------

export type Flags<K extends string> = { [P in K]: boolean };
export type Dictionary<K extends string | number | symbol, V> = { [P in K]: V };
export type FromLiterals = Flags<"read" | "write" | "execute">;

// --- key remapping with `as` -----------------------------------------

export type Getters<T> = {
    [K in keyof T as `get${Capitalize<string & K>}`]: () => T[K];
};

export type Setters<T> = {
    [K in keyof T as `set${Capitalize<string & K>}`]: (value: T[K]) => void;
};

export type Prefixed<T, P extends string> = {
    [K in keyof T as `${P}${Capitalize<string & K>}`]: T[K];
};

// --- key remapping that FILTERS, by mapping a key to `never` ---------

export type OnlyStrings<T> = {
    [K in keyof T as T[K] extends string ? K : never]: T[K];
};

export type RemoveKey<T, Drop extends keyof T> = {
    [K in keyof T as K extends Drop ? never : K]: T[K];
};

export type OnlyMethods<T> = {
    [K in keyof T as T[K] extends (...args: never[]) => unknown ? K : never]: T[K];
};

// --- remapping over a union member, producing an event map ----------

export type EventHandlers<T extends { readonly kind: string }> = {
    [E in T as `on${Capitalize<E["kind"]>}`]: (event: E) => void;
};

export type DomEvent =
    | { readonly kind: "click"; readonly x: number }
    | { readonly kind: "focus"; readonly target: string };

// --- the value position may itself be conditional or nested --------

export type NullableFields<T> = { [K in keyof T]: T[K] | null };
export type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};
export type Boxed<T> = { [K in keyof T]: { readonly value: T[K] } };

// --- mapping a tuple or array: the homomorphic array case ----------

export type Stringified<T extends readonly unknown[]> = { [K in keyof T]: string };
export type Promised<T extends readonly unknown[]> = { [K in keyof T]: Promise<T[K]> };

// --- the standard library forms, rebuilt to show their shape -------

export type PickLike<T, K extends keyof T> = { [P in K]: T[P] };
export type OmitLike<T, K extends keyof never> = PickLike<T, Exclude<keyof T, K>>;
export type RecordLike<K extends keyof never, V> = { [P in K]: V };

// --- applied, so the checker instantiates each one ----------------

export type PartialUser = AllOptional<User>;
export type RequiredUser = AllRequired<User>;
export type MutableUser = Mutable<User>;
export type UserGetters = Getters<User>;
export type UserSetters = Setters<User>;
export type UserStrings = OnlyStrings<User>;
export type UserWithoutId = RemoveKey<User, "id">;
export type ApiUser = Prefixed<User, "api">;
export type DomHandlers = EventHandlers<DomEvent>;
export type DeepPartialUser = DeepPartial<{ user: User; nested: { deep: boolean } }>;
export type PromisedPair = Promised<readonly [string, number]>;
