// fixture: type-system/template-literal-types
// nature: type-only
//
// Template-literal types compute string types from other string types, with
// four intrinsic case-transform types. Nothing in Java or Python is analogous.
//
// Shaped after the route, event-name and CSS-property patterns that make these
// types worth having in real code.

export type Method = "get" | "post" | "put" | "delete";
export type Resource = "user" | "order";

// --- simple interpolation, and the cross product over unions --------

export type Greeting = `hello ${string}`;
export type Route = `/${Resource}`;
export type Endpoint = `${Uppercase<Method>} /${Resource}`;
export type Versioned = `/v${1 | 2}/${Resource}`;

// --- interpolating number, bigint, boolean and literal unions -------

export type PixelValue = `${number}px`;
export type Percentage = `${number}%`;
export type BooleanFlag = `flag-${boolean}`;
export type Coordinate = `${number},${number}`;

// --- the four intrinsic case transforms -----------------------------

export type Upper = Uppercase<"hello">;
export type Lower = Lowercase<"HELLO">;
export type Capital = Capitalize<"hello">;
export type Uncapital = Uncapitalize<"Hello">;
export type ShoutedMethods = Uppercase<Method>;

// --- nested templates and templates over templates ------------------

export type Namespaced = `app:${Route}`;
export type EventName = `on${Capitalize<Method>}`;
export type Nested = `${Namespaced}#${EventName}`;

// --- inference FROM a template literal, with `infer` ---------------

export type ParseRoute<T> = T extends `/${infer R}` ? R : never;
export type Head<T> = T extends `${infer H}.${string}` ? H : T;
export type Tail<T> = T extends `${string}.${infer R}` ? R : never;
export type SplitOn<S extends string, D extends string> = S extends `${infer H}${D}${infer R}`
    ? readonly [H, ...SplitOn<R, D>]
    : readonly [S];
export type Trim<S extends string> = S extends ` ${infer R}`
    ? Trim<R>
    : S extends `${infer L} `
      ? Trim<L>
      : S;
export type ParamNames<S extends string> = S extends `${string}:${infer P}/${infer R}`
    ? P | ParamNames<R>
    : S extends `${string}:${infer P}`
      ? P
      : never;

// --- template literals as mapped-type keys -------------------------

export type EventMap<T extends string> = { [K in T as `on${Capitalize<K>}`]: () => void };

// --- applied -------------------------------------------------------

export type UserRoute = ParseRoute<"/user">;
export type Segments = SplitOn<"a.b.c", ".">;
export type Trimmed = Trim<"  padded  ">;
export type RouteParams = ParamNames<"/users/:userId/orders/:orderId">;
export type MethodEvents = EventMap<Method>;
export type Domain = Head<"api.example.com">;
export type Rest = Tail<"api.example.com">;
