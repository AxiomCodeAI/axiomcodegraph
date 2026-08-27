// fixture: type-system/satisfies-and-const
// nature: runtime-bearing
//
// `satisfies` (TS 4.9) and `as const` (3.4) are both ERASED operators over
// runtime values. The values are emitted; the operators are not. That makes
// this file the sharpest test of the runtime/type-only boundary: the same
// expression is a runtime object AND the subject of a type-level check.
//
// `satisfies` checks a value against a type WITHOUT widening it to that type,
// which is exactly what an annotation would do. Java has no operator that
// checks conformance while preserving the more specific type.

export type Alignment = "left" | "center" | "right";
export interface RouteConfig {
    readonly path: string;
    readonly method: "get" | "post";
    readonly auth?: boolean;
}

// --- annotation vs satisfies: the difference in the retained type ------

// annotated: `colours.primary` is widened to string
export const annotatedPalette: Record<string, string> = {
    primary: "#0af",
    secondary: "#fa0",
};

// satisfies: checked against the same type, but each value stays literal
export const checkedPalette = {
    primary: "#0af",
    secondary: "#fa0",
} satisfies Record<string, string>;

// --- satisfies over a union-valued record ------------------------------

export const alignments = {
    header: "center",
    body: "left",
    footer: "right",
} satisfies Record<string, Alignment>;

// --- satisfies preserving the key set, so keyof stays narrow ----------

export const routes = {
    listUsers: { path: "/users", method: "get" },
    createUser: { path: "/users", method: "post", auth: true },
} satisfies Record<string, RouteConfig>;

export type RouteName = keyof typeof routes;

// --- satisfies on an array, a tuple and a function ------------------

export const origins = ["https://a.example", "https://b.example"] satisfies readonly string[];

export const pair = [1, "one"] satisfies readonly [number, string];

export const handler = ((request: string): number => request.length) satisfies (
    request: string,
) => number;

// --- satisfies combined with as const --------------------------------

export const frozenRoutes = {
    listUsers: { path: "/users", method: "get" },
} as const satisfies Record<string, RouteConfig>;

// --- as const in each of its positions -------------------------------

export const literalString = "immutable" as const;
export const literalNumber = 42 as const;
export const constTuple = [1, 2, 3] as const;
export const constObject = {
    name: "config",
    retries: 3,
    nested: { deep: true },
    list: ["a", "b"],
} as const;

// as const on an individual property value
export const mixed = {
    widened: "changes",
    narrowed: "fixed" as const,
};

// as const in an argument position
export function withOptions(options: { readonly mode: "fast" | "safe" }): string {
    return options.mode;
}
export const called = withOptions({ mode: "fast" } as const);

// --- a const type parameter capturing literals without `as const` ----

export function asConstTuple<const T extends readonly unknown[]>(...items: T): T {
    return items;
}
export const inferredLiterals = asConstTuple("a", "b", 1);

// --- consumption sites, so the file genuinely emits ----------------

export function resolveRoute(name: RouteName): string {
    return routes[name].path;
}

export function align(section: keyof typeof alignments): Alignment {
    return alignments[section];
}

export function totalOrigins(): number {
    return origins.length + constTuple.length + constObject.list.length;
}
