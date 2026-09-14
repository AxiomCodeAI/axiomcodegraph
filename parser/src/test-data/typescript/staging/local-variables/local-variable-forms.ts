// fixture: local-variables/local-variable-forms
// nature: runtime-bearing
//
// Port of Java's `LocalVariableExamples.java`: every form a local binding can
// take, and every container a local binding can be declared in.
//
// The declaration KEYWORD is the first divergence from Java: `var` is
// function-scoped and hoisted, `let` and `const` are block-scoped with a
// temporal dead zone, and `const` constrains the binding rather than the
// value. Java's `final` local is closest to `const`, and Java's `var` is
// closest to an un-annotated `let` -- a false friend worth pinning down.
//
// The second divergence is destructuring, which Java has no form of at all:
// object, array, nested, renamed, defaulted and rest patterns all introduce
// bindings without naming a declarator per binding.

export interface Row {
    readonly id: string;
    readonly score: number;
    readonly tags: readonly string[];
}

export interface Nested {
    readonly row: Row;
    readonly meta: { readonly source: string; readonly version?: number };
}

const sink: unknown[] = [];

function use(value: unknown): void {
    sink.push(value);
}

export function drain(): readonly unknown[] {
    return sink;
}

// --- the three declaration keywords -------------------------------------

export function declarationKeywords(): number {
    var hoisted = 1; // function-scoped, hoisted to the top of the function
    let mutable = 2; // block-scoped, reassignable
    const immutable = 3; // block-scoped, not reassignable

    mutable += immutable;
    hoisted += mutable;
    return hoisted;
}

// --- annotated vs inferred ----------------------------------------------

export function annotationForms(row: Row): string {
    const inferred = row.id; // string, by inference
    const annotated: string = row.id;
    const widened: string | undefined = undefined;
    let unionTyped: string | number = 0;
    unionTyped = row.score;
    return `${inferred}${annotated}${widened ?? ""}${unionTyped}`;
}

// --- several declarators in one statement -------------------------------

export function multipleDeclarators(): number {
    let first = 1,
        second = 2,
        third: number = first + second;
    const a = 10,
        b = 20;
    third += a + b;
    return third;
}

// --- declared without an initialiser, assigned later --------------------

export function deferredAssignment(rows: readonly Row[]): string {
    let best: Row | undefined;
    let label: string;

    for (const row of rows) {
        if (best === undefined || row.score > best.score) {
            best = row;
        }
    }

    if (best === undefined) {
        label = "none";
    } else {
        label = best.id;
    }
    return label;
}

// --- definite-assignment assertion on a local ---------------------------

export function definiteAssignment(rows: readonly Row[]): number {
    let total!: number;
    total = 0;
    for (const row of rows) {
        total += row.score;
    }
    return total;
}

// --- object destructuring: plain, renamed, defaulted, nested, rest ------

export function objectDestructuring(nested: Nested): string {
    // plain
    const { row } = nested;

    // renamed
    const { id: rowId } = row;

    // defaulted (the default applies only to `undefined`)
    const { version = 1 } = nested.meta;

    // nested pattern, reaching two levels down
    const {
        meta: { source },
    } = nested;

    // rest element, collecting the remaining properties
    const { id, ...withoutId } = row;

    // renamed AND defaulted together
    const { source: origin = "unknown" } = nested.meta;

    use(withoutId);
    return `${rowId}${version}${source}${id}${origin}`;
}

// --- array destructuring: positional, holes, rest, defaults, swap ------

export function arrayDestructuring(values: readonly number[]): number {
    const [first, second] = values;
    const [, , third] = values; // holes skip positions
    const [head, ...tail] = values;
    const [x = 0, y = 0] = values;

    let left = 1;
    let right = 2;
    [left, right] = [right, left]; // destructuring assignment, not a declaration

    return (
        (first ?? 0) + (second ?? 0) + (third ?? 0) + (head ?? 0) + tail.length + x + y + left + right
    );
}

// --- destructuring a function's return value, and a tuple -------------

function bounds(): readonly [number, number] {
    return [0, 10];
}

export function destructuredCall(): number {
    const [lower, upper] = bounds();
    const { length } = "hello";
    return lower + upper + length;
}

// --- initialiser forms: every kind of right-hand side -----------------

export function initialiserForms(rows: readonly Row[]): number {
    const literal = 42;
    const text = "text";
    const template = `${text}-${literal}`;
    const pattern = /^[a-z]+$/i;
    const array = [1, 2, 3];
    const object = { key: "value", nested: { deep: true } };
    const created = new Map<string, number>();
    const fromCall = rows.map((row) => row.score);
    const arrow = (value: number): number => value * 2;
    const fnExpr = function double(value: number): number {
        return value * 2;
    };
    const classExpr = class Local {
        readonly kind = "local";
    };
    const ternary = rows.length > 0 ? "some" : "none";
    const nullish = rows[0]?.id ?? "missing";
    const instance = new classExpr();

    created.set(nullish, literal);
    use([template, pattern.source, array, object, fromCall, ternary, instance.kind]);
    return arrow(1) + fnExpr(2) + created.size;
}

// --- locals in every container a body can be -------------------------

export class Container {
    readonly initial: number;

    // local inside a field initialiser (an arrow body)
    readonly compute = (seed: number): number => {
        const doubled = seed * 2;
        return doubled;
    };

    static readonly registry = new Map<string, number>();

    // local inside a static initialisation block
    static {
        const seedKey = "seed";
        Container.registry.set(seedKey, 0);
    }

    // local inside a constructor body
    constructor(seed: number) {
        const adjusted = seed + 1;
        this.initial = adjusted;
    }

    // local inside a getter
    get description(): string {
        const prefix = "container";
        return `${prefix}:${this.initial}`;
    }

    // local inside a setter
    set seed(value: number) {
        const clamped = Math.max(0, value);
        Container.registry.set("seed", clamped);
    }

    // local inside a method, and inside a nested function in that method
    total(rows: readonly Row[]): number {
        const base = this.initial;

        function inner(scores: readonly number[]): number {
            const sum = scores.reduce((acc, next) => acc + next, 0);
            return sum;
        }

        return base + inner(rows.map((row) => row.score));
    }

    // local inside a generator body
    *ids(rows: readonly Row[]): Generator<string> {
        for (const row of rows) {
            const upper = row.id.toUpperCase();
            yield upper;
        }
    }

    // local inside an async body, initialised by an await
    async load(fetcher: () => Promise<readonly Row[]>): Promise<number> {
        const loaded = await fetcher();
        const count = loaded.length;
        return count;
    }
}

// --- block scoping and shadowing --------------------------------------

export function shadowing(value: number): number {
    const outer = value;
    {
        // a distinct binding that shadows `outer` for this block only
        const outerShadow = outer * 2;
        use(outerShadow);
    }
    let sum = outer;
    for (let i = 0; i < 3; i++) {
        // `i` is re-bound per iteration for let, unlike var
        const scoped = i * outer;
        sum += scoped;
    }
    return sum;
}

// --- a local captured by a closure ------------------------------------

export function makeCounter(start: number): () => number {
    let count = start; // captured by the returned closure and outlives the call
    return function next(): number {
        count += 1;
        return count;
    };
}

// --- loop bindings in each loop form ----------------------------------

export function loopBindings(rows: readonly Row[], lookup: Record<string, number>): number {
    let total = 0;

    for (let index = 0; index < rows.length; index++) {
        total += rows[index]?.score ?? 0;
    }

    for (const row of rows) {
        total += row.tags.length;
    }

    for (const key in lookup) {
        const value = lookup[key];
        total += value ?? 0;
    }

    // a destructuring pattern as the loop binding
    for (const { id, score } of rows) {
        use(id);
        total += score;
    }

    return total;
}

// --- a binding introduced by catch, and one inside a switch case ------

export function otherBindingSites(payload: string, kind: string): string {
    try {
        const parsed = JSON.parse(payload) as Row;
        return parsed.id;
    } catch (error) {
        // `error` is a binding, and its type is `unknown`, never a declared
        // exception type -- Java's typed catch parameter has no analogue
        const message = error instanceof Error ? error.message : String(error);
        switch (kind) {
            case "verbose": {
                const detail = `${kind}:${message}`;
                return detail;
            }
            default:
                return message;
        }
    }
}
